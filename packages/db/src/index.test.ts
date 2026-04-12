import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DATABASE_URL, resolveDatabaseUrl } from "./client.js";
import { hashToken } from "./seed.js";

test("hashToken is deterministic and non-plaintext", () => {
  const token = "openmirage-dev-token";

  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), token);
  assert.equal(hashToken(token).length, 64);
});

test("resolveDatabaseUrl falls back to the local default", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;

  delete process.env.DATABASE_URL;

  try {
    assert.equal(resolveDatabaseUrl(undefined), DEFAULT_DATABASE_URL);
    assert.equal(
      resolveDatabaseUrl("postgres://custom.example/openmirage"),
      "postgres://custom.example/openmirage"
    );
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});
