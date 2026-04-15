import assert from "node:assert/strict";
import test from "node:test";
import { type PoolClient } from "pg";
import {
  createDatabasePool,
  createFileWithPages,
  createPage,
  getAuthorizedCollabPageSession,
  listAuthorizedWorkspaces,
  listWorkspaceProjects,
  renameProject
} from "./index.js";

async function withDatabaseTransaction(
  callback: (client: PoolClient) => Promise<void>
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

async function insertUser(client: PoolClient, email: string, displayName: string) {
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

async function insertWorkspace(client: PoolClient, name: string, slug: string) {
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
  client: PoolClient,
  workspaceId: string,
  userId: string,
  role: "owner" | "editor" | "viewer" = "owner"
) {
  const result = await client.query<{ id: string }>(
    `
      insert into memberships (workspace_id, user_id, role)
      values ($1, $2, $3)
      returning id
    `,
    [workspaceId, userId, role]
  );

  return result.rows[0]?.id as string;
}

async function insertProject(
  client: PoolClient,
  workspaceId: string,
  name: string
) {
  const result = await client.query<{ id: string }>(
    `
      insert into projects (workspace_id, name)
      values ($1, $2)
      returning id
    `,
    [workspaceId, name]
  );

  return result.rows[0]?.id as string;
}

test("listAuthorizedWorkspaces and listWorkspaceProjects stay membership-scoped", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const visibleUserId = await insertUser(
      client,
      `visible-${Date.now()}@example.com`,
      "Visible User"
    );
    const hiddenUserId = await insertUser(
      client,
      `hidden-${Date.now()}@example.com`,
      "Hidden User"
    );
    const visibleWorkspaceId = await insertWorkspace(
      client,
      "Visible Workspace",
      `visible-${Date.now()}`
    );
    const hiddenWorkspaceId = await insertWorkspace(
      client,
      "Hidden Workspace",
      `hidden-${Date.now()}`
    );

    await insertMembership(client, visibleWorkspaceId, visibleUserId, "owner");
    await insertMembership(client, hiddenWorkspaceId, hiddenUserId, "owner");
    const projectId = await insertProject(client, visibleWorkspaceId, "Visible Project");

    const workspaces = await listAuthorizedWorkspaces(visibleUserId, client);
    assert.equal(workspaces.length, 1);
    assert.equal(workspaces[0]?.id, visibleWorkspaceId);

    const visibleProjects = await listWorkspaceProjects(
      visibleUserId,
      visibleWorkspaceId,
      client
    );
    assert.equal(visibleProjects?.projects.length, 1);
    assert.equal(visibleProjects?.projects[0]?.id, projectId);

    const hiddenProjects = await listWorkspaceProjects(
      visibleUserId,
      hiddenWorkspaceId,
      client
    );
    assert.equal(hiddenProjects, null);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});

test("createFileWithPages preserves initial page order and createPage appends", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const userId = await insertUser(client, `pages-${Date.now()}@example.com`, "Page User");
    const workspaceId = await insertWorkspace(
      client,
      "Pages Workspace",
      `pages-${Date.now()}`
    );

    await insertMembership(client, workspaceId, userId, "owner");
    const projectId = await insertProject(client, workspaceId, "Pages Project");

    const file = await createFileWithPages(
      userId,
      workspaceId,
      projectId,
      "Flow File",
      [{ name: "Cover" }, { name: "Specs" }, { name: "QA" }],
      client
    );

    assert.ok(file);
    assert.deepEqual(
      file?.pages.map((page) => ({ name: page.name, orderIndex: page.orderIndex })),
      [
        { name: "Cover", orderIndex: 0 },
        { name: "Specs", orderIndex: 1 },
        { name: "QA", orderIndex: 2 }
      ]
    );

    const appended = await createPage(
      userId,
      workspaceId,
      projectId,
      file?.file.id as string,
      "Appendix",
      client
    );

    assert.equal(appended?.orderIndex, 3);
    assert.equal(appended?.name, "Appendix");
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});

test("renameProject does not rename projects outside the authorized workspace", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const userId = await insertUser(client, `rename-${Date.now()}@example.com`, "Rename User");
    const workspaceId = await insertWorkspace(
      client,
      "Rename Workspace",
      `rename-${Date.now()}`
    );
    const otherWorkspaceId = await insertWorkspace(
      client,
      "Other Workspace",
      `rename-other-${Date.now()}`
    );

    await insertMembership(client, workspaceId, userId, "owner");
    const visibleProjectId = await insertProject(client, workspaceId, "Visible");
    const hiddenProjectId = await insertProject(client, otherWorkspaceId, "Hidden");

    const visibleRename = await renameProject(
      userId,
      workspaceId,
      visibleProjectId,
      "Visible Renamed",
      client
    );
    assert.equal(visibleRename?.name, "Visible Renamed");

    const hiddenRename = await renameProject(
      userId,
      workspaceId,
      hiddenProjectId,
      "Should Not Rename",
      client
    );
    assert.equal(hiddenRename, null);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});

test("getAuthorizedCollabPageSession stays page/file/workspace scoped", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const visibleUserId = await insertUser(
      client,
      `collab-visible-${Date.now()}@example.com`,
      "Visible User"
    );
    const hiddenUserId = await insertUser(
      client,
      `collab-hidden-${Date.now()}@example.com`,
      "Hidden User"
    );
    const workspaceId = await insertWorkspace(
      client,
      "Collab Workspace",
      `collab-${Date.now()}`
    );
    const otherWorkspaceId = await insertWorkspace(
      client,
      "Other Workspace",
      `collab-other-${Date.now()}`
    );

    await insertMembership(client, workspaceId, visibleUserId, "owner");
    await insertMembership(client, otherWorkspaceId, hiddenUserId, "owner");

    const projectId = await insertProject(client, workspaceId, "Collab Project");
    const otherProjectId = await insertProject(
      client,
      otherWorkspaceId,
      "Other Project"
    );

    const visibleFile = await createFileWithPages(
      visibleUserId,
      workspaceId,
      projectId,
      "Visible File",
      [{ name: "Page A" }, { name: "Page B" }],
      client
    );
    const hiddenFile = await createFileWithPages(
      hiddenUserId,
      otherWorkspaceId,
      otherProjectId,
      "Hidden File",
      [{ name: "Page Hidden" }],
      client
    );

    const visiblePageId = visibleFile?.pages[0]?.id as string;
    const otherVisiblePageId = visibleFile?.pages[1]?.id as string;
    const visibleFileId = visibleFile?.file.id as string;
    const hiddenPageId = hiddenFile?.pages[0]?.id as string;

    const visibleSession = await getAuthorizedCollabPageSession(
      visibleUserId,
      workspaceId,
      visibleFileId,
      visiblePageId,
      client
    );
    assert.equal(visibleSession?.pageId, visiblePageId);
    assert.equal(visibleSession?.fileId, visibleFileId);
    assert.equal(visibleSession?.workspaceId, workspaceId);

    const wrongPage = await getAuthorizedCollabPageSession(
      visibleUserId,
      workspaceId,
      visibleFileId,
      hiddenPageId,
      client
    );
    assert.equal(wrongPage, null);

    const wrongVisiblePage = await getAuthorizedCollabPageSession(
      visibleUserId,
      workspaceId,
      hiddenFile?.file.id as string,
      otherVisiblePageId,
      client
    );
    assert.equal(wrongVisiblePage, null);

    const nonMember = await getAuthorizedCollabPageSession(
      hiddenUserId,
      workspaceId,
      visibleFileId,
      visiblePageId,
      client
    );
    assert.equal(nonMember, null);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});
