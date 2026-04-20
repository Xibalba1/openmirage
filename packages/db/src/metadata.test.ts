import assert from "node:assert/strict";
import test from "node:test";
import { type PoolClient } from "pg";
import {
  createAsset,
  createComment,
  createDatabasePool,
  createDerivedAssetRecord,
  createExportJob,
  createFileWithPages,
  createFileShareLink,
  createPage,
  claimNextQueuedExportJob,
  failStaleRunningExportJobs,
  findNextFileMissingThumbnail,
  findNextPageMissingThumbnail,
  getFileOpenDetails,
  getWorkspaceLaunchpad,
  getAuthorizedCollabPageSession,
  getAuthorizedExportJob,
  getAuthorizedAsset,
  getSharedCollabPageSession,
  getSharedFileOpenDetails,
  hardDeleteAssetRecord,
  listAuthorizedWorkspaces,
  listDeletedThumbnailAssetsForCleanup,
  listFileShareLinks,
  listSharedAssets,
  listAssets,
  markAssetDeleted,
  markExportJobFailed,
  markExportJobSucceeded,
  listComments,
  listWorkspaceProjects,
  replaceFileThumbnailAsset,
  replacePageThumbnailAsset,
  resolveComment,
  revokeFileShareLink,
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

async function insertUser(
  client: PoolClient,
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
    const projectId = await insertProject(
      client,
      visibleWorkspaceId,
      "Visible Project"
    );

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

test("getWorkspaceLaunchpad groups files by project with default pages and page counts", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const visibleUserId = await insertUser(
      client,
      `launchpad-visible-${Date.now()}@example.com`,
      "Launchpad Visible User"
    );
    const hiddenUserId = await insertUser(
      client,
      `launchpad-hidden-${Date.now()}@example.com`,
      "Launchpad Hidden User"
    );
    const workspaceId = await insertWorkspace(
      client,
      "Launchpad Workspace",
      `launchpad-${Date.now()}`
    );
    const hiddenWorkspaceId = await insertWorkspace(
      client,
      "Hidden Launchpad Workspace",
      `launchpad-hidden-${Date.now()}`
    );

    await insertMembership(client, workspaceId, visibleUserId, "owner");
    await insertMembership(client, hiddenWorkspaceId, hiddenUserId, "owner");

    const firstProjectId = await insertProject(client, workspaceId, "Alpha Project");
    const secondProjectId = await insertProject(client, workspaceId, "Beta Project");
    const hiddenProjectId = await insertProject(
      client,
      hiddenWorkspaceId,
      "Hidden Project"
    );

    const alphaFile = await createFileWithPages(
      visibleUserId,
      workspaceId,
      firstProjectId,
      "Alpha File",
      [{ name: "Cover" }, { name: "Specs" }],
      client
    );
    const betaFile = await createFileWithPages(
      visibleUserId,
      workspaceId,
      secondProjectId,
      "Beta File",
      [{ name: "Only Page" }],
      client
    );
    await createFileWithPages(
      hiddenUserId,
      hiddenWorkspaceId,
      hiddenProjectId,
      "Hidden File",
      [{ name: "Secret" }],
      client
    );

    const launchpad = await getWorkspaceLaunchpad(
      visibleUserId,
      workspaceId,
      client
    );

    assert.ok(launchpad);
    assert.equal(launchpad.workspace.id, workspaceId);
    assert.equal(launchpad.projects.length, 2);
    assert.deepEqual(
      launchpad.projects.map((group: (typeof launchpad.projects)[number]) => group.project.name),
      ["Alpha Project", "Beta Project"]
    );
    assert.deepEqual(
      launchpad.projects[0]?.files.map((summary: (typeof launchpad.projects)[number]["files"][number]) => ({
        defaultPageId: summary.defaultPageId,
        name: summary.file.name,
        pageCount: summary.pageCount
      })),
      [
        {
          defaultPageId: alphaFile?.defaultPageId ?? null,
          name: "Alpha File",
          pageCount: 2
        }
      ]
    );
    assert.deepEqual(
      launchpad.projects[1]?.files.map((summary: (typeof launchpad.projects)[number]["files"][number]) => ({
        defaultPageId: summary.defaultPageId,
        name: summary.file.name,
        pageCount: summary.pageCount
      })),
      [
        {
          defaultPageId: betaFile?.defaultPageId ?? null,
          name: "Beta File",
          pageCount: 1
        }
      ]
    );

    const hiddenLaunchpad = await getWorkspaceLaunchpad(
      visibleUserId,
      hiddenWorkspaceId,
      client
    );
    assert.equal(hiddenLaunchpad, null);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});

test("createFileWithPages preserves initial page order and createPage appends", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const userId = await insertUser(
      client,
      `pages-${Date.now()}@example.com`,
      "Page User"
    );
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
      file?.pages.map((page) => ({
        name: page.name,
        orderIndex: page.orderIndex
      })),
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
    const userId = await insertUser(
      client,
      `rename-${Date.now()}@example.com`,
      "Rename User"
    );
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
    const visibleProjectId = await insertProject(
      client,
      workspaceId,
      "Visible"
    );
    const hiddenProjectId = await insertProject(
      client,
      otherWorkspaceId,
      "Hidden"
    );

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

    const projectId = await insertProject(
      client,
      workspaceId,
      "Collab Project"
    );
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

test("viewer access stays read-only while owner share links resolve shared file, assets, and collab sessions", async (t) => {
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
    const workspaceId = await insertWorkspace(
      client,
      "Share Workspace",
      `share-${Date.now()}`
    );

    await insertMembership(client, workspaceId, ownerUserId, "owner");
    await insertMembership(client, workspaceId, viewerUserId, "viewer");

    const projectId = await insertProject(client, workspaceId, "Share Project");
    const file = await createFileWithPages(
      ownerUserId,
      workspaceId,
      projectId,
      "Shared File",
      [{ name: "Page A" }],
      client
    );

    const fileId = file?.file.id as string;
    const pageId = file?.pages[0]?.id as string;

    const viewerFileOpen = await getFileOpenDetails(
      viewerUserId,
      workspaceId,
      projectId,
      fileId,
      client
    );
    assert.equal(viewerFileOpen?.access.mode, "read-only");
    assert.equal(viewerFileOpen?.access.role, "viewer");
    assert.equal(viewerFileOpen?.access.canMutate, false);

    const blockedViewerPage = await createPage(
      viewerUserId,
      workspaceId,
      projectId,
      fileId,
      "Blocked Page",
      client
    );
    assert.equal(blockedViewerPage, null);

    const blockedViewerComment = await createComment(
      viewerUserId,
      workspaceId,
      projectId,
      {
        body: "Should fail",
        target: {
          fileId,
          pageId,
          type: "page"
        }
      },
      client
    );
    assert.equal(blockedViewerComment, null);

    const blockedViewerAsset = await createAsset(
      viewerUserId,
      workspaceId,
      projectId,
      fileId,
      {
        byteSize: 128,
        filename: "blocked.png",
        height: 32,
        kind: "image",
        mimeType: "image/png",
        scope: "file",
        storageKey: "blocked",
        width: 32
      },
      client
    );
    assert.equal(blockedViewerAsset, null);

    const blockedViewerShareList = await listFileShareLinks(
      viewerUserId,
      workspaceId,
      projectId,
      fileId,
      client
    );
    assert.equal(blockedViewerShareList, null);

    const workspaceAsset = await createAsset(
      ownerUserId,
      workspaceId,
      projectId,
      fileId,
      {
        byteSize: 256,
        filename: "shared.png",
        height: 64,
        kind: "image",
        mimeType: "image/png",
        scope: "workspace",
        storageKey: "shared-asset",
        width: 64
      },
      client
    );
    assert.ok(workspaceAsset);

    const createdShareLink = await createFileShareLink(
      ownerUserId,
      workspaceId,
      projectId,
      fileId,
      client
    );
    assert.ok(createdShareLink);
    assert.equal(createdShareLink?.shareLink.fileId, fileId);

    const listedShareLinks = await listFileShareLinks(
      ownerUserId,
      workspaceId,
      projectId,
      fileId,
      client
    );
    assert.equal(listedShareLinks?.length, 1);
    assert.equal(listedShareLinks?.[0]?.id, createdShareLink?.shareLink.id);

    const sharedOpen = await getSharedFileOpenDetails(
      createdShareLink?.token as string,
      client
    );
    assert.equal(sharedOpen?.access.mode, "read-only");
    assert.equal(sharedOpen?.access.source, "share-link");
    assert.equal(sharedOpen?.file.id, fileId);
    assert.equal(sharedOpen?.defaultPageId, pageId);

    const sharedAssets = await listSharedAssets(
      createdShareLink?.token as string,
      client
    );
    assert.equal(sharedAssets?.length, 1);
    assert.equal(sharedAssets?.[0]?.id, workspaceAsset?.id);

    const sharedSession = await getSharedCollabPageSession(
      createdShareLink?.token as string,
      pageId,
      client
    );
    assert.equal(sharedSession?.access.mode, "read-only");
    assert.equal(sharedSession?.fileId, fileId);
    assert.equal(sharedSession?.pageId, pageId);

    const revoked = await revokeFileShareLink(
      ownerUserId,
      workspaceId,
      projectId,
      fileId,
      createdShareLink?.shareLink.id as string,
      client
    );
    assert.ok(revoked?.revokedAt);

    const revokedOpen = await getSharedFileOpenDetails(
      createdShareLink?.token as string,
      client
    );
    assert.equal(revokedOpen, null);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});

test("createComment, listComments, and resolveComment stay file/page scoped", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const userId = await insertUser(
      client,
      `comment-user-${Date.now()}@example.com`,
      "Comment User"
    );
    const workspaceId = await insertWorkspace(
      client,
      "Comment Workspace",
      `comment-${Date.now()}`
    );

    await insertMembership(client, workspaceId, userId, "owner");
    const projectId = await insertProject(
      client,
      workspaceId,
      "Comment Project"
    );
    const file = await createFileWithPages(
      userId,
      workspaceId,
      projectId,
      "Comment File",
      [{ name: "Page One" }, { name: "Page Two" }],
      client
    );

    const fileId = file?.file.id as string;
    const pageOneId = file?.pages[0]?.id as string;
    const pageTwoId = file?.pages[1]?.id as string;

    const fileComment = await createComment(
      userId,
      workspaceId,
      projectId,
      {
        body: "File-wide note",
        target: {
          fileId,
          type: "file"
        }
      },
      client
    );
    const nodeComment = await createComment(
      userId,
      workspaceId,
      projectId,
      {
        body: "Node note",
        target: {
          fileId,
          nodeId: "rect-1",
          pageId: pageOneId,
          type: "node"
        }
      },
      client
    );
    const pageTwoComment = await createComment(
      userId,
      workspaceId,
      projectId,
      {
        body: "Page two note",
        target: {
          fileId,
          pageId: pageTwoId,
          type: "page"
        }
      },
      client
    );

    assert.ok(fileComment);
    assert.ok(nodeComment);
    assert.ok(pageTwoComment);
    assert.equal(nodeComment?.author.displayName, "Comment User");

    const pageOneComments = await listComments(
      userId,
      workspaceId,
      projectId,
      {
        fileId,
        includeResolved: true,
        pageId: pageOneId
      },
      client
    );
    assert.equal(pageOneComments?.length, 2);
    assert.deepEqual(
      pageOneComments?.map((comment) => comment.body),
      ["File-wide note", "Node note"]
    );

    const resolved = await resolveComment(
      userId,
      workspaceId,
      projectId,
      {
        commentId: nodeComment?.id as string,
        fileId
      },
      client
    );
    assert.ok(resolved?.resolvedAt);

    const unresolvedPageOneComments = await listComments(
      userId,
      workspaceId,
      projectId,
      {
        fileId,
        includeResolved: false,
        pageId: pageOneId
      },
      client
    );
    assert.deepEqual(
      unresolvedPageOneComments?.map((comment) => comment.body),
      ["File-wide note"]
    );

    const wrongPage = await createComment(
      userId,
      workspaceId,
      projectId,
      {
        body: "Missing page",
        target: {
          fileId,
          pageId: "00000000-0000-0000-0000-000000000000",
          type: "page"
        }
      },
      client
    );
    assert.equal(wrongPage, null);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});

test("createAsset and listAssets stay workspace/file scoped", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const userId = await insertUser(
      client,
      `asset-user-${Date.now()}@example.com`,
      "Asset User"
    );
    const otherUserId = await insertUser(
      client,
      `asset-other-${Date.now()}@example.com`,
      "Other Asset User"
    );
    const workspaceId = await insertWorkspace(
      client,
      "Asset Workspace",
      `asset-${Date.now()}`
    );
    const otherWorkspaceId = await insertWorkspace(
      client,
      "Other Asset Workspace",
      `asset-other-${Date.now()}`
    );

    await insertMembership(client, workspaceId, userId, "owner");
    await insertMembership(client, otherWorkspaceId, otherUserId, "owner");

    const projectId = await insertProject(client, workspaceId, "Asset Project");
    const otherProjectId = await insertProject(
      client,
      otherWorkspaceId,
      "Other Asset Project"
    );
    const file = await createFileWithPages(
      userId,
      workspaceId,
      projectId,
      "Asset File",
      [{ name: "Page One" }],
      client
    );
    const otherFile = await createFileWithPages(
      otherUserId,
      otherWorkspaceId,
      otherProjectId,
      "Other Asset File",
      [{ name: "Hidden Page" }],
      client
    );

    const fileId = file?.file.id as string;

    const fileAsset = await createAsset(
      userId,
      workspaceId,
      projectId,
      fileId,
      {
        byteSize: 1024,
        filename: "hero.png",
        height: 600,
        kind: "image",
        mimeType: "image/png",
        scope: "file",
        storageKey: `workspaces/${workspaceId}/files/${fileId}/assets/hero.png`,
        width: 800
      },
      client
    );
    const workspaceAsset = await createAsset(
      userId,
      workspaceId,
      projectId,
      fileId,
      {
        byteSize: 2048,
        filename: "shared.webp",
        height: 400,
        kind: "image",
        mimeType: "image/webp",
        scope: "workspace",
        storageKey: `workspaces/${workspaceId}/assets/shared.webp`,
        width: 640
      },
      client
    );

    assert.equal(fileAsset?.fileId, fileId);
    assert.equal(fileAsset?.byteSize, 1024);
    assert.equal(fileAsset?.mimeType, "image/png");
    assert.equal(workspaceAsset?.fileId, null);
    assert.equal(
      workspaceAsset?.storageKey,
      `workspaces/${workspaceId}/assets/shared.webp`
    );

    const visibleAssets = await listAssets(
      userId,
      workspaceId,
      projectId,
      {
        fileId,
        includeWorkspaceAssets: true
      },
      client
    );
    assert.deepEqual(
      visibleAssets
        ?.map((asset) => ({
          fileId: asset.fileId,
          filename: asset.filename
        }))
        .sort((left, right) => left.filename.localeCompare(right.filename)),
      [
        { fileId, filename: "hero.png" },
        { fileId: null, filename: "shared.webp" }
      ]
    );

    const fileOnlyAssets = await listAssets(
      userId,
      workspaceId,
      projectId,
      {
        fileId,
        includeWorkspaceAssets: false
      },
      client
    );
    assert.deepEqual(
      fileOnlyAssets?.map((asset) => asset.filename),
      ["hero.png"]
    );

    const hiddenAssets = await listAssets(
      otherUserId,
      workspaceId,
      projectId,
      {
        fileId,
        includeWorkspaceAssets: true
      },
      client
    );
    assert.equal(hiddenAssets, null);

    const blockedCreate = await createAsset(
      otherUserId,
      workspaceId,
      projectId,
      fileId,
      {
        byteSize: 128,
        filename: "blocked.gif",
        height: 16,
        kind: "image",
        mimeType: "image/gif",
        scope: "file",
        storageKey: "blocked",
        width: 16
      },
      client
    );
    assert.equal(blockedCreate, null);

    const wrongFileCreate = await createAsset(
      userId,
      workspaceId,
      projectId,
      otherFile?.file.id as string,
      {
        byteSize: 256,
        filename: "wrong.jpeg",
        height: 32,
        kind: "image",
        mimeType: "image/jpeg",
        scope: "file",
        storageKey: "wrong",
        width: 32
      },
      client
    );
    assert.equal(wrongFileCreate, null);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});

