import { createHash, randomBytes } from "node:crypto";
import { type PoolClient } from "pg";
import { createDatabasePool } from "./client.js";

const DEFAULT_USER_EMAIL = "dev@openmirage.local";
const DEFAULT_USER_NAME = "OpenMirage Dev";
const DEFAULT_WORKSPACE_NAME = "OpenMirage Dev";
const DEFAULT_WORKSPACE_SLUG = "openmirage-dev";
const DEFAULT_PROJECT_NAME = "Platform Bootstrap";
const DEFAULT_FILE_NAME = "Getting Started";
const DEFAULT_PAGE_NAME = "Page 1";

interface SeedResultRecord {
  created: boolean;
  id: string;
}

function requireRow<T>(rows: T[], context: string): T {
  const row = rows[0];

  if (!row) {
    throw new Error(`Expected a row for ${context}`);
  }

  return row;
}

export interface DevelopmentBootstrapSummary {
  user: SeedResultRecord;
  workspace: SeedResultRecord;
  membership: SeedResultRecord;
  project: SeedResultRecord;
  file: SeedResultRecord;
  page: SeedResultRecord;
  session: SeedResultRecord & {
    token: string | null;
  };
  magicLinkToken: SeedResultRecord & {
    token: string | null;
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function seedDevelopmentBootstrap(
  databaseUrl?: string
): Promise<DevelopmentBootstrapSummary> {
  const pool = createDatabasePool(databaseUrl);
  const client = await pool.connect();

  try {
    await client.query("begin");

    const user = await findOrCreateUser(client);
    const workspace = await findOrCreateWorkspace(client);
    const membership = await findOrCreateMembership(
      client,
      workspace.id,
      user.id
    );
    const project = await findOrCreateProject(client, workspace.id);
    const file = await findOrCreateFile(
      client,
      project.id,
      workspace.id,
      user.id
    );
    const page = await findOrCreatePage(client, file.id);
    const session = await findOrCreateSession(client, user.id);
    const magicLinkToken = await findOrCreateMagicLinkToken(client, user.id);
    const summary = {
      user,
      workspace,
      membership,
      project,
      file,
      page,
      session,
      magicLinkToken
    };

    await client.query("commit");

    return summary;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function findOrCreateUser(client: PoolClient): Promise<SeedResultRecord> {
  const existing = await client.query<{ id: string }>(
    `
      select id
      from users
      where lower(email) = lower($1)
      limit 1
    `,
    [DEFAULT_USER_EMAIL]
  );

  if (existing.rowCount) {
    const row = requireRow(existing.rows, "existing user");

    return {
      created: false,
      id: row.id
    };
  }

  const inserted = await client.query<{ id: string }>(
    `
      insert into users (email, display_name)
      values ($1, $2)
      returning id
    `,
    [DEFAULT_USER_EMAIL, DEFAULT_USER_NAME]
  );

  return {
    created: true,
    id: requireRow(inserted.rows, "inserted user").id
  };
}

async function findOrCreateWorkspace(
  client: PoolClient
): Promise<SeedResultRecord> {
  const existing = await client.query<{ id: string }>(
    `
      select id
      from workspaces
      where lower(slug) = lower($1)
      limit 1
    `,
    [DEFAULT_WORKSPACE_SLUG]
  );

  if (existing.rowCount) {
    const row = requireRow(existing.rows, "existing workspace");

    return {
      created: false,
      id: row.id
    };
  }

  const inserted = await client.query<{ id: string }>(
    `
      insert into workspaces (name, slug)
      values ($1, $2)
      returning id
    `,
    [DEFAULT_WORKSPACE_NAME, DEFAULT_WORKSPACE_SLUG]
  );

  return {
    created: true,
    id: requireRow(inserted.rows, "inserted workspace").id
  };
}

async function findOrCreateMembership(
  client: PoolClient,
  workspaceId: string,
  userId: string
): Promise<SeedResultRecord> {
  const existing = await client.query<{ id: string }>(
    `
      select id
      from memberships
      where workspace_id = $1
        and user_id = $2
      limit 1
    `,
    [workspaceId, userId]
  );

  if (existing.rowCount) {
    const row = requireRow(existing.rows, "existing membership");

    return {
      created: false,
      id: row.id
    };
  }

  const inserted = await client.query<{ id: string }>(
    `
      insert into memberships (workspace_id, user_id, role)
      values ($1, $2, 'owner')
      returning id
    `,
    [workspaceId, userId]
  );

  return {
    created: true,
    id: requireRow(inserted.rows, "inserted membership").id
  };
}

async function findOrCreateProject(
  client: PoolClient,
  workspaceId: string
): Promise<SeedResultRecord> {
  const existing = await client.query<{ id: string }>(
    `
      select id
      from projects
      where workspace_id = $1
        and name = $2
      limit 1
    `,
    [workspaceId, DEFAULT_PROJECT_NAME]
  );

  if (existing.rowCount) {
    const row = requireRow(existing.rows, "existing project");

    return {
      created: false,
      id: row.id
    };
  }

  const inserted = await client.query<{ id: string }>(
    `
      insert into projects (workspace_id, name)
      values ($1, $2)
      returning id
    `,
    [workspaceId, DEFAULT_PROJECT_NAME]
  );

  return {
    created: true,
    id: requireRow(inserted.rows, "inserted project").id
  };
}

async function findOrCreateFile(
  client: PoolClient,
  projectId: string,
  workspaceId: string,
  userId: string
): Promise<SeedResultRecord> {
  const existing = await client.query<{ id: string }>(
    `
      select id
      from files
      where project_id = $1
        and workspace_id = $2
        and name = $3
      limit 1
    `,
    [projectId, workspaceId, DEFAULT_FILE_NAME]
  );

  if (existing.rowCount) {
    const row = requireRow(existing.rows, "existing file");

    return {
      created: false,
      id: row.id
    };
  }

  const inserted = await client.query<{ id: string }>(
    `
      insert into files (project_id, workspace_id, name, created_by_user_id)
      values ($1, $2, $3, $4)
      returning id
    `,
    [projectId, workspaceId, DEFAULT_FILE_NAME, userId]
  );

  return {
    created: true,
    id: requireRow(inserted.rows, "inserted file").id
  };
}

async function findOrCreatePage(
  client: PoolClient,
  fileId: string
): Promise<SeedResultRecord> {
  const existing = await client.query<{ id: string }>(
    `
      select id
      from pages
      where file_id = $1
        and order_index = 0
      limit 1
    `,
    [fileId]
  );

  if (existing.rowCount) {
    const row = requireRow(existing.rows, "existing page");

    return {
      created: false,
      id: row.id
    };
  }

  const inserted = await client.query<{ id: string }>(
    `
      insert into pages (file_id, name, order_index, width, height, background)
      values ($1, $2, 0, 1440, 1024, '#ffffff')
      returning id
    `,
    [fileId, DEFAULT_PAGE_NAME]
  );

  return {
    created: true,
    id: requireRow(inserted.rows, "inserted page").id
  };
}

async function findOrCreateSession(
  client: PoolClient,
  userId: string
): Promise<SeedResultRecord & { token: string | null }> {
  const existing = await client.query<{ id: string }>(
    `
      select id
      from sessions
      where user_id = $1
        and revoked_at is null
        and expires_at > now()
      order by created_at asc
      limit 1
    `,
    [userId]
  );

  if (existing.rowCount) {
    const row = requireRow(existing.rows, "existing session");

    return {
      created: false,
      id: row.id,
      token: null
    };
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const inserted = await client.query<{ id: string }>(
    `
      insert into sessions (user_id, token_hash, expires_at)
      values ($1, $2, now() + interval '30 days')
      returning id
    `,
    [userId, tokenHash]
  );

  return {
    created: true,
    id: requireRow(inserted.rows, "inserted session").id,
    token
  };
}

async function findOrCreateMagicLinkToken(
  client: PoolClient,
  userId: string
): Promise<SeedResultRecord & { token: string | null }> {
  const existing = await client.query<{ id: string }>(
    `
      select id
      from magic_link_tokens
      where user_id = $1
        and revoked_at is null
        and consumed_at is null
        and expires_at > now()
      order by created_at asc
      limit 1
    `,
    [userId]
  );

  if (existing.rowCount) {
    const row = requireRow(existing.rows, "existing magic link token");

    return {
      created: false,
      id: row.id,
      token: null
    };
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const inserted = await client.query<{ id: string }>(
    `
      insert into magic_link_tokens (user_id, token_hash, expires_at)
      values ($1, $2, now() + interval '15 minutes')
      returning id
    `,
    [userId, tokenHash]
  );

  return {
    created: true,
    id: requireRow(inserted.rows, "inserted magic link token").id,
    token
  };
}
