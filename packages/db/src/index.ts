import { type ServiceCheck } from "@openmirage/types";

export interface MetadataStoreContract {
  kind: "postgres-metadata";
  pageContentOwner: "collab-service";
}

export function createMetadataStoreContract(): MetadataStoreContract {
  return {
    kind: "postgres-metadata",
    pageContentOwner: "collab-service"
  };
}

export function checkMetadataStore(databaseUrl: string): ServiceCheck {
  return {
    ok: databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://"),
    summary: "configured for postgres metadata storage"
  };
}
