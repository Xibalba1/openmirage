import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const baseUrlInput =
  process.env.STAGING_PUBLIC_BASE_URL ??
  process.env.OPENMIRAGE_PUBLIC_BASE_URL ??
  process.argv[2];

if (!baseUrlInput) {
  console.error(
    "[openmirage] STAGING_PUBLIC_BASE_URL or OPENMIRAGE_PUBLIC_BASE_URL is required"
  );
  process.exit(1);
}

const baseUrl = baseUrlInput.replace(/\/+$/, "");

function log(message) {
  console.log(`[openmirage] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

async function request(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    body,
    text
  };
}

async function expectOk(path) {
  const response = await request(`${baseUrl}${path}`);

  if (!response.ok) {
    fail(`GET ${path} returned ${response.status}: ${response.text}`);
  }

  return response.body;
}

async function createAuthenticatedCollabFixture() {
  log("verifying authenticated page-scoped collaboration bootstrap");

  const magicLinkRequest = await request(`${baseUrl}/auth/magic-link/request`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email: "dev@openmirage.local"
    })
  });

  if (!magicLinkRequest.ok) {
    fail(
      `magic link request failed: ${magicLinkRequest.status} ${magicLinkRequest.text}`
    );
  }

  const magicLinkUrl = magicLinkRequest.body?.magicLinkUrl;

  if (typeof magicLinkUrl !== "string" || magicLinkUrl.length === 0) {
    fail(
      "authenticated collab verification requires DEV_AUTH_EXPOSE_MAGIC_LINK=true so the verifier can consume a session"
    );
  }

  const consumeResponse = await fetch(magicLinkUrl, {
    redirect: "manual"
  });
  const setCookieHeader = consumeResponse.headers.get("set-cookie");

  if (consumeResponse.status !== 302 || !setCookieHeader) {
    fail("magic link consume did not issue a session cookie");
  }

  const sessionCookie = setCookieHeader.split(";")[0];
  const session = await request(`${baseUrl}/auth/session`, {
    headers: {
      cookie: sessionCookie
    }
  });

  if (!session.ok) {
    fail(`auth/session failed: ${session.status} ${session.text}`);
  }

  const workspaceId = session.body?.memberships?.[0]?.workspaceId;

  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    fail("authenticated collab verification did not find a workspace");
  }

  const project = await request(
    `${baseUrl}/v1/workspaces/${encodeURIComponent(workspaceId)}/projects`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie
      },
      body: JSON.stringify({
        name: `Staging Collab Verify ${Date.now()}`
      })
    }
  );

  if (!project.ok || typeof project.body?.id !== "string") {
    fail(
      `project creation failed: ${project.status} ${typeof project.body === "string" ? project.body : JSON.stringify(project.body)}`
    );
  }

  const file = await request(
    `${baseUrl}/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(project.body.id)}/files`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie
      },
      body: JSON.stringify({
        initialPages: [{ name: "Verification Page" }],
        name: `Staging Collab Verify File ${Date.now()}`
      })
    }
  );

  const fileId = file.body?.file?.id;
  const pageId = file.body?.defaultPageId ?? file.body?.pages?.[0]?.id;

  if (!file.ok || typeof fileId !== "string" || typeof pageId !== "string") {
    fail(
      `file creation failed: ${file.status} ${typeof file.body === "string" ? file.body : JSON.stringify(file.body)}`
    );
  }

  return {
    fileId,
    pageId,
    sessionCookie,
    workspaceId
  };
}

async function verifyHttpSurface() {
  log("verifying web, api, collab, and worker routes");

  const homepage = await request(`${baseUrl}/`);

  if (!homepage.ok) {
    fail(`GET / returned ${homepage.status}`);
  }

  const health = await expectOk("/healthz");

  if (!health?.ok) {
    fail("/healthz did not report ok");
  }

  const ready = await expectOk("/readyz");

  if (!ready?.ok || !ready?.ready) {
    fail("/readyz did not report ready");
  }

  const collabHealth = await expectOk("/collab/healthz");

  if (!collabHealth?.ok) {
    fail("/collab/healthz did not report ok");
  }

  const workerReady = await expectOk("/worker/readyz");

  if (!workerReady?.ok || !workerReady?.ready) {
    fail("/worker/readyz did not report ready");
  }
}

async function verifyStorageSmoke() {
  log("verifying storage smoke path through the public origin");

  const smokeKey = `smoke/staging-${Date.now()}.txt`;
  const initialList = await expectOk("/internal/storage/smoke");

  if (!Array.isArray(initialList?.objects)) {
    fail("initial storage smoke response did not include objects");
  }

  const upload = await request(`${baseUrl}/internal/storage/smoke`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      key: smokeKey,
      contentType: "text/plain",
      bodyBase64: Buffer.from("openmirage staging verification").toString(
        "base64"
      )
    })
  });

  if (!upload.ok || upload.body?.object?.key !== smokeKey) {
    fail(
      `storage upload failed: ${upload.status} ${typeof upload.body === "string" ? upload.body : JSON.stringify(upload.body)}`
    );
  }

  const listed = await expectOk("/internal/storage/smoke");

  if (!listed.objects.some((entry) => entry.key === smokeKey)) {
    fail("uploaded storage smoke object was not listed");
  }

  const deleted = await request(
    `${baseUrl}/internal/storage/smoke?key=${encodeURIComponent(smokeKey)}`,
    {
      method: "DELETE"
    }
  );

  if (!deleted.ok) {
    fail(`storage delete failed: ${deleted.status} ${deleted.text}`);
  }

  const finalList = await expectOk("/internal/storage/smoke");

  if (finalList.objects.some((entry) => entry.key === smokeKey)) {
    fail("deleted storage smoke object still appears in the final list");
  }
}

function verifyWebsocketUpgrade() {
  log("verifying websocket upgrade behavior at /collab");

  const headersFile = `${process.cwd()}/.openmirage-staging-ws-headers.txt`;
  try {
    const result = spawnSync(
      "curl",
      [
        "--http1.1",
        "-sS",
        "-o",
        "/dev/null",
        "-D",
        headersFile,
        "-H",
        "Connection: Upgrade",
        "-H",
        "Upgrade: websocket",
        "-H",
        "Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==",
        "-H",
        "Sec-WebSocket-Version: 13",
        `${baseUrl}/collab`
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8"
      }
    );

    if (result.status !== 0 && result.status !== 52) {
      fail(
        result.stderr.trim() ||
          result.stdout.trim() ||
          "curl websocket probe failed"
      );
    }

    const output = readFileSync(headersFile, "utf8");

    if (!/^HTTP\/1\.1 (101|401)/m.test(output)) {
      fail(`unexpected websocket probe response:\n${output}`);
    }
  } finally {
    rmSync(headersFile, { force: true });
  }
}

function verifyAuthenticatedCollabWebsocket(fixture) {
  log("verifying authenticated page-scoped collab sync at /collab");

  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "@openmirage/collab",
      "exec",
      "node",
      "--input-type=module",
      "-e",
      `import WebSocket from "ws";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
const baseUrl = ${JSON.stringify(baseUrl)};
const collabUrl = new URL("/collab", baseUrl);
collabUrl.protocol = collabUrl.protocol === "https:" ? "wss:" : "ws:";
collabUrl.searchParams.set("documentName", ${JSON.stringify(`page:${fixture.pageId}`)});
collabUrl.searchParams.set("fileId", ${JSON.stringify(fixture.fileId)});
collabUrl.searchParams.set("pageId", ${JSON.stringify(fixture.pageId)});
collabUrl.searchParams.set("workspaceId", ${JSON.stringify(fixture.workspaceId)});
const documentName = ${JSON.stringify(`page:${fixture.pageId}`)};
const doc = new Y.Doc();
let authenticated = false;
function writeAuth() {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, 2);
  encoding.writeVarUint(encoder, 0);
  encoding.writeVarString(encoder, "");
  return encoding.toUint8Array(encoder);
}
function writeSyncStep1() {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}
const ws = new WebSocket(collabUrl, {
  headers: { Cookie: ${JSON.stringify(fixture.sessionCookie)} }
});
const timer = setTimeout(() => {
  console.error("timeout");
  process.exit(1);
}, 5000);
ws.on("open", () => {
  ws.send(writeAuth());
});
ws.on("message", (raw) => {
  const message = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const decoder = decoding.createDecoder(message);
  const incomingDocumentName = decoding.readVarString(decoder);
  if (incomingDocumentName !== documentName) {
    return;
  }
  const messageType = decoding.readVarUint(decoder);
  if (messageType === 2) {
    const authType = decoding.readVarUint(decoder);
    if (authType === 2) {
      authenticated = true;
      ws.send(writeSyncStep1());
      return;
    }
    console.error("unexpected-auth");
    process.exit(1);
  }
  if ((messageType === 0 || messageType === 4) && authenticated) {
    const encoder = encoding.createEncoder();
    encoding.writeVarString(encoder, documentName);
    encoding.writeVarUint(encoder, 0);
    syncProtocol.readSyncMessage(decoder, encoder, doc, "remote");
    clearTimeout(timer);
    console.log("open+sync");
    ws.close();
  }
});
ws.on("error", (error) => {
  clearTimeout(timer);
  console.error(error.message);
  process.exit(1);
});
ws.on("close", () => process.exit(authenticated ? 0 : 1));`
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  if (result.status !== 0) {
    fail(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "authenticated collab websocket verification failed"
    );
  }
}

async function main() {
  log(`verifying staging deploy at ${baseUrl}`);
  await verifyHttpSurface();
  await verifyStorageSmoke();
  verifyWebsocketUpgrade();
  const collabFixture = await createAuthenticatedCollabFixture();
  verifyAuthenticatedCollabWebsocket(collabFixture);
  log("staging deploy verification passed");
}

main().catch((error) => {
  console.error(
    `[openmirage] staging deploy verification failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
