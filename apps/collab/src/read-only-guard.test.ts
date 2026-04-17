import assert from "node:assert/strict";
import test from "node:test";
import { assertSyncAllowedForAccess } from "./read-only-guard.js";

test("assertSyncAllowedForAccess rejects Yjs updates on read-only connections only", () => {
  assert.doesNotThrow(() => {
    assertSyncAllowedForAccess({
      connection: {
        readOnly: true
      },
      type: 0
    });
  });

  assert.doesNotThrow(() => {
    assertSyncAllowedForAccess({
      connection: {
        readOnly: false
      },
      type: 2
    });
  });

  assert.throws(
    () =>
      assertSyncAllowedForAccess({
        connection: {
          readOnly: true
        },
        type: 2
      }),
    /read_only_update_forbidden/
  );
});
