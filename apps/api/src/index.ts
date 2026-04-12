import { createSessionContract } from "@openmirage/auth";
import { createMetadataStoreContract } from "@openmirage/db";
import { createServiceLogger } from "@openmirage/observability";
import { createStorageContract } from "@openmirage/storage";
import { type HealthStatus } from "@openmirage/types";

export function createApiPlaceholder(): HealthStatus {
  const logger = createServiceLogger("api");
  const session = createSessionContract();
  const metadataStore = createMetadataStoreContract();
  const storage = createStorageContract();

  logger.info("api placeholder initialized");

  return {
    service: "api",
    ok: true,
    details: {
      authMode: session.mode,
      metadataStore: metadataStore.kind,
      storage: storage.kind
    }
  };
}
