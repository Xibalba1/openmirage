import assert from "node:assert/strict";
import test from "node:test";
import {
  createComment,
  createDatabasePool,
  createFileWithPages,
  createProject,
  listComments,
  resolveComment
} from "@openmirage/db";
import * as Y from "yjs";
import { PgCollabPersistence } from "./persistence.js";

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
    await pool.query("select 1 from collab_page_updates limit 1");
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

function setDocText(document: Y.Doc, value: string): Uint8Array {
  const text = document.getText("content");
  document.transact(() => {
    text.delete(0, text.length);
    text.insert(0, value);
  });
  return Y.encodeStateAsUpdate(document);
}

function readDocText(document: Y.Doc): string {
  return document.getText("content").toString();
}

test("PgCollabPersistence reloads stored updates, compacts snapshots, and isolates pages", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const userId = await insertUser(
      client,
      `collab-persist-${Date.now()}@example.com`,
      "Persist User"
    );
    const workspaceId = await insertWorkspace(
      client,
      "Persist Workspace",
      `persist-${Date.now()}`
    );
    await insertMembership(client, workspaceId, userId);

    const project = await createProject(
      userId,
      workspaceId,
      "Persist Project",
      client as Parameters<typeof createProject>[3]
    );
    const file = await createFileWithPages(
      userId,
      workspaceId,
      project?.id as string,
      "Persist File",
      [{ name: "Page A" }, { name: "Page B" }],
      client as Parameters<typeof createFileWithPages>[5]
    );

    const pageAId = file?.pages[0]?.id as string;
    const pageBId = file?.pages[1]?.id as string;
    const persistence = new PgCollabPersistence(client, {
      compactionThreshold: 2
    });

    const empty = await persistence.loadPageDocument(pageAId);
    assert.equal(readDocText(empty.document), "");

    const firstDoc = new Y.Doc();
    let update = setDocText(firstDoc, "hello");
    await persistence.appendUpdate(pageAId, update);

    let reloaded = await persistence.loadPageDocument(pageAId);
    assert.equal(readDocText(reloaded.document), "hello");

    update = setDocText(firstDoc, "hello world");
    await persistence.appendUpdate(pageAId, update);
    const compacted = await persistence.compactPageDocument(pageAId, firstDoc);
    assert.equal(compacted, true);
    assert.equal(await persistence.getPageUpdateCount(pageAId), 0);

    reloaded = await persistence.loadPageDocument(pageAId);
    assert.equal(readDocText(reloaded.document), "hello world");

    const secondDoc = new Y.Doc();
    const secondUpdate = setDocText(secondDoc, "other page");
    await persistence.appendUpdate(pageBId, secondUpdate);

    const isolated = await persistence.loadPageDocument(pageBId);
    assert.equal(readDocText(isolated.document), "other page");

    const original = await persistence.loadPageDocument(pageAId);
    assert.equal(readDocText(original.document), "hello world");
  });

  if (!ran) {
    t.skip("database unavailable or collab migrations not applied");
  }
});

test("comments stay relational and do not mutate persisted collab page state", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const userId = await insertUser(
      client,
      `collab-comments-${Date.now()}@example.com`,
      "Comment Persist User"
    );
    const workspaceId = await insertWorkspace(
      client,
      "Comment Persist Workspace",
      `collab-comments-${Date.now()}`
    );
    await insertMembership(client, workspaceId, userId);

    const project = await createProject(
      userId,
      workspaceId,
      "Comment Persist Project",
      client as Parameters<typeof createProject>[3]
    );
    const file = await createFileWithPages(
      userId,
      workspaceId,
      project?.id as string,
      "Comment Persist File",
      [{ name: "Page A" }, { name: "Page B" }],
      client as Parameters<typeof createFileWithPages>[5]
    );

    const fileId = file?.file.id as string;
    const pageAId = file?.pages[0]?.id as string;
    const persistence = new PgCollabPersistence(client);
    const pageDoc = new Y.Doc();
    const update = setDocText(pageDoc, "page-state-before-comments");
    await persistence.appendUpdate(pageAId, update);
    const initialUpdateCount = await persistence.getPageUpdateCount(pageAId);

    const fileComment = await createComment(
      userId,
      workspaceId,
      project?.id as string,
      {
        body: "File comment",
        target: {
          fileId,
          type: "file"
        }
      },
      client as Parameters<typeof createComment>[4]
    );
    const pageComment = await createComment(
      userId,
      workspaceId,
      project?.id as string,
      {
        body: "Page comment",
        target: {
          fileId,
          pageId: pageAId,
          type: "page"
        }
      },
      client as Parameters<typeof createComment>[4]
    );
    const nodeComment = await createComment(
      userId,
      workspaceId,
      project?.id as string,
      {
        body: "Node comment",
        target: {
          fileId,
          nodeId: "rect-1",
          pageId: pageAId,
          type: "node"
        }
      },
      client as Parameters<typeof createComment>[4]
    );

    assert.ok(fileComment);
    assert.ok(pageComment);
    assert.ok(nodeComment);

    const listed = await listComments(
      userId,
      workspaceId,
      project?.id as string,
      {
        fileId,
        includeResolved: true,
        pageId: pageAId
      },
      client as Parameters<typeof listComments>[4]
    );
    assert.deepEqual(
      listed?.map((comment) => comment.body),
      ["File comment", "Page comment", "Node comment"]
    );

    const resolved = await resolveComment(
      userId,
      workspaceId,
      project?.id as string,
      {
        commentId: nodeComment?.id as string,
        fileId
      },
      client as Parameters<typeof resolveComment>[4]
    );
    assert.ok(resolved?.resolvedAt);

    const reloaded = await persistence.loadPageDocument(pageAId);
    assert.equal(readDocText(reloaded.document), "page-state-before-comments");
    assert.equal(
      await persistence.getPageUpdateCount(pageAId),
      initialUpdateCount
    );
  });

  if (!ran) {
    t.skip("database unavailable or collab migrations not applied");
  }
});
