import assert from "node:assert/strict";
import test from "node:test";
import { authorizeCollabConnection, rewriteRequestUrlWithDocumentName } from "./collab-auth.js";

test("authorizeCollabConnection rejects missing identity and mismatched document names", async () => {
  const missingIdentity = await authorizeCollabConnection(
    { pageId: "page-1" },
    {
      apiBaseUrl: "http://api.local",
      cookieHeader: "session=abc"
    }
  );
  assert.equal(missingIdentity.ok, false);
  if (missingIdentity.ok) {
    throw new Error("expected authorization failure");
  }
  assert.equal(missingIdentity.status, 400);

  const invalidDocumentName = await authorizeCollabConnection(
    {
      documentName: "workspace:abc",
      fileId: "file-1",
      pageId: "page-1",
      workspaceId: "workspace-1"
    },
    {
      apiBaseUrl: "http://api.local",
      cookieHeader: "session=abc"
    }
  );
  assert.equal(invalidDocumentName.ok, false);
  if (invalidDocumentName.ok) {
    throw new Error("expected authorization failure");
  }
  assert.equal(invalidDocumentName.status, 400);
});

test("authorizeCollabConnection maps auth responses and accepts a valid page session", async () => {
  const statuses = [401, 403, 404, 500] as const;

  for (const status of statuses) {
    const result = await authorizeCollabConnection(
      {
        fileId: "file-1",
        pageId: "page-1",
        workspaceId: "workspace-1"
      },
      {
        apiBaseUrl: "http://api.local",
        cookieHeader: "session=abc",
        fetchImpl: async () =>
          new Response(
            status === 500 ? "oops" : JSON.stringify({ error: "failure" }),
            { status }
          )
      }
    );

    assert.equal(result.ok, false);
    if (result.ok) {
      throw new Error("expected authorization failure");
    }
    assert.equal(
      result.status,
      status === 500 ? 503 : status
    );
  }

  const success = await authorizeCollabConnection(
    {
      fileId: "file-1",
      pageId: "page-1",
      workspaceId: "workspace-1"
    },
    {
      apiBaseUrl: "http://api.local",
      cookieHeader: "session=abc",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            documentName: "page:page-1",
            fileId: "file-1",
            pageId: "page-1",
            user: {
              avatarUrl: null,
              displayName: "Visible User",
              email: "visible@example.com",
              id: "user-1"
            },
            workspaceId: "workspace-1"
          }),
          { status: 200 }
        )
    }
  );

  assert.equal(success.ok, true);
  if (!success.ok) {
    throw new Error("expected authorization success");
  }
  assert.equal(success.session.documentName, "page:page-1");
});

test("rewriteRequestUrlWithDocumentName preserves page identity and injects the canonical doc", () => {
  const rewritten = rewriteRequestUrlWithDocumentName(
    "/collab?pageId=page-1&fileId=file-1&workspaceId=workspace-1",
    "page:page-1",
    "http://localhost:4100"
  );

  assert.equal(
    rewritten,
    "/collab?pageId=page-1&fileId=file-1&workspaceId=workspace-1&documentName=page%3Apage-1"
  );
});
