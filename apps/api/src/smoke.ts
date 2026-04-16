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
  upsertUserByEmail
} from "@openmirage/db";

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