test("getAuthorizedAsset returns only visible file or workspace scoped assets", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const userId = await insertUser(
      client,
      `asset-fetch-${Date.now()}@example.com`,
      "Asset Fetch User"
    );
    const otherUserId = await insertUser(
      client,
      `asset-fetch-other-${Date.now()}@example.com`,
      "Other Asset Fetch User"
    );
    const workspaceId = await insertWorkspace(
      client,
      "Asset Fetch Workspace",
      `asset-fetch-${Date.now()}`
    );
    const otherWorkspaceId = await insertWorkspace(
      client,
      "Asset Fetch Other Workspace",
      `asset-fetch-other-${Date.now()}`
    );

    await insertMembership(client, workspaceId, userId, "owner");
    await insertMembership(client, otherWorkspaceId, otherUserId, "owner");

    const projectId = await insertProject(client, workspaceId, "Asset Fetch Project");
    const file = await createFileWithPages(
      userId,
      workspaceId,
      projectId,
      "Asset Source File",
      [{ name: "Page One" }],
      client
    );
    const siblingFile = await createFileWithPages(
      userId,
      workspaceId,
      projectId,
      "Asset Sibling File",
      [{ name: "Page Two" }],
      client
    );

    const fileId = file?.file.id as string;
    const siblingFileId = siblingFile?.file.id as string;
    const fileAsset = await createAsset(
      userId,
      workspaceId,
      projectId,
      fileId,
      {
        byteSize: 128,
        filename: "file-only.png",
        height: 32,
        kind: "image",
        mimeType: "image/png",
        scope: "file",
        storageKey: "file-only",
        width: 32
      },
      client
    );
    const workspaceAsset = await createAsset(
      userId,
      workspaceId,
      projectId,
      fileId,
      {
        byteSize: 256,
        filename: "shared.png",
        height: 64,
        kind: "image",
        mimeType: "image/png",
        scope: "workspace",
        storageKey: "shared",
        width: 64
      },
      client
    );

    const visibleFileAsset = await getAuthorizedAsset(
      userId,
      workspaceId,
      projectId,
      fileId,
      fileAsset?.id as string,
      client
    );
    const hiddenFileAsset = await getAuthorizedAsset(
      userId,
      workspaceId,
      projectId,
      siblingFileId,
      fileAsset?.id as string,
      client
    );
    const visibleWorkspaceAsset = await getAuthorizedAsset(
      userId,
      workspaceId,
      projectId,
      siblingFileId,
      workspaceAsset?.id as string,
      client
    );
    const blockedWorkspaceAsset = await getAuthorizedAsset(
      otherUserId,
      workspaceId,
      projectId,
      fileId,
      workspaceAsset?.id as string,
      client
    );

    assert.equal(visibleFileAsset?.id, fileAsset?.id);
    assert.equal(hiddenFileAsset, null);
    assert.equal(visibleWorkspaceAsset?.id, workspaceAsset?.id);
    assert.equal(blockedWorkspaceAsset, null);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});

