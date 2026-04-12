import { readWorkerEnv } from "@openmirage/config-env";
import { checkMetadataStore, createMetadataStoreContract } from "@openmirage/db";
import { createServiceLogger, summarizeChecks } from "@openmirage/observability";
import { createStorage } from "@openmirage/storage";
import {
  type ServiceCheck,
  type StorageConfig,
  type WorkerHeartbeat
} from "@openmirage/types";
import Fastify from "fastify";

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
    level: env.logLevel
  });
  const metadataStore = createMetadataStoreContract();
  const storage = createStorage(env.storage);

  const startedAt = Date.now();
  const app = Fastify({
    disableRequestLogging: true
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

  app.get("/status", async () => buildHeartbeat(Math.floor((Date.now() - startedAt) / 1000)));

  const heartbeat = setInterval(() => {
    logger.info("worker heartbeat", {
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
      host: env.host,
      port: env.port,
      storageBucket: env.storage.bucket,
      storageProvider: env.storage.provider
    });
  } catch (error) {
    clearInterval(heartbeat);
    logger.error("worker failed to start", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  }
}

void startWorker();
