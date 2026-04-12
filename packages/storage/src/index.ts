export interface StorageContract {
  kind: "s3-compatible";
  operations: ["upload", "resolveDownloadUrl", "delete", "healthCheck"];
}

export function createStorageContract(): StorageContract {
  return {
    kind: "s3-compatible",
    operations: ["upload", "resolveDownloadUrl", "delete", "healthCheck"]
  };
}
