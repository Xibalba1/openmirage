import cors from "@fastify/cors";
import { createSessionContract } from "@openmirage/auth";
import { readApiEnv } from "@openmirage/config-env";
import {
  checkDatabaseConnection,
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
  type HealthStatus,
  type ReadyStatus,
  type ServiceCheck,
  type StorageConfig
} from "@openmirage/types";
import Fastify from "fastify";

interface StorageSmokeBody {
  bodyBase64: string;
  contentType?: string;
  key?: string;
}

function describeConfiguredStorage(storageConfig: StorageConfig): ServiceCheck {
  return {
    ok: true,
    summary: `configured for ${storageConfig.provider} storage bucket ${storageConfig.bucket}`
  };
}

async function buildHealthStatus(): Promise<HealthStatus> {
  const env = readApiEnv();
  const session = createSessionContract({
    sessionCookieName: env.sessionCookieName
  });
  const metadataStore = createMetadataStoreContract();
  const checks = {
    env: {
      ok: true,
      summary: "environment loaded"
    },
    database: checkMetadataStore(env.databaseUrl),
    storage: describeConfiguredStorage(env.storage)
  };
  const ok = Object.values(checks).every((check) => check.ok);

  return {
    service: "api",
    ok,
    environment: env.environment,
    timestamp: new Date().toISOString(),
    details: {
      authMode: session.mode,
      authPath: env.authPath,
      metadataStore: metadataStore.kind,
      sessionCookieName: session.sessionCookieName,
      storageBucket: env.storage.bucket,
      storageProvider: env.storage.provider,
      ...summarizeChecks(checks)
    },
    checks
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

async function buildReadyStatus(): Promise<ReadyStatus> {
  const env = readApiEnv();
  const session = createSessionContract({
    sessionCookieName: env.sessionCookieName
  });
  const metadataStore = createMetadataStoreContract();
  const storage = createStorage(env.storage);
  const checks = {
    env: {
      ok: true,
      summary: "environment loaded"
    },
    database: await checkDatabaseConnection(env.databaseUrl),
    storage: await inspectStorage(storage, env.storage)
  };
  const ok = Object.values(checks).every((check) => check.ok);

  return {
    service: "api",
    ok,
    ready: ok,
    environment: env.environment,
    timestamp: new Date().toISOString(),
    details: {
      authMode: session.mode,
      authPath: env.authPath,
      metadataStore: metadataStore.kind,
      sessionCookieName: session.sessionCookieName,
      storageBucket: env.storage.bucket,
      storageProvider: env.storage.provider,
      ...summarizeChecks(checks)
    },
    checks
  };
}

async function startApiServer(): Promise<void> {
  const env = readApiEnv();
  const logger = createServiceLogger({
    service: "api",
    environment: env.environment,
    version: env.appVersion,
    level: env.logLevel
  });
  const reporter = initErrorReporter(env.errorReporting, logger);
  const registry = createMetricsRegistry();
  const httpMetrics = createHttpMetrics(registry, "api");
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

  registerProcessErrorHandlers(logger, reporter);
  registerServiceInfoMetrics(
    registry,
    "api",
    env.environment,
    getApplicationVersionInfo(env.appVersion)
  );
  serviceHealth.set({ service: "api" }, 1);
  serviceReady.set({ service: "api" }, 0);

  const requestStartedAt = new WeakMap<object, bigint>();
  const storage = createStorage(env.storage);

  const app = Fastify({
    disableRequestLogging: true,
    genReqId(request) {
      const header = request.headers["x-request-id"];
      return createRequestId(typeof header === "string" ? header : undefined);
    }
  });

  await app.register(cors, {
    origin: true,
    credentials: true
  });

  app.addHook("onRequest", async (request, reply) => {
    const startedAt = process.hrtime.bigint();
    requestStartedAt.set(request, startedAt);
    reply.header("x-request-id", request.id);

    logger.info("request started", {
      method: request.method,
      path: request.url,
      requestId: request.id
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestStartedAt.get(request);
    const durationMs =
      typeof startedAt === "bigint"
        ? Number(process.hrtime.bigint() - startedAt) / 1_000_000
        : undefined;
    const route = request.routeOptions.url ?? request.url;

    logger.info("request completed", {
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
      service: "api",
      status_code: reply.statusCode
    });

    if (durationMs !== undefined) {
      httpMetrics.requestDurationSeconds.observe(
        {
          method: request.method,
          route,
          service: "api",
          status_code: reply.statusCode
        },
        durationMs / 1_000
      );
    }
  });

  app.setErrorHandler(async (error, request, reply) => {
    logger.error(
      "request failed",
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

  app.get("/healthz", async () => buildHealthStatus());
  app.get("/readyz", async (_, reply) => {
    const ready = await buildReadyStatus();
    serviceReady.set({ service: "api" }, ready.ready ? 1 : 0);

    if (!ready.ready) {
      reply.status(503);
    }

    return ready;
  });
  app.get("/metrics", async (_request, reply) => {
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return registry.render();
  });
  app.get("/", async () => ({
    service: "api",
    status: "running"
  }));
  app.get(`${env.authPath}/entry`, async () => ({
    service: "api",
    mode: "magic-link-session",
    route: `${env.authPath}/entry`,
    status: "placeholder"
  }));
  app.get("/internal/storage/smoke", async () => {
    await storage.ensureBucket();

    return {
      provider: env.storage.provider,
      bucket: env.storage.bucket,
      objects: await storage.list("smoke/")
    };
  });
  app.post<{ Body: StorageSmokeBody }>(
    "/internal/storage/smoke",
    async (request, reply) => {
      await storage.ensureBucket();

      if (!request.body?.bodyBase64) {
        reply.status(400);
        return {
          error: "bodyBase64 is required"
        };
      }

      const key =
        request.body.key ??
        `smoke/${Date.now()}-${Math.random().toString(36).slice(2)}.bin`;
      const body = Buffer.from(request.body.bodyBase64, "base64");
      const object = await storage.put({
        key,
        body,
        ...(request.body.contentType
          ? { contentType: request.body.contentType }
          : {})
      });

      return {
        object,
        downloadUrl: await storage.resolveDownloadUrl(key)
      };
    }
  );
  app.delete<{ Querystring: { key: string } }>(
    "/internal/storage/smoke",
    async (request, reply) => {
      await storage.ensureBucket();

      if (!request.query.key) {
        reply.status(400);
        return {
          error: "key is required"
        };
      }

      return storage.delete(request.query.key);
    }
  );

  if (env.enableTestErrorRoutes) {
    app.get("/__diagnostics/error", async () => {
      throw new Error("Forced API observability test error");
    });
  }

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

    logger.info("api server listening", {
      authPath: env.authPath,
      host: env.host,
      port: env.port,
      storageBucket: env.storage.bucket,
      storageProvider: env.storage.provider
    });
  } catch (error) {
    logger.error("api server failed to start", createErrorLogFields(error));
    reporter.captureException(error, {
      event: "startup"
    });
    await reporter.flush();
    process.exitCode = 1;
  }
}

void startApiServer();
