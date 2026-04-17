import assert from "node:assert/strict";
import test from "node:test";
import {
  createDatabasePool,
  createFileWithPages,
  createProject
} from "@openmirage/db";
import {
  type AuthContext,
  type CollabPageSessionDto,
  type CreatedShareLinkResponse,
  type ShareLinkDto,
  type SharedFileOpenResponse
} from "@openmirage/types";
import {
  resolveCreateShareLinkRequest,
  resolveListShareLinksRequest,
  resolvePublicShareCollabSessionRequest,
  resolvePublicShareLinkRequest,
  resolveRevokeShareLinkRequest
} from "./share-links.js";

interface DatabaseClient {
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
}

async function withDatabaseTransaction(
  callback: (client: DatabaseClient) => Promise<void>
) {
  const pool = createDatabasePool();

  try {
    await pool.query("select 1");
  } catch {
    await pool.end();
    return false;
  }

  const client = await pool.connect();

  try {
    await client.query("begin");
    await callback(client);
  } finally {
    await client.query("rollback");
    client.release();
    await pool.end();
  }

  return true;
}

async function insertUser(
  client: DatabaseClient,
  email: string,
  displayName: string
) {
  const result = await client.query<{ id: string }>(
    `
      insert into users (email, display_name)
      values ($1, $2)
      returning id
    `,
    [email, displayName]
  );

  return result.rows[0]?.id as string;
}

async function insertWorkspace(
  client: DatabaseClient,
  name: string,
  slug: string
) {
  const result = await client.query<{ id: string }>(
    `
      insert into workspaces (name, slug)
      values ($1, $2)
      returning id
    `,
    [name, slug]
  );

  return result.rows[0]?.id as string;
}

async function insertMembership(
  client: DatabaseClient,
  workspaceId: string,
  userId: string,
  role: "owner" | "editor" | "viewer" = "owner"
) {
  await client.query(
    `
      insert into memberships (workspace_id, user_id, role)
      values ($1, $2, $3)
    `,
    [workspaceId, userId, role]
  );
}

function createAuthContext(
  userId: string,
  workspaceId: string,
  role: "owner" | "editor" | "viewer" = "owner"
): AuthContext {
  return {
    memberships: [
      {
        id: "membership-id",
        role,
        workspaceId
      }
    ],
    session: {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      id: "session-id"
    },
    user: {
      avatarUrl: null,
      displayName: "Share User",
      email: "share-user@example.com",
      id: userId
    }
  };
}

