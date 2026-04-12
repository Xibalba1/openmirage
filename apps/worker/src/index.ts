import { readWorkerEnv } from "@openmirage/config-env";
import { checkMetadataStore, createMetadataStoreContract } from "@openmirage/db";
import { createServiceLogger, summarizeChecks } from "@openmirage/observability";
import { checkStorageContract, createStorageContract } from "@openmirage/storage";
import { type WorkerHeartbeat } from "@openmirage/types";
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

async function startWorker(): Promise<void> {
  const env = readWorkerEnv();
  const logger = createServiceLogger({
    service: "worker",
    environment: env.environment,
    level: env.logLevel
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

  const startedAt = Date.now();
  const app = Fastify({
    disableRequestLogging: true
  });

  app.get("/healthz", async () => ({
    ...buildHeartbeat(Math.floor((Date.now() - startedAt) / 1000)),
    details: {
      metadataStore: metadataStore.kind,
      storage: storage.kind,
      ...summarizeChecks(checks)
    },
    checks
  }));

  app.get("/status", async () => buildHeartbeat(Math.floor((Date.now() - startedAt) / 1000)));

  const heartbeat = setInterval(() => {
    logger.info("worker heartbeat", {
      heartbeatIntervalMs: env.heartbeatIntervalMs,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
    });
  }, env.heartbeatIntervalMs);

  try {
    await app.listen({
      host: env.host,
      port: env.port
    });

    logger.info("worker server listening", {
      host: env.host,
      port: env.port
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
