import cors from "@fastify/cors";
import { createSessionContract } from "@openmirage/auth";
import { readApiEnv } from "@openmirage/config-env";
import { checkMetadataStore, createMetadataStoreContract } from "@openmirage/db";
import { createServiceLogger, summarizeChecks } from "@openmirage/observability";
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
    level: env.logLevel
  });

  const app = Fastify({
    disableRequestLogging: true
  });

  await app.register(cors, {
    origin: true,
    credentials: true
  });

  app.addHook("onRequest", async (request) => {
    const startedAt = process.hrtime.bigint();

    request.headers["x-openmirage-started-at"] = startedAt.toString();

    logger.info("request started", {
      method: request.method,
      path: request.url,
      requestId: request.id
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = request.headers["x-openmirage-started-at"];
    const durationMs =
      typeof startedAt === "string"
        ? Number(process.hrtime.bigint() - BigInt(startedAt)) / 1_000_000
        : undefined;

    logger.info("request completed", {
      durationMs:
        durationMs === undefined ? undefined : Number(durationMs.toFixed(2)),
      method: request.method,
      path: request.url,
      requestId: request.id,
      statusCode: reply.statusCode
    });
  });

  app.get("/healthz", async () => buildHealthStatus());
  app.get("/readyz", async () => buildReadyStatus());
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
    logger.error("api server failed to start", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  }
}

void startApiServer();
