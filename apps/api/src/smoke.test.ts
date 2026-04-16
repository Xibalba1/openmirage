import assert from "node:assert/strict";
import test from "node:test";
import { createSessionContract } from "@openmirage/auth";
import { createDatabasePool } from "@openmirage/db";
import {
  cleanupSmokeCollabFixture,
  createSmokeCollabFixture
} from "./smoke.js";

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

test("smoke collab fixture bootstrap creates and cleanup removes its resources", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const sessionContract = createSessionContract({
      sessionCookieName: "openmirage_session",
      sessionCookiePath: "/"
    });
    const fixture = await createSmokeCollabFixture(
      "smoke-secret",
      "smoke-secret",
      sessionContract,
      client
    );

    assert.equal(fixture.documentName, `page:${fixture.pageId}`);
    assert.match(
      fixture.sessionCookie,
      /^openmirage_session=[^;]+$/
    );

    const workspace = await client.query<{ id: string }>(
      `
        select id
        from workspaces
        where id = $1
      `,
      [fixture.workspaceId]
    );
    assert.equal(workspace.rows.length, 1);

    const user = await client.query<{ id: string }>(
      `
        select id
        from users
        where id = $1
      `,
      [fixture.userId]
    );
    assert.equal(user.rows.length, 1);

    await cleanupSmokeCollabFixture(
      "smoke-secret",
      "smoke-secret",
      {
        userId: fixture.userId,
        workspaceId: fixture.workspaceId
      },
      client
    );

    const deletedWorkspace = await client.query<{ id: string }>(
      `
        select id
        from workspaces
        where id = $1
      `,
      [fixture.workspaceId]
    );
    assert.equal(deletedWorkspace.rows.length, 0);

    const deletedUser = await client.query<{ id: string }>(
      `
        select id
        from users
        where id = $1
      `,
      [fixture.userId]
    );
    assert.equal(deletedUser.rows.length, 0);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});

test("smoke collab fixture rejects invalid shared secrets before touching the database", async () => {
  await assert.rejects(
    () =>
      createSmokeCollabFixture(
        "expected-secret",
        "wrong-secret",
        createSessionContract(),
        undefined
      ),
    /invalid smoke test secret/
  );
});
