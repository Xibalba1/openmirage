import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabasePool } from "@openmirage/db";
import { type FastifyInstance } from "fastify";
import { createApiApp } from "./index.js";

interface QueryableClient {
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
}

export interface ApiTestContext {
  app: FastifyInstance;
  client: QueryableClient;
  storageRoot: string;
}

export async function withApiTestApp(
  callback: (context: ApiTestContext) => Promise<void>
): Promise<boolean> {
  const pool = createDatabasePool();

  try {
    await pool.query("select 1");
  } catch {
    await pool.end();
    return false;
  }

  const client = await pool.connect();
  const storageRoot = mkdtempSync(
    path.join(os.tmpdir(), "openmirage-api-routes-")
  );

  await client.query("begin");

  const runtime = await createApiApp({
    databasePool: client,
    envSource: {
      APP_BASE_URL: "http://127.0.0.1",
      DATABASE_URL: "postgres://openmirage:openmirage@127.0.0.1:5432/openmirage",
      DEV_AUTH_EXPOSE_MAGIC_LINK: "true",
      OPENMIRAGE_ENV: "development",
      SESSION_COOKIE_SECURE: "false",
      SMOKE_TEST_SHARED_SECRET: "openmirage-smoke-secret",
      STORAGE_LOCAL_ROOT: storageRoot,
      STORAGE_PROVIDER: "local"
    },
    registerProcessHandlers: false
  });

  try {
    await callback({
      app: runtime.app,
      client,
      storageRoot
    });
  } finally {
    await runtime.app.close();
    await client.query("rollback");
    client.release();
    await pool.end();
    rmSync(storageRoot, {
      force: true,
      recursive: true
    });
  }

  return true;
}

export function readJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

export async function insertWorkspace(
  client: QueryableClient,
  name: string,
  slug: string
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `
      insert into workspaces (name, slug)
      values ($1, $2)
      returning id
    `,
    [name, slug]
  );

  const row = result.rows[0];
  assert.ok(row, "expected inserted workspace");
  return row.id;
}

export async function insertMembership(
  client: QueryableClient,
  workspaceId: string,
  userId: string,
  role: "owner" | "editor" | "viewer" = "owner"
): Promise<void> {
  await client.query(
    `
      insert into memberships (workspace_id, user_id, role)
      values ($1, $2, $3)
    `,
    [workspaceId, userId, role]
  );
}

export async function readUserIdByEmail(
  client: QueryableClient,
  email: string
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `
      select id
      from users
      where lower(email) = lower($1)
      limit 1
    `,
    [email]
  );

  const row = result.rows[0];
  assert.ok(row, "expected user row");
  return row.id;
}

export async function createAuthenticatedCookie(
  app: FastifyInstance,
  email: string
): Promise<string> {
  const request = await app.inject({
    method: "POST",
    payload: {
      email
    },
    url: "/auth/magic-link/request"
  });

  assert.equal(request.statusCode, 200);
  const requestBody = readJson<{ magicLinkUrl?: string }>(request.body);
  assert.ok(requestBody.magicLinkUrl, "expected development magic link url");

  const consumeUrl = new URL(requestBody.magicLinkUrl);
  const consume = await app.inject({
    method: "GET",
    url: `${consumeUrl.pathname}${consumeUrl.search}`
  });

  assert.equal(consume.statusCode, 302);
  const cookieHeader = consume.headers["set-cookie"];
  const firstCookie = Array.isArray(cookieHeader)
    ? cookieHeader[0]
    : cookieHeader;
  assert.ok(firstCookie, "expected set-cookie header");

  return firstCookie.split(";")[0] ?? "";
}

export function buildMultipartPayload(input: {
  fields: Record<string, string>;
  file: {
    body: Buffer;
    contentType: string;
    fieldName: string;
    filename: string;
  };
}): { body: Buffer; contentType: string } {
  const boundary = `----openmirage-${Date.now().toString(36)}`;
  const chunks: Buffer[] = [];

  for (const [name, value] of Object.entries(input.fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  }

  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${input.file.fieldName}"; filename="${input.file.filename}"\r\nContent-Type: ${input.file.contentType}\r\n\r\n`
    )
  );
  chunks.push(input.file.body);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}
