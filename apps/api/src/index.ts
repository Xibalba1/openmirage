import cors from "@fastify/cors";
import { createSessionContract } from "@openmirage/auth";
import { readApiEnv } from "@openmirage/config-env";
import { checkMetadataStore, createMetadataStoreContract } from "@openmirage/db";
import { createServiceLogger, summarizeChecks } from "@openmirage/observability";
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

async function buildHealthStatus(): Promise<HealthStatus> {
  const env = readApiEnv();
  const session = createSessionContract({
    sessionCookieName: env.sessionCookieName
  });
  const metadataStore = createMetadataStoreContract();
  const storage = createStorage(env.storage);
  const storageCheck = await inspectStorage(storage, env.storage);
  const checks = {
    env: {
      ok: true,
      summary: "environment loaded"
    },
    database: checkMetadataStore(env.databaseUrl),
    storage: storageCheck
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
  const health = await buildHealthStatus();

  return {
    ...health,
    ready: health.ok
  };
}

async function startApiServer(): Promise<void> {
  const env = readApiEnv();
  const logger = createServiceLogger({
    service: "api",
    environment: env.environment,
    level: env.logLevel
  });
  const storage = createStorage(env.storage);

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
  app.get("/readyz", async (_, reply) => {
    const ready = await buildReadyStatus();

    if (!ready.ready) {
      reply.status(503);
    }

    return ready;
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
  app.post<{ Body: StorageSmokeBody }>("/internal/storage/smoke", async (request, reply) => {
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
  });
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
    logger.error("api server failed to start", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  }
}

void startApiServer();
