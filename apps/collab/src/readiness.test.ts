import assert from "node:assert/strict";
import test from "node:test";
import { inspectApiDependency } from "./readiness.js";

test("inspectApiDependency treats 401 as a healthy auth/session boundary", async () => {
  const result = await inspectApiDependency(
    "http://api.local",
    "/auth",
    async () => new Response(null, { status: 401 })
  );

  assert.equal(result.ok, true);
});

test("inspectApiDependency fails when the auth/session boundary is unreachable", async () => {
  const result = await inspectApiDependency(
    "http://api.local",
    "/auth",
    async () => {
      throw new Error("connect ECONNREFUSED");
    }
  );

  assert.equal(result.ok, false);
  assert.match(result.summary, /ECONNREFUSED/);
});
