import assert from "node:assert/strict";
import test from "node:test";
import {
  createDerivedAssetRecord,
  createFileWithPages,
  createProject,
  markExportJobSucceeded
} from "@openmirage/db";
import { createStorage } from "@openmirage/storage";
import {
  buildMultipartPayload,
  createAuthenticatedCookie,
  insertMembership,
  insertWorkspace,
  readJson,
  readUserIdByEmail,
  withApiTestApp
} from "./test-helpers.js";

const SMOKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z0foAAAAASUVORK5CYII=",
  "base64"
);

test("api route integration covers auth, redirect sanitization, metadata CRUD, and collab authorization", async (t) => {
  const ran = await withApiTestApp(async ({ app, client }) => {
    const email = `routes-auth-${Date.now()}@example.com`;
    const magicLinkRequest = await app.inject({
      method: "POST",
      payload: {
        email
      },
      url: "/auth/magic-link/request"
    });

    assert.equal(magicLinkRequest.statusCode, 200);
    const requestBody = readJson<{ magicLinkUrl: string }>(magicLinkRequest.body);
    const userId = await readUserIdByEmail(client, email);
    const workspaceId = await insertWorkspace(
      client,
      "Routes Workspace",
      `routes-${Date.now()}`
    );
    await insertMembership(client, workspaceId, userId, "owner");

    const consumeUrl = new URL(requestBody.magicLinkUrl);
    consumeUrl.searchParams.set("redirectTo", "https://evil.example.com/phish");
    const consume = await app.inject({
      method: "GET",
      url: `${consumeUrl.pathname}${consumeUrl.search}`
    });

    assert.equal(consume.statusCode, 302);
    assert.equal(consume.headers.location, "http://127.0.0.1/?auth=success");
    const cookieHeader = consume.headers["set-cookie"];
    const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)
      ?.split(";")[0];
    assert.ok(cookie);

    const authMe = await app.inject({
      headers: {
        cookie
      },
      method: "GET",
      url: "/auth/me"
    });
    assert.equal(authMe.statusCode, 200);

    const createProjectResponse = await app.inject({
      headers: {
        cookie
      },
      method: "POST",
      payload: {
        name: "Routes Project"
      },
      url: `/v1/workspaces/${workspaceId}/projects`
    });
    assert.equal(createProjectResponse.statusCode, 201);
    const createdProject = readJson<{ id: string }>(createProjectResponse.body);

    const createFileResponse = await app.inject({
      headers: {
        cookie
      },
      method: "POST",
      payload: {
        initialPages: [{ name: "Page 1" }, { name: "Page 2" }],
        name: "Routes File"
      },
      url: `/v1/workspaces/${workspaceId}/projects/${createdProject.id}/files`
    });
    assert.equal(createFileResponse.statusCode, 201);
    const createdFile = readJson<{
      defaultPageId: string | null;
      file: { id: string };
      pages: Array<{ id: string }>;
    }>(createFileResponse.body);
    const firstPageId = createdFile.defaultPageId ?? createdFile.pages[0]?.id;
    assert.ok(firstPageId);

    const createPageResponse = await app.inject({
      headers: {
        cookie
      },
      method: "POST",
      payload: {
        name: "Page 3"
      },
      url: `/v1/workspaces/${workspaceId}/projects/${createdProject.id}/files/${createdFile.file.id}/pages`
    });
    assert.equal(createPageResponse.statusCode, 201);

    const launchpad = await app.inject({
      headers: {
        cookie
      },
      method: "GET",
      url: `/v1/workspaces/${workspaceId}/launchpad`
    });
    assert.equal(launchpad.statusCode, 200);
    const launchpadBody = readJson<{
      projects: Array<{
        files: Array<{
          defaultPageId: string | null;
          file: { id: string; name: string };
          pageCount: number;
        }>;
        project: { id: string; name: string };
      }>;
      workspace: { id: string };
    }>(launchpad.body);
    assert.equal(launchpadBody.workspace.id, workspaceId);
    assert.equal(launchpadBody.projects.length, 1);
    assert.equal(launchpadBody.projects[0]?.project.id, createdProject.id);
    assert.equal(launchpadBody.projects[0]?.files.length, 1);
    assert.equal(
      launchpadBody.projects[0]?.files[0]?.defaultPageId,
      firstPageId
    );
    assert.equal(
      launchpadBody.projects[0]?.files[0]?.file.id,
      createdFile.file.id
    );
    assert.equal(
      launchpadBody.projects[0]?.files[0]?.file.name,
      "Routes File"
    );
    assert.equal(launchpadBody.projects[0]?.files[0]?.pageCount, 3);

    const fileOpen = await app.inject({
      headers: {
        cookie
      },
      method: "GET",
      url: `/v1/workspaces/${workspaceId}/projects/${createdProject.id}/files/${createdFile.file.id}`
    });
    assert.equal(fileOpen.statusCode, 200);
    const fileOpenBody = readJson<{ pages: Array<{ id: string }> }>(fileOpen.body);
    assert.equal(fileOpenBody.pages.length, 3);

    const collabSession = await app.inject({
      headers: {
        cookie
      },
      method: "GET",
      url:
        `/v1/workspaces/${workspaceId}/projects/${createdProject.id}` +
        `/files/${createdFile.file.id}/pages/${firstPageId}/collab-session`
    });
    assert.equal(collabSession.statusCode, 200);

    const refresh = await app.inject({
      headers: {
        cookie
      },
      method: "POST",
      url: `/auth/session/refresh?workspaceId=${workspaceId}`
    });
    assert.equal(refresh.statusCode, 200);

    const logout = await app.inject({
      headers: {
        cookie
      },
      method: "POST",
      url: "/auth/logout"
    });
    assert.equal(logout.statusCode, 200);

    const afterLogout = await app.inject({
      headers: {
        cookie
      },
      method: "GET",
      url: "/auth/me"
    });
    assert.equal(afterLogout.statusCode, 401);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});

test("api route integration covers comments, share links, assets, and export download flows", async (t) => {
  const ran = await withApiTestApp(async ({ app, client, storageRoot }) => {
    const email = `routes-app-${Date.now()}@example.com`;
    const cookie = await createAuthenticatedCookie(app, email);
    const userId = await readUserIdByEmail(client, email);
    const workspaceId = await insertWorkspace(
      client,
      "Routes App Workspace",
      `routes-app-${Date.now()}`
    );
    await insertMembership(client, workspaceId, userId, "owner");

    const project = await createProject(
      userId,
      workspaceId,
      "Routes App Project",
      client as Parameters<typeof createProject>[3]
    );
    assert.ok(project);
    const file = await createFileWithPages(
      userId,
      workspaceId,
      project?.id as string,
      "Routes App File",
      [{ name: "Page 1" }, { name: "Page 2" }],
      client as Parameters<typeof createFileWithPages>[5]
    );
    assert.ok(file);
    const pageId = file?.pages[0]?.id as string;

    const createdComment = await app.inject({
      headers: {
        cookie
      },
      method: "POST",
      payload: {
        body: "Looks good",
        target: {
          fileId: file?.file.id,
          pageId,
          type: "page"
        }
      },
      url:
        `/v1/workspaces/${workspaceId}/projects/${project?.id}` +
        `/files/${file?.file.id}/comments`
    });
    assert.equal(createdComment.statusCode, 201);
    const createdCommentBody = readJson<{ id: string }>(createdComment.body);

    const listedComments = await app.inject({
      headers: {
        cookie
      },
      method: "GET",
      url:
        `/v1/workspaces/${workspaceId}/projects/${project?.id}` +
        `/files/${file?.file.id}/comments?pageId=${pageId}&includeResolved=true`
    });
    assert.equal(listedComments.statusCode, 200);
    assert.ok(
      readJson<{ comments: Array<{ id: string }> }>(listedComments.body).comments.some(
        (comment) => comment.id === createdCommentBody.id
      )
    );

    const resolvedComment = await app.inject({
      headers: {
        cookie
      },
      method: "POST",
      url:
        `/v1/workspaces/${workspaceId}/projects/${project?.id}` +
        `/files/${file?.file.id}/comments/${createdCommentBody.id}/resolve`
    });
    assert.equal(resolvedComment.statusCode, 200);

    const multipart = buildMultipartPayload({
      fields: {
        scope: "file"
      },
      file: {
        body: SMOKE_PNG,
        contentType: "image/png",
        fieldName: "file",
        filename: "smoke.png"
      }
    });
    const uploadedAsset = await app.inject({
      headers: {
        cookie,
        "content-type": multipart.contentType
      },
      method: "POST",
      payload: multipart.body,
      url:
        `/v1/workspaces/${workspaceId}/projects/${project?.id}` +
        `/files/${file?.file.id}/assets`
    });
    assert.equal(uploadedAsset.statusCode, 201);
    const assetBody = readJson<{ id: string }>(uploadedAsset.body);

    const listedAssets = await app.inject({
      headers: {
        cookie
      },
      method: "GET",
      url:
        `/v1/workspaces/${workspaceId}/projects/${project?.id}` +
        `/files/${file?.file.id}/assets?includeWorkspaceAssets=true`
    });
    assert.equal(listedAssets.statusCode, 200);
    const assets = readJson<{ assets: Array<{ id: string }> }>(listedAssets.body);
    assert.ok(assets.assets.some((asset) => asset.id === assetBody.id));

    const assetContent = await app.inject({
      headers: {
        cookie
      },
      method: "GET",
      url:
        `/v1/workspaces/${workspaceId}/projects/${project?.id}` +
        `/files/${file?.file.id}/assets/${assetBody.id}/content`
    });
    assert.equal(assetContent.statusCode, 200);
    assert.equal(assetContent.headers["content-type"], "image/png");

    const createdShareLink = await app.inject({
      headers: {
        cookie
      },
      method: "POST",
      url:
        `/v1/workspaces/${workspaceId}/projects/${project?.id}` +
        `/files/${file?.file.id}/share-links`
    });
    assert.equal(createdShareLink.statusCode, 201);
    const shareLinkBody = readJson<{ token: string }>(createdShareLink.body);

    const publicShare = await app.inject({
      method: "GET",
      url: `/v1/share-links/${shareLinkBody.token}`
    });
    assert.equal(publicShare.statusCode, 200);

    const publicShareAssets = await app.inject({
      method: "GET",
      url: `/v1/share-links/${shareLinkBody.token}/assets`
    });
    assert.equal(publicShareAssets.statusCode, 200);

    const publicCollabSession = await app.inject({
      method: "GET",
      url: `/v1/share-links/${shareLinkBody.token}/pages/${pageId}/collab-session`
    });
    assert.equal(publicCollabSession.statusCode, 200);

    const createdExport = await app.inject({
      headers: {
        cookie
      },
      method: "POST",
      payload: {
        format: "png",
        pageId
      },
      url:
        `/v1/workspaces/${workspaceId}/projects/${project?.id}` +
        `/files/${file?.file.id}/export-jobs`
    });
    assert.equal(createdExport.statusCode, 202);
    const exportBody = readJson<{ id: string }>(createdExport.body);

    const storage = createStorage({
      bucket: "openmirage-assets",
      provider: "local",
      rootDirectory: storageRoot
    });
    const storageKey =
      `workspaces/${workspaceId}/files/${file?.file.id}/exports/` +
      `${exportBody.id}/smoke-export.png`;
    await storage.put({
      body: SMOKE_PNG,
      contentType: "image/png",
      key: storageKey
    });
    const derivedAsset = await createDerivedAssetRecord(
      {
        byteSize: SMOKE_PNG.byteLength,
        fileId: file?.file.id as string,
        filename: "smoke-export.png",
        kind: "export",
        mimeType: "image/png",
        storageKey,
        uploadedByUserId: userId,
        workspaceId
      },
      client as Parameters<typeof createDerivedAssetRecord>[1]
    );
    await markExportJobSucceeded(
      exportBody.id,
      derivedAsset.id,
      client as Parameters<typeof markExportJobSucceeded>[2]
    );

    const exportStatus = await app.inject({
      headers: {
        cookie
      },
      method: "GET",
      url:
        `/v1/workspaces/${workspaceId}/projects/${project?.id}` +
        `/files/${file?.file.id}/export-jobs/${exportBody.id}`
    });
    assert.equal(exportStatus.statusCode, 200);
    assert.equal(
      readJson<{ status: string }>(exportStatus.body).status,
      "succeeded"
    );

    const exportDownload = await app.inject({
      headers: {
        cookie
      },
      method: "GET",
      url:
        `/v1/workspaces/${workspaceId}/projects/${project?.id}` +
        `/files/${file?.file.id}/export-jobs/${exportBody.id}/download`
    });
    assert.equal(exportDownload.statusCode, 200);
    assert.equal(exportDownload.headers["content-type"], "image/png");
    assert.ok(Buffer.from(exportDownload.rawPayload).byteLength > 0);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});
