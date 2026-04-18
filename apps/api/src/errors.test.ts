import assert from "node:assert/strict";
import test from "node:test";
import { buildApiErrorResponse } from "./errors.js";

test("buildApiErrorResponse preserves generic client errors as 4xx", () => {
  const response = buildApiErrorResponse(
    { statusCode: 400 },
    200
  );

  assert.deepEqual(response, {
    error: "bad_request",
    statusCode: 400
  });
});

test("buildApiErrorResponse maps auth and not-found errors", () => {
  assert.deepEqual(buildApiErrorResponse({ statusCode: 401 }, 200), {
    error: "unauthenticated",
    statusCode: 401
  });
  assert.deepEqual(buildApiErrorResponse({ statusCode: 403 }, 200), {
    error: "forbidden",
    statusCode: 403
  });
  assert.deepEqual(buildApiErrorResponse({ statusCode: 404 }, 200), {
    error: "not_found",
    statusCode: 404
  });
});

test("buildApiErrorResponse preserves unsupported media type handling", () => {
  const error = new Error("invalid media type") as Error & { code?: string };
  error.code = "FST_ERR_CTP_INVALID_MEDIA_TYPE";

  assert.deepEqual(buildApiErrorResponse(error, 200), {
    error: "unsupported_media_type",
    statusCode: 415
  });
});

test("buildApiErrorResponse keeps server failures as internal_error", () => {
  assert.deepEqual(buildApiErrorResponse(new Error("boom"), 200), {
    error: "internal_error",
    statusCode: 500
  });
});