test("share link request helpers enforce writable access and resolve public shared file state", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const ownerUserId = await insertUser(
      client,
      `share-owner-${Date.now()}@example.com`,
      "Share Owner"
    );
    const viewerUserId = await insertUser(
      client,
      `share-viewer-${Date.now()}@example.com`,
      "Share Viewer"
    );
    const otherUserId = await insertUser(
      client,
      `share-other-${Date.now()}@example.com`,
      "Share Other"
    );
    const workspaceId = await insertWorkspace(
      client,
      "Share API Workspace",
      `share-api-${Date.now()}`
    );
    const otherWorkspaceId = await insertWorkspace(
      client,
      "Share API Other Workspace",
      `share-api-other-${Date.now()}`
    );

    await insertMembership(client, workspaceId, ownerUserId, "owner");
    await insertMembership(client, workspaceId, viewerUserId, "viewer");
    await insertMembership(client, otherWorkspaceId, otherUserId, "owner");

    const project = await createProject(
      ownerUserId,
      workspaceId,
      "Share API Project",
      client as Parameters<typeof createProject>[3]
    );
    const file = await createFileWithPages(
      ownerUserId,
      workspaceId,
      project?.id as string,
      "Share API File",
      [{ name: "Page One" }, { name: "Page Two" }],
      client as Parameters<typeof createFileWithPages>[5]
    );

    const fileId = file?.file.id as string;
    const pageId = file?.pages[0]?.id as string;

    const unauthenticatedList = await resolveListShareLinksRequest(
      null,
      {
        fileId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(unauthenticatedList.status, 401);

    const viewerList = await resolveListShareLinksRequest(
      createAuthContext(viewerUserId, workspaceId, "viewer"),
      {
        fileId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(viewerList.status, 403);

    const viewerCreate = await resolveCreateShareLinkRequest(
      createAuthContext(viewerUserId, workspaceId, "viewer"),
      {
        fileId,
        projectId: project?.id as string,
        workspaceId
      },
      client,
      "https://app.test"
    );
    assert.equal(viewerCreate.status, 403);

    const forbiddenCreate = await resolveCreateShareLinkRequest(
      createAuthContext(otherUserId, otherWorkspaceId),
      {
        fileId,
        projectId: project?.id as string,
        workspaceId
      },
      client,
      "https://app.test"
    );
    assert.equal(forbiddenCreate.status, 403);

    const created = await resolveCreateShareLinkRequest(
      createAuthContext(ownerUserId, workspaceId),
      {
        fileId,
        projectId: project?.id as string,
        workspaceId
      },
      client,
      "https://app.test"
    );
    assert.equal(created.status, 201);
    if (created.status !== 201) {
      throw new Error("expected share link create success");
    }
    const createdShareLink = created.body as CreatedShareLinkResponse;
    assert.equal(createdShareLink.shareLink.fileId, fileId);
    assert.equal(
      createdShareLink.shareLink.shareUrl,
      `https://app.test/share/${createdShareLink.token}`
    );

    const listed = await resolveListShareLinksRequest(
      createAuthContext(ownerUserId, workspaceId),
      {
        fileId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(listed.status, 200);
    if (listed.status !== 200 || !("shareLinks" in listed.body)) {
      throw new Error("expected share link list success");
    }
    assert.equal(listed.body.shareLinks.length, 1);
    assert.equal(listed.body.shareLinks[0]?.id, createdShareLink.shareLink.id);

    const publicFile = await resolvePublicShareLinkRequest(
      {
        token: createdShareLink.token
      },
      client
    );
    assert.equal(publicFile.status, 200);
    if (publicFile.status !== 200) {
      throw new Error("expected shared file open success");
    }
    const sharedFile = publicFile.body as SharedFileOpenResponse;
    assert.equal(sharedFile.access.mode, "read-only");
    assert.equal(sharedFile.access.source, "share-link");
    assert.equal(sharedFile.file.id, fileId);
    assert.equal(sharedFile.defaultPageId, pageId);

    const publicPage = await resolvePublicShareLinkRequest(
      {
        pageId,
        token: createdShareLink.token
      },
      client
    );
    assert.equal(publicPage.status, 200);
    if (publicPage.status !== 200) {
      throw new Error("expected shared page open success");
    }
    const sharedPage = publicPage.body as SharedFileOpenResponse;
    assert.equal(sharedPage.defaultPageId, pageId);

    const missingPublicPage = await resolvePublicShareLinkRequest(
      {
        pageId: "00000000-0000-0000-0000-000000000000",
        token: createdShareLink.token
      },
      client
    );
    assert.equal(missingPublicPage.status, 404);

    const publicSession = await resolvePublicShareCollabSessionRequest(
      {
        pageId,
        token: createdShareLink.token
      },
      client
    );
    assert.equal(publicSession.status, 200);
    if (publicSession.status !== 200) {
      throw new Error("expected shared collab session success");
    }
    const sharedSession = publicSession.body as CollabPageSessionDto;
    assert.equal(sharedSession.access.mode, "read-only");

    const revoked = await resolveRevokeShareLinkRequest(
      createAuthContext(ownerUserId, workspaceId),
      {
        fileId,
        projectId: project?.id as string,
        shareLinkId: createdShareLink.shareLink.id,
        workspaceId
      },
      client
    );
    assert.equal(revoked.status, 200);
    if (revoked.status !== 200) {
      throw new Error("expected share link revoke success");
    }
    const revokedShareLink = revoked.body as ShareLinkDto;
    assert.ok(revokedShareLink.revokedAt);

    const revokedPublicFile = await resolvePublicShareLinkRequest(
      {
        token: createdShareLink.token
      },
      client
    );
    assert.equal(revokedPublicFile.status, 404);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});
