import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import {
  createDatabasePool,
  createFileWithPages,
  createProject
} from "@openmirage/db";
import { type AuthContext, type AssetRecordDto } from "@openmirage/types";
import Fastify from "fastify";
import {
  buildAssetContentPath,
  detectRasterImageMimeType,
  parseMultipartUpload,
  readImageDimensions,
  registerRawMultipartParser,
  resolveAssetDeliveryMode,
  resolveAssetContentRequest,
  resolveCreateAssetRequest,
  resolveListAssetsRequest
} from "./assets.js";

interface DatabaseClient {
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
}

class FakeStorage {
  readonly objects = new Map<string, Uint8Array>();

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async put(input: {
    body: Uint8Array;
    contentType?: string;
    key: string;
  }): Promise<void> {
    this.objects.set(input.key, input.body);
  }

  async read(key: string): Promise<{
    body: Uint8Array;
    contentType?: string;
  }> {
    const body = this.objects.get(key);

    if (!body) {
      const error = new Error("missing object") as Error & { code?: string };
      error.code = "ENOENT";
      throw error;
    }

    return {
      body,
      contentType: "image/png"
    };
  }

  async resolveDownloadUrl(key: string): Promise<string> {
    return `https://storage.test/${key}`;
  }
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
      displayName: "Asset User",
      email: "asset-user@example.com",
      id: userId
    }
  };
}

function createPngBytes(): Uint8Array {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z0foAAAAASUVORK5CYII=",
    "base64"
  );
}

test("asset delivery mode proxies editor assets for all MVP storage providers", () => {
  assert.equal(resolveAssetDeliveryMode("local"), "proxy");
  assert.equal(resolveAssetDeliveryMode("minio"), "proxy");
  assert.equal(resolveAssetDeliveryMode("s3-compatible"), "proxy");
});

test("parseMultipartUpload reads one file and scalar fields", async () => {
  const boundary = "openmirage-boundary";
  const png = createPngBytes();
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="scope"\r\n\r\nworkspace\r\n`
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hero.png"\r\nContent-Type: image/png\r\n\r\n`
    ),
    Buffer.from(png),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const parsed = await parseMultipartUpload({
    contentTypeHeader: `multipart/form-data; boundary=${boundary}`,
    stream: Readable.from(body)
  });

  assert.equal(parsed.fields.scope, "workspace");
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0]?.filename, "hero.png");
  assert.equal(parsed.files[0]?.mimeType, "image/png");
});

test("readImageDimensions returns intrinsic raster image size", () => {
  assert.deepEqual(readImageDimensions(createPngBytes(), "image/png"), {
    height: 1,
    width: 1
  });
});

test("detectRasterImageMimeType recognizes supported image signatures", () => {
  assert.equal(detectRasterImageMimeType(createPngBytes()), "image/png");
  assert.equal(
    detectRasterImageMimeType(Buffer.from("not-an-image")),
    null
  );
});

test("parseMultipartUpload rejects malformed multipart bodies", async () => {
  await assert.rejects(
    () =>
      parseMultipartUpload({
        contentTypeHeader: "multipart/form-data; boundary=broken",
        stream: Readable.from(Buffer.from("--broken\r\nnot-valid"))
      }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === "invalid_multipart"
  );
});

test("parseMultipartUpload rejects oversized files before buffering the tail", async () => {
  const boundary = "openmirage-boundary";
  const totalFileChunks = 20;
  let emittedChunkCount = 0;
  const oversizeBody = async function* (): AsyncGenerator<Buffer> {
    emittedChunkCount += 1;
    yield Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hero.png"\r\nContent-Type: image/png\r\n\r\n`
    );

    for (let index = 0; index < totalFileChunks; index += 1) {
      emittedChunkCount += 1;
      yield Buffer.alloc(1024 * 1024, index);
    }

    emittedChunkCount += 1;
    yield Buffer.from(`\r\n--${boundary}--\r\n`);
  };

  await assert.rejects(
    () =>
      parseMultipartUpload({
        contentTypeHeader: `multipart/form-data; boundary=${boundary}`,
        stream: Readable.from(oversizeBody())
      }),
    (error: unknown) =>
      error instanceof Error && error.message === "payload_too_large"
  );
  assert.equal(emittedChunkCount < totalFileChunks + 2, true);
});

test("registerRawMultipartParser allows multipart uploads to reach route handlers", async () => {
  const app = Fastify();
  const boundary = "openmirage-boundary";
  const png = createPngBytes();
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="scope"\r\n\r\nfile\r\n`
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hero.png"\r\nContent-Type: image/png\r\n\r\n`
    ),
    Buffer.from(png),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  registerRawMultipartParser(app);
  app.post("/upload", async (request) => {
    const parsed = await parseMultipartUpload({
      contentTypeHeader:
        typeof request.headers["content-type"] === "string"
          ? request.headers["content-type"]
          : undefined,
      stream: request.raw
    });

    return {
      filename: parsed.files[0]?.filename,
      scope: parsed.fields.scope
    };
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/upload",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload: body
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      filename: "hero.png",
      scope: "file"
    });
  } finally {
    await app.close();
  }
});

