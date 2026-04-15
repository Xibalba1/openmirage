import { createHash, randomBytes } from "node:crypto";
import { type PageDocumentDto } from "@openmirage/types";
import { type PoolClient } from "pg";
import * as Y from "yjs";
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
    await ensurePageCollabDocument(client, page.id);
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

function buildBootstrapPageDocument(pageId: string): PageDocumentDto {
  const timestamp = new Date().toISOString();

  return {
    nodes: {
      "frame-root": {
        background: {
          color: { alpha: 1, hex: "#ffffff" }
        },
        childIds: ["title-text", "hero-card", "hero-group", "accent-line"],
        clipsContent: false,
        cornerRadius: 28,
        createdAt: timestamp,
        height: 760,
        id: "frame-root",
        locked: false,
        name: "App Frame",
        opacity: 1,
        pageId,
        parentId: null,
        rotation: 0,
        stroke: {
          color: { alpha: 1, hex: "#d7e0e8" },
          width: 1
        },
        type: "frame",
        updatedAt: timestamp,
        visible: true,
        width: 1180,
        x: 120,
        y: 120,
        zIndex: 0
      },
      "title-text": {
        content: "OpenMirage Sprint 4",
        createdAt: timestamp,
        height: 48,
        id: "title-text",
        locked: false,
        name: "Title",
        opacity: 1,
        pageId,
        parentId: "frame-root",
        rotation: 0,
        typography: {
          color: { alpha: 1, hex: "#132c35" },
          fontFamily: "IBM Plex Sans",
          fontSize: 32,
          fontWeight: 700,
          lineHeight: 40,
          textAlign: "left"
        },
        type: "text",
        updatedAt: timestamp,
        visible: true,
        width: 420,
        x: 48,
        y: 40,
        zIndex: 0
      },
      "hero-card": {
        cornerRadius: 24,
        createdAt: timestamp,
        fill: {
          color: { alpha: 1, hex: "#f5a24a" }
        },
        height: 220,
        id: "hero-card",
        locked: false,
        name: "Hero Card",
        opacity: 1,
        pageId,
        parentId: "frame-root",
        rotation: 0,
        shadow: null,
        stroke: null,
        type: "rectangle",
        updatedAt: timestamp,
        visible: true,
        width: 360,
        x: 56,
        y: 128,
        zIndex: 0
      },
      "hero-group": {
        childIds: ["group-ellipse", "group-image"],
        createdAt: timestamp,
        height: 300,
        id: "hero-group",
        locked: false,
        name: "Hero Cluster",
        opacity: 1,
        pageId,
        parentId: "frame-root",
        rotation: 0,
        type: "group",
        updatedAt: timestamp,
        visible: true,
        width: 360,
        x: 580,
        y: 160,
        zIndex: 1
      },
      "group-ellipse": {
        createdAt: timestamp,
        fill: {
          color: { alpha: 1, hex: "#5fabc0" }
        },
        height: 180,
        id: "group-ellipse",
        locked: false,
        name: "Accent Ellipse",
        opacity: 0.95,
        pageId,
        parentId: "hero-group",
        rotation: 0,
        shadow: null,
        stroke: null,
        type: "ellipse",
        updatedAt: timestamp,
        visible: true,
        width: 180,
        x: 36,
        y: 16,
        zIndex: 0
      },
      "group-image": {
        assetId: "seed-image-placeholder",
        createdAt: timestamp,
        fitMode: "cover",
        height: 220,
        id: "group-image",
        locked: false,
        name: "Image Placeholder",
        opacity: 1,
        pageId,
        parentId: "hero-group",
        rotation: 0,
        type: "image",
        updatedAt: timestamp,
        visible: true,
        width: 220,
        x: 92,
        y: 62,
        zIndex: 1
      },
      "accent-line": {
        createdAt: timestamp,
        height: 0,
        id: "accent-line",
        locked: false,
        name: "Divider",
        opacity: 1,
        pageId,
        parentId: "frame-root",
        rotation: 0,
        stroke: {
          color: { alpha: 1, hex: "#132c35" },
          width: 4
        },
        type: "line",
        updatedAt: timestamp,
        visible: true,
        width: 0,
        x: 56,
        x2: 520,
        y: 404,
        y2: 404,
        zIndex: 2
      }
    },
    pageId,
    rootNodeIds: ["frame-root"]
  };
}

async function ensurePageCollabDocument(
  client: PoolClient,
  pageId: string
): Promise<void> {
  const existing = await client.query<{ has_state: boolean }>(
    `
      select exists (
        select 1
        from collab_page_snapshots
        where page_id = $1
      ) or exists (
        select 1
        from collab_page_updates
        where page_id = $1
      ) as has_state
    `,
    [pageId]
  );

  if (existing.rows[0]?.has_state) {
    return;
  }

  const document = new Y.Doc();
  const pageMap = document.getMap<unknown>("page");
  const pageDocument = buildBootstrapPageDocument(pageId);
  pageMap.set("rootNodeIds", pageDocument.rootNodeIds);
  pageMap.set("nodes", pageDocument.nodes);

  await client.query(
    `
      insert into collab_page_snapshots (
        page_id,
        snapshot_update,
        state_vector,
        update_count,
        last_compacted_seq,
        created_at,
        updated_at
      )
      values ($1, $2, $3, 0, 0, now(), now())
      on conflict (page_id) do nothing
    `,
    [
      pageId,
      Buffer.from(Y.encodeStateAsUpdate(document)),
      Buffer.from(Y.encodeStateVector(document))
    ]
  );
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
