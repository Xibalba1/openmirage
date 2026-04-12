import test from "node:test";
import assert from "node:assert/strict";

import { readStorageConfig } from "./index.js";

test("readStorageConfig returns local storage config when provider is local", () => {
  const config = readStorageConfig({
    STORAGE_PROVIDER: "local",
    STORAGE_BUCKET: "assets",
    STORAGE_LOCAL_ROOT: "/tmp/openmirage-storage"
  });

  assert.deepEqual(config, {
    provider: "local",
    bucket: "assets",
    rootDirectory: "/tmp/openmirage-storage"
  });
});

test("readStorageConfig returns s3-compatible config with defaults", () => {
  const config = readStorageConfig({
    STORAGE_PROVIDER: "minio",
    STORAGE_BUCKET: "assets"
  });

  assert.equal(config.provider, "minio");
  assert.equal(config.bucket, "assets");
  assert.equal(config.endpoint, "http://127.0.0.1:9000");
  assert.equal(config.region, "us-east-1");
  assert.equal(config.accessKeyId, "openmirage");
  assert.equal(config.secretAccessKey, "openmirage123");
  assert.equal(config.forcePathStyle, true);
});

test("readStorageConfig rejects invalid storage provider", () => {
  assert.throws(
    () =>
      readStorageConfig({
        STORAGE_PROVIDER: "gcs",
        STORAGE_BUCKET: "assets"
      }),
    /STORAGE_PROVIDER/
  );
});

test("readStorageConfig rejects invalid boolean values", () => {
  assert.throws(
    () =>
      readStorageConfig({
        STORAGE_PROVIDER: "s3-compatible",
        STORAGE_BUCKET: "assets",
        STORAGE_S3_FORCE_PATH_STYLE: "yes"
      }),
    /STORAGE_S3_FORCE_PATH_STYLE/
  );
});
