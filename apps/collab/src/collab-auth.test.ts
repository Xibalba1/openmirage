import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeCollabConnection,
  buildSharedCollabRequestUrl,
  rewriteRequestUrlWithDocumentName
} from "./collab-auth.js";

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
            access: {
              canComment: true,
              canManageShareLinks: true,
              canMutate: true,
              mode: "writable",
              role: "owner",
              source: "membership"
            },
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
  assert.equal(success.session.access.mode, "writable");
});

test("authorizeCollabConnection uses public share sessions for share-token requests", async () => {
  const requestedUrls: string[] = [];
  const result = await authorizeCollabConnection(
    {
      pageId: "page-1",
      shareToken: "share-token-1"
    },
    {
      apiBaseUrl: "http://api.local",
      cookieHeader: "",
      fetchImpl: async (input) => {
        requestedUrls.push(String(input));

        return new Response(
          JSON.stringify({
            access: {
              canComment: false,
              canManageShareLinks: false,
              canMutate: false,
              mode: "read-only",
              role: null,
              source: "share-link"
            },
            documentName: "page:page-1",
            fileId: "file-1",
            pageId: "page-1",
            user: {
              avatarUrl: null,
              displayName: "Shared viewer",
              email: "viewer@example.com",
              id: "share-user-1"
            },
            workspaceId: "workspace-1"
          }),
          { status: 200 }
        );
      }
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("expected shared authorization success");
  }
  assert.deepEqual(requestedUrls, [
    "http://api.local/v1/share-links/share-token-1/pages/page-1/collab-session"
  ]);
  assert.equal(result.session.access.mode, "read-only");
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

test("buildSharedCollabRequestUrl targets the public share collab bootstrap endpoint", () => {
  assert.equal(
    buildSharedCollabRequestUrl({
      baseUrl: "https://api.example.test",
      pageId: "page-1",
      token: "share token"
    }),
    "https://api.example.test/v1/share-links/share%20token/pages/page-1/collab-session"
  );
});
