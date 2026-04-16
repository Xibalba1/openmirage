import assert from "node:assert/strict";
import test from "node:test";
import {
  createDatabasePool,
  createFileWithPages,
  createProject
} from "@openmirage/db";
import { type AuthContext, type CommentDto } from "@openmirage/types";
import {
  resolveCreateCommentRequest,
  resolveListCommentsRequest,
  resolveResolveCommentRequest
} from "./comments.js";

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
      displayName: "Comment User",
      email: "comment-user@example.com",
      id: userId
    }
  };
}

test("comment request helpers enforce auth, target validation, and resolve flow", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const userId = await insertUser(
      client,
      `comment-api-${Date.now()}@example.com`,
      "Comment User"
    );
    const otherUserId = await insertUser(
      client,
      `comment-api-other-${Date.now()}@example.com`,
      "Other User"
    );
    const workspaceId = await insertWorkspace(
      client,
      "Comment API Workspace",
      `comment-api-${Date.now()}`
    );
    const otherWorkspaceId = await insertWorkspace(
      client,
      "Comment API Other Workspace",
      `comment-api-other-${Date.now()}`
    );

    await insertMembership(client, workspaceId, userId);
    await insertMembership(client, otherWorkspaceId, otherUserId);

    const project = await createProject(
      userId,
      workspaceId,
      "Comment API Project",
      client as Parameters<typeof createProject>[3]
    );
    const file = await createFileWithPages(
      userId,
      workspaceId,
      project?.id as string,
      "Comment API File",
      [{ name: "Page One" }],
      client as Parameters<typeof createFileWithPages>[5]
    );

    const fileId = file?.file.id as string;
    const pageId = file?.pages[0]?.id as string;

    const unauthenticatedList = await resolveListCommentsRequest(
      null,
      {
        fileId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(unauthenticatedList.status, 401);

    const forbiddenCreate = await resolveCreateCommentRequest(
      createAuthContext(otherUserId, otherWorkspaceId),
      {
        body: {
          body: "Hidden",
          target: {
            fileId,
            type: "file"
          }
        },
        fileId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(forbiddenCreate.status, 403);

    const invalidTarget = await resolveCreateCommentRequest(
      createAuthContext(userId, workspaceId),
      {
        body: {
          body: "Broken",
          target: {
            fileId,
            nodeId: "node-1",
            type: "page"
          }
        },
        fileId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(invalidTarget.status, 400);

    const created = await resolveCreateCommentRequest(
      createAuthContext(userId, workspaceId),
      {
        body: {
          body: "Looks good",
          target: {
            fileId,
            pageId,
            type: "page"
          }
        },
        fileId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(created.status, 201);
    if (created.status !== 201) {
      throw new Error("expected comment create success");
    }
    const createdComment = created.body as CommentDto;

    const fileScoped = await resolveCreateCommentRequest(
      createAuthContext(userId, workspaceId),
      {
        body: {
          body: "Whole file note",
          target: {
            fileId,
            type: "file"
          }
        },
        fileId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(fileScoped.status, 201);

    const nodeScoped = await resolveCreateCommentRequest(
      createAuthContext(userId, workspaceId),
      {
        body: {
          body: "Node note",
          target: {
            fileId,
            nodeId: "rect-1",
            pageId,
            type: "node"
          }
        },
        fileId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(nodeScoped.status, 201);

    const listed = await resolveListCommentsRequest(
      createAuthContext(userId, workspaceId),
      {
        fileId,
        includeResolved: "false",
        pageId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(listed.status, 200);
    if (listed.status !== 200) {
      throw new Error("expected list success");
    }
    assert.deepEqual(
      (listed.body as { comments: CommentDto[] }).comments.map(
        (comment) => comment.body
      ),
      ["Whole file note", "Looks good", "Node note"]
    );

    const resolved = await resolveResolveCommentRequest(
      createAuthContext(userId, workspaceId),
      {
        commentId: createdComment.id,
        fileId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(resolved.status, 200);
    if (resolved.status !== 200) {
      throw new Error("expected resolve success");
    }
    assert.ok((resolved.body as CommentDto).resolvedAt);

    const missingResolve = await resolveResolveCommentRequest(
      createAuthContext(userId, workspaceId),
      {
        commentId: "00000000-0000-0000-0000-000000000000",
        fileId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(missingResolve.status, 404);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});
