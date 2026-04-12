import { readWorkerEnv } from "@openmirage/config-env";
import {
  checkMetadataStore,
  createMetadataStoreContract,
  getApplicationVersionInfo
} from "@openmirage/db";
import {
  createErrorLogFields,
  createHttpMetrics,
  createMetricsRegistry,
  createRequestId,
  createServiceLogger,
  initErrorReporter,
  registerProcessErrorHandlers,
  registerServiceInfoMetrics,
  summarizeChecks
} from "@openmirage/observability";
import { createStorage } from "@openmirage/storage";
import {
  type ServiceCheck,
  type StorageConfig,
  type WorkerHeartbeat
} from "@openmirage/types";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";

function buildHeartbeat(uptimeSeconds: number): WorkerHeartbeat {
  const env = readWorkerEnv();

  return {
    service: "worker",
    environment: env.environment,
    ok: true,
    heartbeatIntervalMs: env.heartbeatIntervalMs,
    uptimeSeconds,
    timestamp: new Date().toISOString()
  };
}

async function inspectStorage(
  storage: ReturnType<typeof createStorage>,
  storageConfig: StorageConfig
): Promise<ServiceCheck> {
  try {
    await storage.ensureBucket();
    const storageHealth = await storage.healthCheck();

    return {
      ok: storageHealth.ok,
      summary: storageHealth.summary
    };
  } catch (error) {
    return {
      ok: false,
      summary: `storage ${storageConfig.provider} bootstrap failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }
}

async function startWorker(): Promise<void> {
  const env = readWorkerEnv();
  const logger = createServiceLogger({
    service: "worker",
    environment: env.environment,
    version: env.appVersion,
    level: env.logLevel
  });
  const reporter = initErrorReporter(env.errorReporting, logger);
  const metadataStore = createMetadataStoreContract();
  const storage = createStorage(env.storage);

  const startedAt = Date.now();
  const bootId = randomUUID();
  const registry = createMetricsRegistry();
  const httpMetrics = createHttpMetrics(registry, "worker");
  const serviceHealth = registry.gauge({
    name: "openmirage_service_health",
    help: "Current health state for the service",
    labelNames: ["service"],
    type: "gauge"
  });
  const serviceReady = registry.gauge({
    name: "openmirage_service_ready",
    help: "Current readiness state for the service",
    labelNames: ["service"],
    type: "gauge"
  });
  const heartbeatUnixtime = registry.gauge({
    name: "openmirage_worker_heartbeat_unixtime",
    help: "Unix timestamp for the latest worker heartbeat",
    labelNames: ["service"],
    type: "gauge"
  });
  const uptimeSeconds = registry.gauge({
    name: "openmirage_worker_uptime_seconds",
    help: "Worker process uptime in seconds",
    labelNames: ["service"],
    type: "gauge"
  });
  const jobsTotal = registry.counter({
    name: "openmirage_worker_jobs_total",
    help: "Total worker jobs observed",
    labelNames: ["service", "job_type", "job_state"],
    type: "counter"
  });
  const jobsInProgress = registry.gauge({
    name: "openmirage_worker_jobs_in_progress",
    help: "Current worker jobs in progress",
    labelNames: ["service", "job_type"],
    type: "gauge"
  });

  registerProcessErrorHandlers(logger, reporter);
  registerServiceInfoMetrics(
    registry,
    "worker",
    env.environment,
    getApplicationVersionInfo(env.appVersion)
  );
  serviceHealth.set({ service: "worker" }, 1);
  serviceReady.set({ service: "worker" }, 1);
  jobsTotal.inc(
    {
      job_state: "completed",
      job_type: "placeholder",
      service: "worker"
    },
    0
  );
  jobsInProgress.set(
    {
      job_type: "placeholder",
      service: "worker"
    },
    0
  );

  function syncWorkerMetrics(): void {
    heartbeatUnixtime.set(
      { service: "worker" },
      Math.floor(Date.now() / 1_000)
    );
    uptimeSeconds.set(
      { service: "worker" },
      Math.floor((Date.now() - startedAt) / 1_000)
    );
  }

  const requestStartedAt = new WeakMap<object, bigint>();
  const app = Fastify({
    disableRequestLogging: true,
    genReqId(request) {
      const header = request.headers["x-request-id"];
      return createRequestId(typeof header === "string" ? header : undefined);
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    requestStartedAt.set(request, process.hrtime.bigint());
    reply.header("x-request-id", request.id);
    logger.info("worker http request started", {
      method: request.method,
      path: request.url,
      requestId: request.id
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAtNs = requestStartedAt.get(request);
    const durationMs =
      typeof startedAtNs === "bigint"
        ? Number(process.hrtime.bigint() - startedAtNs) / 1_000_000
        : undefined;
    const route = request.routeOptions.url ?? request.url;

    logger.info("worker http request completed", {
      durationMs:
        durationMs === undefined ? undefined : Number(durationMs.toFixed(2)),
      method: request.method,
      path: request.url,
      requestId: request.id,
      statusCode: reply.statusCode
    });
    httpMetrics.requestsTotal.inc({
      method: request.method,
      route,
      service: "worker",
      status_code: reply.statusCode
    });

    if (durationMs !== undefined) {
      httpMetrics.requestDurationSeconds.observe(
        {
          method: request.method,
          route,
          service: "worker",
          status_code: reply.statusCode
        },
        durationMs / 1_000
      );
    }
  });

  app.setErrorHandler(async (error, request, reply) => {
    logger.error(
      "worker http request failed",
      createErrorLogFields(error, {
        method: request.method,
        path: request.url,
        requestId: request.id,
        statusCode: reply.statusCode >= 400 ? reply.statusCode : 500
      })
    );
    reporter.captureException(error, {
      requestId: request.id,
      route: request.routeOptions.url
    });

    if (!reply.sent) {
      reply.status(500).send({
        error: "internal_error"
      });
    }
  });

  app.get("/healthz", async () => {
    const storageCheck = await inspectStorage(storage, env.storage);
    const checks = {
      env: {
        ok: true,
        summary: "environment loaded"
      },
      database: checkMetadataStore(env.databaseUrl),
      storage: storageCheck
    };

    return {
      ...buildHeartbeat(Math.floor((Date.now() - startedAt) / 1000)),
      ok: Object.values(checks).every((check) => check.ok),
      details: {
        metadataStore: metadataStore.kind,
        storageBucket: env.storage.bucket,
        storageProvider: env.storage.provider,
        ...summarizeChecks(checks)
      },
      checks
    };
  });

  app.get("/status", async () =>
    buildHeartbeat(Math.floor((Date.now() - startedAt) / 1000))
  );
  app.get("/metrics", async (_request, reply) => {
    syncWorkerMetrics();
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return registry.render();
  });

  if (env.enableTestErrorRoutes) {
    app.get("/__diagnostics/error", async () => {
      throw new Error("Forced worker observability test error");
    });
  }

  const heartbeat = setInterval(() => {
    syncWorkerMetrics();
    logger.info("worker heartbeat", {
      bootId,
      heartbeatIntervalMs: env.heartbeatIntervalMs,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
    });
  }, env.heartbeatIntervalMs);

  try {
    try {
      await storage.ensureBucket();
    } catch (error) {
      logger.warn("storage bootstrap failed during startup", {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    await app.listen({
      host: env.host,
      port: env.port
    });

    logger.info("worker server listening", {
      bootId,
      host: env.host,
      port: env.port,
      storageBucket: env.storage.bucket,
      storageProvider: env.storage.provider
    });
  } catch (error) {
    clearInterval(heartbeat);
    logger.error("worker failed to start", createErrorLogFields(error));
    reporter.captureException(error, {
      event: "startup"
    });
    await reporter.flush();
    process.exitCode = 1;
  }
}

void startWorker();
