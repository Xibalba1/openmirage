import { type ServiceCheck } from "@openmirage/types";

export interface StorageContract {
  kind: "local" | "minio" | "s3-compatible";
  operations: ["upload", "resolveDownloadUrl", "delete", "healthCheck"];
}

export function createStorageContract(
  kind: StorageContract["kind"] = "minio"
): StorageContract {
  return {
    kind,
    operations: ["upload", "resolveDownloadUrl", "delete", "healthCheck"]
  };
}

export function checkStorageContract(kind: StorageContract["kind"]): ServiceCheck {
  return {
    ok: true,
    summary: `storage adapter configured for ${kind}`
  };
}
