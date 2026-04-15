import assert from "node:assert/strict";
import test from "node:test";
import { createDatabasePool, createFileWithPages, createProject } from "@openmirage/db";
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
