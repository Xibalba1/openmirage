import assert from "node:assert/strict";
import test from "node:test";
import {
  createDatabasePool,
  createFileWithPages,
  createProject
} from "@openmirage/db";
import { type AuthContext, type CollabPageSessionDto } from "@openmirage/types";
import { resolveCollabPageSession } from "./collab-session.js";

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
  userId: string
) {
  await client.query(
    `
      insert into memberships (workspace_id, user_id, role)
      values ($1, $2, 'owner')
    `,
    [workspaceId, userId]
  );
}

function createAuthContext(userId: string, workspaceId: string): AuthContext {
  return {
    memberships: [
      {
        id: "membership-id",
        role: "owner",
        workspaceId
      }
    ],
    session: {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      id: "session-id"
    },
    user: {
      avatarUrl: null,
      displayName: "Visible User",
      email: "visible@example.com",
      id: userId
    }
  };
}

test("resolveCollabPageSession returns 401, 403, 404, and 200 for the collab bootstrap flow", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const visibleUserId = await insertUser(
      client,
      `api-visible-${Date.now()}@example.com`,
      "Visible User"
    );
    const otherUserId = await insertUser(
      client,
      `api-other-${Date.now()}@example.com`,
      "Other User"
    );
    const workspaceId = await insertWorkspace(
      client,
      "API Workspace",
      `api-${Date.now()}`
    );
    const otherWorkspaceId = await insertWorkspace(
      client,
      "API Other Workspace",
      `api-other-${Date.now()}`
    );

    await insertMembership(client, workspaceId, visibleUserId);
    await insertMembership(client, otherWorkspaceId, otherUserId);

    const project = await createProject(
      visibleUserId,
      workspaceId,
      "API Project",
      client as Parameters<typeof createProject>[3]
    );
    const file = await createFileWithPages(
      visibleUserId,
      workspaceId,
      project?.id as string,
      "API File",
      [{ name: "Page One" }],
      client as Parameters<typeof createFileWithPages>[5]
    );

    const pageId = file?.pages[0]?.id as string;
    const fileId = file?.file.id as string;

    const unauthenticated = await resolveCollabPageSession(
      null,
      { fileId, pageId, workspaceId },
      client
    );
    assert.equal(unauthenticated.status, 401);

    const forbidden = await resolveCollabPageSession(
      createAuthContext(otherUserId, otherWorkspaceId),
      { fileId, pageId, workspaceId },
      client
    );
    assert.equal(forbidden.status, 403);

    const notFound = await resolveCollabPageSession(
      createAuthContext(visibleUserId, workspaceId),
      { fileId, pageId: "00000000-0000-0000-0000-000000000000", workspaceId },
      client
    );
    assert.equal(notFound.status, 404);

    const success = await resolveCollabPageSession(
      createAuthContext(visibleUserId, workspaceId),
      { fileId, pageId, workspaceId },
      client
    );
    assert.equal(success.status, 200);
    if (success.status !== 200) {
      throw new Error("expected a successful collab session resolution");
    }
    const session = success.body as CollabPageSessionDto;
    assert.equal(session.pageId, pageId);
    assert.equal(session.fileId, fileId);
    assert.equal(session.workspaceId, workspaceId);
    assert.equal(session.documentName, `page:${pageId}`);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});
