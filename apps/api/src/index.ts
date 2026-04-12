import cors from "@fastify/cors";
import { createSessionContract } from "@openmirage/auth";
import { readApiEnv } from "@openmirage/config-env";
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
import { checkStorageContract, createStorageContract } from "@openmirage/storage";
import { type HealthStatus, type ReadyStatus } from "@openmirage/types";
import Fastify from "fastify";

function buildHealthStatus(): HealthStatus {
  const env = readApiEnv();
  const session = createSessionContract({
    sessionCookieName: env.sessionCookieName
  });
  const metadataStore = createMetadataStoreContract();
  const storage = createStorageContract(env.storageProvider);
  const checks = {
    env: {
      ok: true,
      summary: "environment loaded"
    },
    database: checkMetadataStore(env.databaseUrl),
    storage: checkStorageContract(storage.kind)
  };

  return {
    service: "api",
    ok: true,
    environment: env.environment,
    timestamp: new Date().toISOString(),
    details: {
      authMode: session.mode,
      authPath: env.authPath,
      metadataStore: metadataStore.kind,
      sessionCookieName: session.sessionCookieName,
      storage: storage.kind,
      ...summarizeChecks(checks)
    },
    checks
  };
}

function buildReadyStatus(): ReadyStatus {
  const health = buildHealthStatus();

  return {
    ...health,
    ready: true
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
  serviceReady.set({ service: "api" }, 1);

  const requestStartedAt = new WeakMap<object, bigint>();

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
  app.get("/readyz", async () => buildReadyStatus());
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

  if (env.enableTestErrorRoutes) {
    app.get("/__diagnostics/error", async () => {
      throw new Error("Forced API observability test error");
    });
  }

  try {
    await app.listen({
      host: env.host,
      port: env.port
    });

    logger.info("api server listening", {
      authPath: env.authPath,
      host: env.host,
      port: env.port
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