test("export jobs and thumbnail helpers stay scoped, transition correctly, and expose cleanup candidates", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const ownerUserId = await insertUser(
      client,
      `export-owner-${Date.now()}@example.com`,
      "Export Owner"
    );
    const otherUserId = await insertUser(
      client,
      `export-other-${Date.now()}@example.com`,
      "Export Other"
    );
    const workspaceId = await insertWorkspace(
      client,
      "Export Workspace",
      `export-${Date.now()}`
    );
    const otherWorkspaceId = await insertWorkspace(
      client,
      "Export Other Workspace",
      `export-other-${Date.now()}`
    );

    await insertMembership(client, workspaceId, ownerUserId, "owner");
    await insertMembership(client, otherWorkspaceId, otherUserId, "owner");

    const projectId = await insertProject(client, workspaceId, "Export Project");
    const file = await createFileWithPages(
      ownerUserId,
      workspaceId,
      projectId,
      "Export File",
      [{ name: "Cover" }, { name: "Specs" }],
      client
    );

    const fileId = file?.file.id as string;
    const coverPageId = file?.pages[0]?.id as string;
    const specsPageId = file?.pages[1]?.id as string;

    const blockedCreate = await createExportJob(
      otherUserId,
      workspaceId,
      projectId,
      fileId,
      {
        format: "png",
        pageId: coverPageId
      },
      client
    );
    assert.equal(blockedCreate, null);

    const pngJob = await createExportJob(
      ownerUserId,
      workspaceId,
      projectId,
      fileId,
      {
        format: "png",
        pageId: coverPageId
      },
      client
    );
    const pdfJob = await createExportJob(
      ownerUserId,
      workspaceId,
      projectId,
      fileId,
      {
        format: "pdf",
        pageId: null
      },
      client
    );

    assert.equal(pngJob?.status, "queued");
    assert.equal(pdfJob?.status, "queued");

    const hiddenJob = await getAuthorizedExportJob(
      otherUserId,
      workspaceId,
      projectId,
      fileId,
      pngJob?.id as string,
      client
    );
    assert.equal(hiddenJob, null);

    const claimedJobs = [
      await claimNextQueuedExportJob(client),
      await claimNextQueuedExportJob(client)
    ];
    assert.deepEqual(
      claimedJobs
        .map((claimedJob) => claimedJob?.job.id)
        .sort(),
      [pdfJob?.id, pngJob?.id].sort()
    );
    for (const claimedJob of claimedJobs) {
      assert.equal(
        claimedJob?.job.status,
        "running"
      );
      assert.ok(claimedJob?.job.startedAt);
    }

    const exportAsset = await createDerivedAssetRecord(
      {
        byteSize: 4096,
        fileId,
        filename: "cover-export.png",
        height: 800,
        kind: "export",
        mimeType: "image/png",
        storageKey: `workspaces/${workspaceId}/exports/${pngJob?.id}.png`,
        uploadedByUserId: ownerUserId,
        width: 1200,
        workspaceId
      },
      client
    );
    const succeededJob = await markExportJobSucceeded(
      pngJob?.id as string,
      exportAsset.id,
      client
    );
    assert.equal(succeededJob?.status, "succeeded");
    assert.equal(succeededJob?.outputAssetId, exportAsset.id);
    assert.ok(succeededJob?.completedAt);

    const failedJob = await markExportJobFailed(
      pdfJob?.id as string,
      "renderer exploded",
      client
    );
    assert.equal(failedJob?.status, "failed");
    assert.equal(failedJob?.errorMessage, "renderer exploded");

    const staleJob = await createExportJob(
      ownerUserId,
      workspaceId,
      projectId,
      fileId,
      {
        format: "png",
        pageId: specsPageId
      },
      client
    );
    assert.ok(staleJob);
    const claimedStaleJob = await claimNextQueuedExportJob(client);
    assert.equal(claimedStaleJob?.job.id, staleJob?.id);
    const timedOutCount = await failStaleRunningExportJobs(
      new Date(Date.now() + 1000),
      client
    );
    assert.equal(timedOutCount, 1);

    const timedOutJob = await getAuthorizedExportJob(
      ownerUserId,
      workspaceId,
      projectId,
      fileId,
      staleJob?.id as string,
      client
    );
    assert.equal(timedOutJob?.status, "failed");
    assert.equal(timedOutJob?.errorMessage, "worker job timed out");

    const firstPageThumbnail = await createDerivedAssetRecord(
      {
        byteSize: 512,
        fileId,
        filename: "page-thumb-1.png",
        height: 128,
        kind: "thumbnail",
        mimeType: "image/png",
        storageKey: `workspaces/${workspaceId}/thumbnails/pages/${coverPageId}-1.png`,
        uploadedByUserId: ownerUserId,
        width: 192,
        workspaceId
      },
      client
    );
    const secondPageThumbnail = await createDerivedAssetRecord(
      {
        byteSize: 768,
        fileId,
        filename: "page-thumb-2.png",
        height: 128,
        kind: "thumbnail",
        mimeType: "image/png",
        storageKey: `workspaces/${workspaceId}/thumbnails/pages/${coverPageId}-2.png`,
        uploadedByUserId: ownerUserId,
        width: 192,
        workspaceId
      },
      client
    );
    const fileThumbnail = await createDerivedAssetRecord(
      {
        byteSize: 1024,
        fileId,
        filename: "file-thumb.png",
        height: 128,
        kind: "thumbnail",
        mimeType: "image/png",
        storageKey: `workspaces/${workspaceId}/thumbnails/files/${fileId}.png`,
        uploadedByUserId: ownerUserId,
        width: 192,
        workspaceId
      },
      client
    );
    const refreshedPageThumbnail = await createDerivedAssetRecord(
      {
        byteSize: 640,
        fileId,
        filename: "page-thumb-1-refreshed.png",
        height: 144,
        kind: "thumbnail",
        mimeType: "image/png",
        storageKey: `workspaces/${workspaceId}/thumbnails/pages/${coverPageId}-1.png`,
        uploadedByUserId: ownerUserId,
        width: 216,
        workspaceId
      },
      client
    );

    assert.equal(refreshedPageThumbnail.id, firstPageThumbnail.id);
    assert.equal(refreshedPageThumbnail.filename, "page-thumb-1-refreshed.png");
    assert.equal(refreshedPageThumbnail.byteSize, 640);
    assert.equal(refreshedPageThumbnail.deletedAt, null);

    assert.equal(
      await replacePageThumbnailAsset(coverPageId, firstPageThumbnail.id, client),
      null
    );
    assert.equal(
      await replacePageThumbnailAsset(coverPageId, refreshedPageThumbnail.id, client),
      firstPageThumbnail.id
    );
    assert.equal(
      await replacePageThumbnailAsset(coverPageId, secondPageThumbnail.id, client),
      firstPageThumbnail.id
    );
    assert.equal(
      await replaceFileThumbnailAsset(fileId, fileThumbnail.id, client),
      null
    );

    const deletedThumbnail = await markAssetDeleted(firstPageThumbnail.id, client);
    assert.equal(deletedThumbnail?.id, firstPageThumbnail.id);

    const cleanupCandidates = await listDeletedThumbnailAssetsForCleanup(
      new Date(Date.now() + 1000),
      10,
      client
    );
    assert.deepEqual(
      cleanupCandidates.map((asset) => asset.id),
      [firstPageThumbnail.id]
    );
    assert.equal(await hardDeleteAssetRecord(firstPageThumbnail.id, client), true);

    const nextPageThumbnail = await findNextPageMissingThumbnail(client);
    assert.equal(nextPageThumbnail?.page.id, specsPageId);
    assert.equal(nextPageThumbnail?.file.id, fileId);

    const nextFileThumbnail = await findNextFileMissingThumbnail(client);
    assert.notEqual(nextFileThumbnail?.file.id, fileId);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});