test("asset request helpers enforce auth, validation, storage writes, and list resolution", async (t) => {
  const ran = await withDatabaseTransaction(async (client) => {
    const userId = await insertUser(
      client,
      `asset-api-${Date.now()}@example.com`,
      "Asset User"
    );
    const otherUserId = await insertUser(
      client,
      `asset-api-other-${Date.now()}@example.com`,
      "Other Asset User"
    );
    const workspaceId = await insertWorkspace(
      client,
      "Asset API Workspace",
      `asset-api-${Date.now()}`
    );
    const otherWorkspaceId = await insertWorkspace(
      client,
      "Asset API Other Workspace",
      `asset-api-other-${Date.now()}`
    );

    await insertMembership(client, workspaceId, userId);
    await insertMembership(client, otherWorkspaceId, otherUserId);

    const project = await createProject(
      userId,
      workspaceId,
      "Asset API Project",
      client as Parameters<typeof createProject>[3]
    );
    const file = await createFileWithPages(
      userId,
      workspaceId,
      project?.id as string,
      "Asset API File",
      [{ name: "Page One" }],
      client as Parameters<typeof createFileWithPages>[5]
    );

    const fileId = file?.file.id as string;
    const storage = new FakeStorage();
    const png = createPngBytes();
    const minioContext = {
      appBaseUrl: "https://app.test",
      assetDeliveryMode: resolveAssetDeliveryMode("minio")
    } as const;
    const localContext = {
      appBaseUrl: "https://app.test",
      assetDeliveryMode: resolveAssetDeliveryMode("local")
    } as const;
    const s3CompatibleContext = {
      appBaseUrl: "https://app.test",
      assetDeliveryMode: resolveAssetDeliveryMode("s3-compatible")
    } as const;

    const unauthenticatedList = await resolveListAssetsRequest(
      null,
      {
        fileId,
        includeWorkspaceAssets: true,
        projectId: project?.id as string,
        workspaceId
      },
      client,
      storage,
      minioContext
    );
    assert.equal(unauthenticatedList.status, 401);

    const forbiddenCreate = await resolveCreateAssetRequest(
      createAuthContext(otherUserId, otherWorkspaceId),
      {
        file: {
          body: png,
          filename: "hero.png",
          mimeType: "image/png"
        },
        fileId,
        projectId: project?.id as string,
        scope: "file",
        workspaceId
      },
      client,
      storage,
      minioContext
    );
    assert.equal(forbiddenCreate.status, 403);

    const invalidMime = await resolveCreateAssetRequest(
      createAuthContext(userId, workspaceId),
      {
        file: {
          body: png,
          filename: "hero.svg",
          mimeType: "image/svg+xml"
        },
        fileId,
        projectId: project?.id as string,
        scope: "file",
        workspaceId
      },
      client,
      storage,
      minioContext
    );
    assert.equal(invalidMime.status, 400);
    assert.deepEqual(invalidMime.body, {
      error: "file must be an image/png, image/jpeg, image/webp, or image/gif"
    });

    const invalidBytes = await resolveCreateAssetRequest(
      createAuthContext(userId, workspaceId),
      {
        file: {
          body: Buffer.from("not-a-real-png"),
          filename: "hero.png",
          mimeType: "image/png"
        },
        fileId,
        projectId: project?.id as string,
        scope: "file",
        workspaceId
      },
      client,
      storage,
      minioContext
    );
    assert.equal(invalidBytes.status, 400);
    assert.deepEqual(invalidBytes.body, {
      error: "file must contain a valid raster image matching the declared type"
    });

    const mismatchedBytes = await resolveCreateAssetRequest(
      createAuthContext(userId, workspaceId),
      {
        file: {
          body: png,
          filename: "hero.jpeg",
          mimeType: "image/jpeg"
        },
        fileId,
        projectId: project?.id as string,
        scope: "file",
        workspaceId
      },
      client,
      storage,
      minioContext
    );
    assert.equal(mismatchedBytes.status, 400);
    assert.deepEqual(mismatchedBytes.body, {
      error: "file must contain a valid raster image matching the declared type"
    });

    const created = await resolveCreateAssetRequest(
      createAuthContext(userId, workspaceId),
      {
        file: {
          body: png,
          filename: "hero.png",
          mimeType: "image/png"
        },
        fileId,
        projectId: project?.id as string,
        scope: "workspace",
        workspaceId
      },
      client,
      storage,
      localContext
    );
    assert.equal(created.status, 201);
    if (created.status !== 201) {
      throw new Error("expected asset upload success");
    }

    const createdAsset = created.body as AssetRecordDto;
    assert.equal(createdAsset.fileId, null);
    assert.equal(createdAsset.width, 1);
    assert.equal(createdAsset.height, 1);
    assert.equal(
      createdAsset.contentUrl,
      `https://app.test${buildAssetContentPath({
        assetId: createdAsset.id,
        fileId,
        projectId: project?.id as string,
        workspaceId
      })}`
    );
    assert.equal(storage.objects.size, 1);

    const listed = await resolveListAssetsRequest(
      createAuthContext(userId, workspaceId),
      {
        fileId,
        includeWorkspaceAssets: true,
        projectId: project?.id as string,
        workspaceId
      },
      client,
      storage,
      localContext
    );
    assert.equal(listed.status, 200);
    if (listed.status !== 200) {
      throw new Error("expected asset list success");
    }
    if (!("assets" in listed.body)) {
      throw new Error("expected asset list payload");
    }

    assert.deepEqual(
      listed.body.assets.map((asset) => ({
        contentUrl: asset.contentUrl,
        filename: asset.filename
      })),
      [
        {
          contentUrl: createdAsset.contentUrl,
          filename: "hero.png"
        }
      ]
    );

    const listedViaMinio = await resolveListAssetsRequest(
      createAuthContext(userId, workspaceId),
      {
        fileId,
        includeWorkspaceAssets: true,
        projectId: project?.id as string,
        workspaceId
      },
      client,
      storage,
      minioContext
    );
    assert.equal(listedViaMinio.status, 200);
    if (listedViaMinio.status !== 200) {
      throw new Error("expected asset list success for minio-backed assets");
    }
    if (!("assets" in listedViaMinio.body)) {
      throw new Error("expected asset list payload for minio-backed assets");
    }

    assert.deepEqual(
      listedViaMinio.body.assets.map((asset) => ({
        contentUrl: asset.contentUrl,
        filename: asset.filename
      })),
      [
        {
          contentUrl: createdAsset.contentUrl,
          filename: "hero.png"
        }
      ]
    );

    const listedViaS3Compatible = await resolveListAssetsRequest(
      createAuthContext(userId, workspaceId),
      {
        fileId,
        includeWorkspaceAssets: true,
        projectId: project?.id as string,
        workspaceId
      },
      client,
      storage,
      s3CompatibleContext
    );
    assert.equal(listedViaS3Compatible.status, 200);
    if (listedViaS3Compatible.status !== 200) {
      throw new Error(
        "expected asset list success for s3-compatible-backed assets"
      );
    }
    if (!("assets" in listedViaS3Compatible.body)) {
      throw new Error("expected asset list payload");
    }

    assert.deepEqual(
      listedViaS3Compatible.body.assets.map((asset) => ({
        contentUrl: asset.contentUrl,
        filename: asset.filename
      })),
      [
        {
          contentUrl: createdAsset.contentUrl,
          filename: "hero.png"
        }
      ]
    );

    const content = await resolveAssetContentRequest(
      createAuthContext(userId, workspaceId),
      {
        assetId: createdAsset.id,
        fileId,
        projectId: project?.id as string,
        workspaceId
      },
      client,
      storage
    );
    assert.equal(content.status, 200);
    if (content.status !== 200) {
      throw new Error("expected asset content success");
    }
    assert.equal(content.body.contentType, "image/png");
    assert.equal(
      Buffer.from(content.body.body).toString("base64"),
      Buffer.from(png).toString("base64")
    );

    const storageFailure = new (class extends FakeStorage {
      override async put(): Promise<void> {
        throw new Error("storage offline");
      }
    })();
    const storageUnavailable = await resolveCreateAssetRequest(
      createAuthContext(userId, workspaceId),
      {
        file: {
          body: png,
          filename: "hero.png",
          mimeType: "image/png"
        },
        fileId,
        projectId: project?.id as string,
        scope: "file",
        workspaceId
      },
      client,
      storageFailure,
      minioContext
    );
    assert.equal(storageUnavailable.status, 503);
    assert.deepEqual(storageUnavailable.body, {
      error: "storage_unavailable"
    });

    const failingClient = {
      ...client,
      async query<T>(sql: string, values?: unknown[]) {
        if (sql.includes("insert into assets")) {
          throw new Error("write failed");
        }

        return client.query<T>(sql, values);
      }
    } satisfies DatabaseClient;
    const persistFailureStorage = new FakeStorage();
    const persistFailure = await resolveCreateAssetRequest(
      createAuthContext(userId, workspaceId),
      {
        file: {
          body: png,
          filename: "hero.png",
          mimeType: "image/png"
        },
        fileId,
        projectId: project?.id as string,
        scope: "file",
        workspaceId
      },
      failingClient,
      persistFailureStorage,
      minioContext
    );
    assert.equal(persistFailure.status, 500);
    assert.deepEqual(persistFailure.body, {
      error: "upload_persist_failed"
    });
    assert.equal(persistFailureStorage.objects.size, 0);
  });

  if (!ran) {
    t.skip("database unavailable");
  }
});
