import assert from "node:assert/strict";
import test from "node:test";

import {
  createDatabasePool,
  createDerivedAssetRecord,
  createExportJob,
  createFileWithPages,
  createProject,
  markExportJobSucceeded
} from "@openmirage/db";
import { type AuthContext, type ExportJobDto } from "@openmirage/types";

import {
  resolveCreateExportJobRequest,
  resolveExportJobDownloadRequest,
  resolveGetExportJobRequest
} from "./exports.js";

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
      displayName: "Export User",
      email: "export-user@example.com",
      id: userId
    }
  };
}

test("export request helpers validate auth, job creation, status lookup, and blob-backed download", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const ownerUserId = await insertUser(
      client,
      `export-api-owner-${Date.now()}@example.com`,
      "Export API Owner"
    );
    const viewerUserId = await insertUser(
      client,
      `export-api-viewer-${Date.now()}@example.com`,
      "Export API Viewer"
    );
    const otherUserId = await insertUser(
      client,
      `export-api-other-${Date.now()}@example.com`,
      "Export API Other"
    );
    const workspaceId = await insertWorkspace(
      client,
      "Export API Workspace",
      `export-api-${Date.now()}`
    );
    const otherWorkspaceId = await insertWorkspace(
      client,
      "Export API Other Workspace",
      `export-api-other-${Date.now()}`
    );

    await insertMembership(client, workspaceId, ownerUserId, "owner");
    await insertMembership(client, workspaceId, viewerUserId, "viewer");
    await insertMembership(client, otherWorkspaceId, otherUserId, "owner");

    const project = await createProject(
      ownerUserId,
      workspaceId,
      "Export API Project",
      client as Parameters<typeof createProject>[3]
    );
    const file = await createFileWithPages(
      ownerUserId,
      workspaceId,
      project?.id as string,
      "Export API File",
      [{ name: "Page One" }, { name: "Page Two" }],
      client as Parameters<typeof createFileWithPages>[5]
    );

    const fileId = file?.file.id as string;
    const pageId = file?.pages[0]?.id as string;

    const unauthenticatedCreate = await resolveCreateExportJobRequest(
      null,
      {
        fileId,
        format: "png",
        pageId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(unauthenticatedCreate.status, 401);

    const invalidFormat = await resolveCreateExportJobRequest(
      createAuthContext(ownerUserId, workspaceId),
      {
        fileId,
        format: "jpeg",
        pageId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(invalidFormat.status, 400);

    const missingPageId = await resolveCreateExportJobRequest(
      createAuthContext(ownerUserId, workspaceId),
      {
        fileId,
        format: "png",
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(missingPageId.status, 400);

    const pdfWithPageId = await resolveCreateExportJobRequest(
      createAuthContext(ownerUserId, workspaceId),
      {
        fileId,
        format: "pdf",
        pageId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(pdfWithPageId.status, 400);

    const forbiddenCreate = await resolveCreateExportJobRequest(
      createAuthContext(otherUserId, otherWorkspaceId),
      {
        fileId,
        format: "png",
        pageId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(forbiddenCreate.status, 403);

    const created = await resolveCreateExportJobRequest(
      createAuthContext(viewerUserId, workspaceId, "viewer"),
      {
        fileId,
        format: "png",
        pageId,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(created.status, 202);
    if (created.status !== 202) {
      throw new Error("expected export create success");
    }
    const createdJob = created.body as ExportJobDto;
    assert.equal(createdJob.status, "queued");
    assert.equal(createdJob.pageId, pageId);

    const missingJobStatus = await resolveGetExportJobRequest(
      createAuthContext(ownerUserId, workspaceId),
      {
        fileId,
        jobId: "00000000-0000-0000-0000-000000000000",
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(missingJobStatus.status, 404);

    const visibleStatus = await resolveGetExportJobRequest(
      createAuthContext(ownerUserId, workspaceId),
      {
        fileId,
        jobId: createdJob.id,
        projectId: project?.id as string,
        workspaceId
      },
      client
    );
    assert.equal(visibleStatus.status, 200);
    if (visibleStatus.status !== 200 || !("status" in visibleStatus.body)) {
      throw new Error("expected export status success");
    }
    assert.equal(visibleStatus.body.status, "queued");

    const pendingDownload = await resolveExportJobDownloadRequest(
      createAuthContext(ownerUserId, workspaceId),
      {
        fileId,
        jobId: createdJob.id,
        projectId: project?.id as string,
        workspaceId
      },
      client,
      {
        async read() {
          throw new Error("storage should not be read for a queued job");
        }
      }
    );
    assert.equal(pendingDownload.status, 409);

    const exportAsset = await createDerivedAssetRecord(
      {
        byteSize: 5120,
        fileId,
        filename: "page-one-export",
        height: 800,
        kind: "export",
        mimeType: "image/png",
        storageKey: `workspaces/${workspaceId}/exports/${createdJob.id}.png`,
        uploadedByUserId: ownerUserId,
        width: 1200,
        workspaceId
      },
      client as Parameters<typeof createDerivedAssetRecord>[1]
    );
    await markExportJobSucceeded(
      createdJob.id,
      exportAsset.id,
      client as Parameters<typeof markExportJobSucceeded>[2]
    );

    const forbiddenDownload = await resolveExportJobDownloadRequest(
      createAuthContext(otherUserId, otherWorkspaceId),
      {
        fileId,
        jobId: createdJob.id,
        projectId: project?.id as string,
        workspaceId
      },
      client,
      {
        async read() {
          throw new Error("forbidden requests must not reach storage");
        }
      }
    );
    assert.equal(forbiddenDownload.status, 403);

    const successfulDownload = await resolveExportJobDownloadRequest(
      createAuthContext(ownerUserId, workspaceId),
      {
        fileId,
        jobId: createdJob.id,
        projectId: project?.id as string,
        workspaceId
      },
      client,
      {
        async read(key) {
          assert.equal(key, exportAsset.storageKey);
          return {
            body: new Uint8Array([1, 2, 3, 4]),
            contentType: "image/png"
          };
        }
      }
    );
    assert.equal(successfulDownload.status, 200);
    if (successfulDownload.status !== 200) {
      throw new Error("expected export download success");
    }
    assert.equal(successfulDownload.body.contentType, "image/png");
    assert.match(
      successfulDownload.body.contentDisposition,
      /attachment; filename="page-one-export\.png"/
    );
    assert.deepEqual(Array.from(successfulDownload.body.body), [1, 2, 3, 4]);

    const missingBlobDownload = await resolveExportJobDownloadRequest(
      createAuthContext(ownerUserId, workspaceId),
      {
        fileId,
        jobId: createdJob.id,
        projectId: project?.id as string,
        workspaceId
      },
      client,
      {
        async read() {
          const error = new Error("missing");
          (error as Error & { code?: string }).code = "NoSuchKey";
          throw error;
        }
      }
    );
    assert.equal(missingBlobDownload.status, 404);

    const pdfJob = await createExportJob(
      ownerUserId,
      workspaceId,
      project?.id as string,
      fileId,
      {
        format: "pdf",
        pageId: null
      },
      client as Parameters<typeof createExportJob>[5]
    );
    const pdfAsset = await createDerivedAssetRecord(
      {
        byteSize: 8192,
        fileId,
        filename: "full-file",
        kind: "export",
        mimeType: "application/pdf",
        storageKey: `workspaces/${workspaceId}/exports/${pdfJob?.id}.pdf`,
        uploadedByUserId: ownerUserId,
        workspaceId
      },
      client as Parameters<typeof createDerivedAssetRecord>[1]
    );
    await markExportJobSucceeded(
      pdfJob?.id as string,
      pdfAsset.id,
      client as Parameters<typeof markExportJobSucceeded>[2]
    );

    const pdfDownload = await resolveExportJobDownloadRequest(
      createAuthContext(ownerUserId, workspaceId),
      {
        fileId,
        jobId: pdfJob?.id as string,
        projectId: project?.id as string,
        workspaceId
      },
      client,
      {
        async read() {
          return {
            body: new Uint8Array([9, 8, 7]),
            contentType: "application/pdf"
          };
        }
      }
    );
    assert.equal(pdfDownload.status, 200);
    if (pdfDownload.status !== 200) {
      throw new Error("expected pdf download success");
    }
    assert.match(pdfDownload.body.contentDisposition, /full-file\.pdf/);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});
