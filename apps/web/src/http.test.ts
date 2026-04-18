import assert from "node:assert/strict";
import test from "node:test";
import { buildJsonRequestHeaders } from "./http";

test("buildJsonRequestHeaders omits content-type for empty-body requests", () => {
  const headers = buildJsonRequestHeaders({
    method: "POST"
  });

  assert.equal(headers.has("content-type"), false);
});

test("buildJsonRequestHeaders defaults content-type for json requests", () => {
  const headers = buildJsonRequestHeaders({
    body: JSON.stringify({ ok: true }),
    method: "POST"
  });

  assert.equal(headers.get("content-type"), "application/json");
});

test("buildJsonRequestHeaders preserves explicit content-type", () => {
  const headers = buildJsonRequestHeaders({
    body: JSON.stringify({ ok: true }),
    headers: {
      "content-type": "application/merge-patch+json"
    },
    method: "PATCH"
  });

  assert.equal(headers.get("content-type"), "application/merge-patch+json");
});
