import test from "node:test";
import assert from "node:assert/strict";

import { readApiEnv, readStorageConfig, readWebEnv } from "./index.js";

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

test("readApiEnv derives auth defaults for development", () => {
  const env = readApiEnv({
    OPENMIRAGE_ENV: "development",
    DATABASE_URL: "postgres://localhost/openmirage"
  });

  assert.equal(env.appBaseUrl, "http://localhost:3000");
  assert.equal(env.authMagicLinkTtlMinutes, 15);
  assert.equal(env.authSessionTtlDays, 30);
  assert.equal(env.sessionCookiePath, "/");
  assert.equal(env.sessionCookieSameSite, "lax");
  assert.equal(env.sessionCookieSecure, false);
  assert.equal(env.devAuthExposeMagicLink, true);
});

test("readApiEnv enables secure cookies by default in staging", () => {
  const env = readApiEnv({
    OPENMIRAGE_ENV: "staging",
    DATABASE_URL: "postgres://localhost/openmirage"
  });

  assert.equal(env.sessionCookieSecure, true);
});

test("readApiEnv rejects invalid same-site settings", () => {
  assert.throws(
    () =>
      readApiEnv({
        DATABASE_URL: "postgres://localhost/openmirage",
        SESSION_COOKIE_SAME_SITE: "bogus"
      }),
    /SESSION_COOKIE_SAME_SITE/
  );
});

test("readWebEnv includes runtime app version", () => {
  const env = readWebEnv({
    APP_VERSION: "abc1234",
    OPENMIRAGE_ENV: "staging"
  });

  assert.equal(env.appVersion, "abc1234");
});
