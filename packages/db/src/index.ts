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
