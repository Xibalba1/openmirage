import { randomUUID } from "node:crypto";
import {
  createSetSessionCookieHeader,
  generateOpaqueToken,
  hashOpaqueToken,
  type SessionContract
} from "@openmirage/auth";
import {
  createFileWithPages,
  createProject,
  deriveDisplayName,
  seedPageDocument,
  upsertUserByEmail
} from "@openmirage/db";
import { type PageDocumentDto } from "@openmirage/types";

interface DatabaseClient {
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

interface DatabaseTransactionClient extends DatabaseClient {
  release(): void;
}

interface DatabasePoolLike extends DatabaseClient {
  connect(): Promise<DatabaseTransactionClient>;
}

interface SmokeFixtureRow {
  id: string;
}

export interface SmokeCollabFixture {
  documentName: string;
  fileId: string;
  pageId: string;
  projectId: string;
  sessionCookie: string;
  userId: string;
  workspaceId: string;
}

export interface SmokeCleanupInput {
  userId: string;
  workspaceId: string;
}

function requireDatabaseClient(
  poolOrClient?: DatabasePoolLike | DatabaseTransactionClient
): DatabasePoolLike | DatabaseTransactionClient {
  if (!poolOrClient) {
    throw new Error("smoke collab operations require a database client");
  }

  return poolOrClient;
}

async function withTransaction<T>(
  poolOrClient: DatabasePoolLike | DatabaseTransactionClient | undefined,
  callback: (client: DatabaseTransactionClient) => Promise<T>
): Promise<T> {
  const target = requireDatabaseClient(poolOrClient);

  if ("release" in target && "query" in target) {
    return callback(target);
  }

  const client = await target.connect();

  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function requireSharedSecret(
  configuredSecret: string | undefined,
  providedSecret: string | undefined
) {
  if (!configuredSecret) {
    const error = new Error("smoke testing is disabled");
    (error as Error & { statusCode?: number }).statusCode = 404;
    throw error;
  }

  if (providedSecret !== configuredSecret) {
    const error = new Error("invalid smoke test secret");
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
}

function createSmokeIdentity() {
  const suffix = randomUUID().slice(0, 8);
  const email = `smoke+${Date.now()}-${suffix}@openmirage.local`;
  const slug = `smoke-${Date.now()}-${suffix}`.toLowerCase();
  const workspaceName = `Smoke Verify ${suffix}`;

  return {
    email,
    slug,
    workspaceName
  };
}

function createSmokePageDocument(pageId: string): PageDocumentDto {
  return {
    nodes: {
      "frame-1": {
        background: {
          color: { alpha: 1, hex: "#ffffff" }
        },
        childIds: ["rect-1", "text-1"],
        clipsContent: false,
        cornerRadius: 24,
        createdAt: "2026-04-18T00:00:00.000Z",
        height: 360,
        id: "frame-1",
        locked: false,
        name: "Smoke Frame",
        opacity: 1,
        pageId,
        parentId: null,
        rotation: 0,
        stroke: {
          color: { alpha: 1, hex: "#d0d7de" },
          width: 2
        },
        type: "frame",
        updatedAt: "2026-04-18T00:00:00.000Z",
        visible: true,
        width: 520,
        x: 64,
        y: 72,
        zIndex: 0
      },
      "rect-1": {
        cornerRadius: 20,
        createdAt: "2026-04-18T00:00:00.000Z",
        fill: {
          color: { alpha: 1, hex: "#f5a24a" }
        },
        height: 180,
        id: "rect-1",
        locked: false,
        name: "Smoke Rectangle",
        opacity: 1,
        pageId,
        parentId: "frame-1",
        rotation: 0,
        shadow: null,
        stroke: null,
        type: "rectangle",
        updatedAt: "2026-04-18T00:00:00.000Z",
        visible: true,
        width: 220,
        x: 28,
        y: 36,
        zIndex: 0
      },
      "text-1": {
        content: "Smoke export fixture",
        createdAt: "2026-04-18T00:00:00.000Z",
        height: 72,
        id: "text-1",
        locked: false,
        name: "Smoke Title",
        opacity: 1,
        pageId,
        parentId: "frame-1",
        rotation: 0,
        typography: {
          color: { alpha: 1, hex: "#121212" },
          fontFamily: "IBM Plex Sans",
          fontSize: 28,
          fontWeight: 600,
          lineHeight: 1.2,
          textAlign: "left"
        },
        type: "text",
        updatedAt: "2026-04-18T00:00:00.000Z",
        visible: true,
        width: 240,
        x: 274,
        y: 96,
        zIndex: 1
      }
    },
    pageId,
    rootNodeIds: ["frame-1"]
  };
}

async function seedSmokeCollabDocument(
  pageId: string,
  poolOrClient: DatabaseTransactionClient
) {
  const pageDocument = createSmokePageDocument(pageId);
  await seedPageDocument(pageId, pageDocument, poolOrClient);
}

export function assertSmokeTestSharedSecret(
  configuredSecret: string | undefined,
  providedSecret: string | undefined
) {
  requireSharedSecret(configuredSecret, providedSecret);
}

export async function createSmokeCollabFixture(
  configuredSecret: string | undefined,
  providedSecret: string | undefined,
  sessionContract: SessionContract,
  poolOrClient?: DatabasePoolLike | DatabaseTransactionClient
): Promise<SmokeCollabFixture> {
  requireSharedSecret(configuredSecret, providedSecret);

  return withTransaction(poolOrClient, async (client) => {
    const identity = createSmokeIdentity();
    const displayName = deriveDisplayName(identity.email);
    const user = await upsertUserByEmail(
      {
        email: identity.email,
        displayName
      },
      client as Parameters<typeof upsertUserByEmail>[1]
    );
    const workspaceResult = await client.query<SmokeFixtureRow>(
      `
        insert into workspaces (name, slug)
        values ($1, $2)
        returning id
      `,
      [identity.workspaceName, identity.slug]
    );
    const workspaceId = workspaceResult.rows[0]?.id;

    if (!workspaceId) {
      throw new Error("failed to create smoke workspace");
    }

    await client.query(
      `
        insert into memberships (workspace_id, user_id, role)
        values ($1, $2, 'owner')
      `,
      [workspaceId, user.id]
    );

    const project = await createProject(
      user.id,
      workspaceId,
      "Smoke Verification Project",
      client as Parameters<typeof createProject>[3]
    );

    if (!project) {
      throw new Error("failed to create smoke project");
    }

    const file = await createFileWithPages(
      user.id,
      workspaceId,
      project.id,
      "Smoke Verification File",
      [{ name: "Smoke Verification Page" }],
      client as Parameters<typeof createFileWithPages>[5]
    );

    if (!file?.file.id || !file.defaultPageId) {
      throw new Error("failed to create smoke file");
    }

    await seedSmokeCollabDocument(file.defaultPageId, client);

    const sessionToken = generateOpaqueToken();
    const insertedSession = await client.query<SmokeFixtureRow>(
      `
        insert into sessions (user_id, token_hash, expires_at)
        values ($1, $2, now() + interval '30 days')
        returning id
      `,
      [user.id, hashOpaqueToken(sessionToken)]
    );

    if (!insertedSession.rows[0]?.id) {
      throw new Error("failed to create smoke session");
    }

    return {
      documentName: `page:${file.defaultPageId}`,
      fileId: file.file.id,
      pageId: file.defaultPageId,
      projectId: project.id,
      sessionCookie: createSetSessionCookieHeader(
        sessionToken,
        sessionContract
      ).split(";")[0] as string,
      userId: user.id,
      workspaceId
    };
  });
}

export async function cleanupSmokeCollabFixture(
  configuredSecret: string | undefined,
  providedSecret: string | undefined,
  input: SmokeCleanupInput,
  poolOrClient?: DatabasePoolLike | DatabaseTransactionClient
) {
  requireSharedSecret(configuredSecret, providedSecret);

  await withTransaction(poolOrClient, async (client) => {
    await client.query(
      `
        delete from workspaces
        where id = $1
      `,
      [input.workspaceId]
    );
    await client.query(
      `
        delete from users
        where id = $1
      `,
      [input.userId]
    );
  });

  return {
    ok: true
  };
}
