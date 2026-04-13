import { createHash, randomBytes } from "node:crypto";
import {
  type AuthContext,
  type AuthenticatedSession,
  type AuthenticatedUser,
  type MembershipRole,
  type WorkspaceMembershipSummary
} from "@openmirage/types";
import { type Pool, type PoolClient } from "pg";
import { createDatabasePool } from "./client.js";

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
}

interface SessionRow {
  session_id: string;
  session_expires_at: Date;
  user_id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
}

interface MembershipRow {
  id: string;
  workspace_id: string;
  role: MembershipRole;
}

export interface UpsertUserInput {
  email: string;
  displayName: string;
}

export interface IssuedSession {
  expiresAt: string;
  id: string;
  token: string;
}

export interface IssuedMagicLinkToken {
  expiresAt: string;
  id: string;
  token: string;
}

export interface MagicLinkRequestResult {
  user: AuthenticatedUser;
  magicLink: IssuedMagicLinkToken;
}

export interface ConsumedMagicLinkResult {
  authContext: AuthContext;
  sessionToken: string;
}

function mapUser(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url
  };
}

function mapSession(row: SessionRow): AuthenticatedSession {
  return {
    id: row.session_id,
    expiresAt: row.session_expires_at.toISOString()
  };
}

function mapMembership(row: MembershipRow): WorkspaceMembershipSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    role: row.role
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateOpaqueToken(): string {
  return randomBytes(24).toString("base64url");
}

function requireClient(poolOrClient?: Pool | PoolClient): Pool | PoolClient {
  return poolOrClient ?? createDatabasePool();
}

async function withTransaction<T>(
  poolOrClient: Pool | PoolClient | undefined,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const target = requireClient(poolOrClient);

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

export function deriveDisplayName(email: string): string {
  const localPart = email.split("@")[0] ?? "openmirage";
  const normalized = localPart.replace(/[._-]+/g, " ").trim();

  if (!normalized) {
    return "OpenMirage User";
  }

  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

export async function upsertUserByEmail(
  input: UpsertUserInput,
  poolOrClient?: Pool | PoolClient
): Promise<AuthenticatedUser> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const db = requireClient(poolOrClient);

  const result = await db.query<UserRow>(
    `
      insert into users (email, display_name)
      values ($1, $2)
      on conflict ((lower(email)))
      do update set
        display_name = users.display_name,
        updated_at = now()
      returning id, email, display_name, avatar_url
    `,
    [email, displayName]
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Failed to upsert user by email");
  }

  return mapUser(row);
}

export async function issueMagicLinkForEmail(
  input: UpsertUserInput & {
    ttlMinutes: number;
  },
  poolOrClient?: Pool | PoolClient
): Promise<MagicLinkRequestResult> {
  return withTransaction(poolOrClient, async (client) => {
    const user = await upsertUserByEmail(input, client);
    const token = generateOpaqueToken();
    const result = await client.query<{ id: string; expires_at: Date }>(
      `
        insert into magic_link_tokens (user_id, token_hash, expires_at)
        values ($1, $2, now() + ($3 * interval '1 minute'))
        returning id, expires_at
      `,
      [user.id, hashToken(token), input.ttlMinutes]
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error("Failed to create magic link token");
    }

    return {
      user,
      magicLink: {
        id: row.id,
        token,
        expiresAt: row.expires_at.toISOString()
      }
    };
  });
}

export async function consumeMagicLinkToken(
  token: string,
  sessionTtlDays: number,
  poolOrClient?: Pool | PoolClient
): Promise<ConsumedMagicLinkResult | null> {
  return withTransaction(poolOrClient, async (client) => {
    const consumed = await client.query<{ user_id: string }>(
      `
        update magic_link_tokens
        set consumed_at = now()
        where token_hash = $1
          and consumed_at is null
          and revoked_at is null
          and expires_at > now()
        returning user_id
      `,
      [hashToken(token)]
    );
    const magicLink = consumed.rows[0];

    if (!magicLink) {
      return null;
    }

    const sessionToken = generateOpaqueToken();
    const insertedSession = await client.query<{
      id: string;
      expires_at: Date;
    }>(
      `
        insert into sessions (user_id, token_hash, expires_at)
        values ($1, $2, now() + ($3 * interval '1 day'))
        returning id, expires_at
      `,
      [magicLink.user_id, hashToken(sessionToken), sessionTtlDays]
    );

    const sessionContext = await getAuthContextForSessionToken(
      sessionToken,
      client
    );

    if (!sessionContext) {
      throw new Error("Failed to load auth context after session creation");
    }

    return {
      authContext: {
        ...sessionContext,
        session: {
          id: insertedSession.rows[0]?.id ?? sessionContext.session.id,
          expiresAt:
            insertedSession.rows[0]?.expires_at.toISOString() ??
            sessionContext.session.expiresAt
        }
      },
      sessionToken
    };
  });
}

export async function getAuthContextForSessionToken(
  token: string,
  poolOrClient?: Pool | PoolClient
): Promise<AuthContext | null> {
  const db = requireClient(poolOrClient);
  const sessionResult = await db.query<SessionRow>(
    `
      select
        sessions.id as session_id,
        sessions.expires_at as session_expires_at,
        users.id as user_id,
        users.email,
        users.display_name,
        users.avatar_url
      from sessions
      inner join users
        on users.id = sessions.user_id
      where sessions.token_hash = $1
        and sessions.revoked_at is null
        and sessions.expires_at > now()
      limit 1
    `,
    [hashToken(token)]
  );
  const sessionRow = sessionResult.rows[0];

  if (!sessionRow) {
    return null;
  }

  const membershipsResult = await db.query<MembershipRow>(
    `
      select id, workspace_id, role
      from memberships
      where user_id = $1
      order by created_at asc
    `,
    [sessionRow.user_id]
  );

  return {
    session: mapSession(sessionRow),
    user: mapUser({
      id: sessionRow.user_id,
      email: sessionRow.email,
      display_name: sessionRow.display_name,
      avatar_url: sessionRow.avatar_url
    }),
    memberships: membershipsResult.rows.map(mapMembership)
  };
}

export async function refreshSession(
  token: string,
  sessionTtlDays: number,
  poolOrClient?: Pool | PoolClient
): Promise<AuthContext | null> {
  const db = requireClient(poolOrClient);
  const refreshed = await db.query<{ id: string }>(
    `
      update sessions
      set expires_at = now() + ($2 * interval '1 day'),
          updated_at = now()
      where token_hash = $1
        and revoked_at is null
        and expires_at > now()
      returning id
    `,
    [hashToken(token), sessionTtlDays]
  );

  if (!refreshed.rows[0]) {
    return null;
  }

  return getAuthContextForSessionToken(token, db);
}

export async function revokeSession(
  token: string,
  poolOrClient?: Pool | PoolClient
): Promise<boolean> {
  const db = requireClient(poolOrClient);
  const result = await db.query<{ id: string }>(
    `
      update sessions
      set revoked_at = now(),
          updated_at = now()
      where token_hash = $1
        and revoked_at is null
      returning id
    `,
    [hashToken(token)]
  );

  return Boolean(result.rows[0]);
}
