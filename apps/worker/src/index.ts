import { createMetadataStoreContract } from "@openmirage/db";
import { createServiceLogger } from "@openmirage/observability";
import { createStorageContract } from "@openmirage/storage";
import { type HealthStatus } from "@openmirage/types";

export function createWorkerPlaceholder(): HealthStatus {
  const logger = createServiceLogger("worker");
  const metadataStore = createMetadataStoreContract();
  const storage = createStorageContract();

  logger.info("worker placeholder initialized");

  return {
    service: "worker",
    ok: true,
    details: {
      queue: "placeholder",
      metadataStore: metadataStore.kind,
      storage: storage.kind
    }
  };
}
