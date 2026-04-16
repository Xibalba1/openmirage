import { spawnSync } from "node:child_process";

const caddyBaseUrl = process.env.CADDY_BASE_URL ?? "http://127.0.0.1";
const expectedCookieName =
  process.env.SESSION_COOKIE_NAME ?? "openmirage_session";
const expectedCookiePath = process.env.SESSION_COOKIE_PATH ?? "/";
const expectedCookieSameSite = process.env.SESSION_COOKIE_SAME_SITE ?? "lax";
const expectedSecureCookie =
  (process.env.SESSION_COOKIE_SECURE ?? "false") === "true";
const verifyDiagnosticsErrorRoute =
  (process.env.OPENMIRAGE_VERIFY_ERROR_ROUTE ?? "false") === "true";

function log(message) {
  console.log(`[openmirage] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "pipe",
    ...options
  });

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    fail(stderr || stdout || `${command} ${args.join(" ")} failed`);
  }

  return result;
}

async function waitForJson(url, timeoutMs = 60_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return response.json();
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  fail(`timed out waiting for ${url}`);
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    fail(
      `${init?.method ?? "GET"} ${url} returned ${response.status}: ${text}`
    );
  }

  return {
    body,
    headers: response.headers
  };
}

async function createAuthenticatedCollabFixture(baseUrl, sessionCookie) {
  const sessionResponse = await requestJson(`${baseUrl}/auth/session`, {
    headers: {
      cookie: sessionCookie
    }
  });
  const workspaceId = sessionResponse.body.memberships?.[0]?.workspaceId;

  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    fail(
      "seed bootstrap did not provide a workspace membership for collab verification"
    );
  }

  const projectResponse = await requestJson(
    `${baseUrl}/v1/workspaces/${encodeURIComponent(workspaceId)}/projects`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie
      },
      body: JSON.stringify({
        name: `Collab Verify ${Date.now()}`
      })
    }
  );
  const projectId = projectResponse.body.id;

  if (typeof projectId !== "string" || projectId.length === 0) {
    fail("collab verification project creation did not return an id");
  }

  const fileResponse = await requestJson(
    `${baseUrl}/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/files`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie
      },
      body: JSON.stringify({
        initialPages: [{ name: "Verification Page" }],
        name: `Collab Verify File ${Date.now()}`
      })
    }
  );
  const fileId = fileResponse.body.file?.id;
  const pageId =
    fileResponse.body.defaultPageId ?? fileResponse.body.pages?.[0]?.id;

  if (typeof fileId !== "string" || fileId.length === 0) {
    fail("collab verification file creation did not return a file id");
  }

  if (typeof pageId !== "string" || pageId.length === 0) {
    fail("collab verification file creation did not return a page id");
  }

  return {
    fileId,
    pageId,
    workspaceId
  };
}

function cleanup() {
  spawnSync("docker", ["compose", "down", "--remove-orphans"], {
    cwd: process.cwd(),
    stdio: "inherit"
  });
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

async function verifyHomepage() {
  const response = await fetch(`${caddyBaseUrl}/`);
  const body = await response.text();

  if (
    !response.ok ||
    !body.includes("<title>OpenMirage Platform Shell</title>")
  ) {
    fail("homepage did not render the platform shell through Caddy");
  }
}

async function verifyApiAndStorage() {
  const health = await waitForJson(`${caddyBaseUrl}/healthz`);

  if (!health.ok) {
    fail("api /healthz did not report healthy through Caddy");
  }

  const ready = await waitForJson(`${caddyBaseUrl}/readyz`);

  if (!ready.ready) {
    fail("api /readyz did not report ready through Caddy");
  }

  const smokeKey = `smoke/verify-${Date.now()}.txt`;
  const initialList = await waitForJson(
    `${caddyBaseUrl}/internal/storage/smoke`
  );

  if (!Array.isArray(initialList.objects)) {
    fail("storage smoke list did not return an objects array");
  }

  const uploaded = await requestJson(`${caddyBaseUrl}/internal/storage/smoke`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      key: smokeKey,
      contentType: "text/plain",
      bodyBase64: Buffer.from("openmirage verification").toString("base64")
    })
  });

  if (uploaded.body.object?.key !== smokeKey) {
    fail("storage smoke upload did not return the expected key");
  }

  const listed = await requestJson(`${caddyBaseUrl}/internal/storage/smoke`);

  if (!listed.body.objects.some((entry) => entry.key === smokeKey)) {
    fail("uploaded smoke object was not listed by the api");
  }

  await requestJson(
    `${caddyBaseUrl}/internal/storage/smoke?key=${encodeURIComponent(smokeKey)}`,
    {
      method: "DELETE"
    }
  );

  const finalList = await requestJson(`${caddyBaseUrl}/internal/storage/smoke`);

  if (finalList.body.objects.some((entry) => entry.key === smokeKey)) {
    fail("deleted smoke object still appears in the api list");
  }
}

async function verifyMetrics() {
  const metricsChecks = [
    {
      name: "api",
      path: "/metrics",
      patterns: ["openmirage_service_health", 'service="api"']
    },
    {
      name: "collab",
      path: "/collab/metrics",
      patterns: ["openmirage_service_health", 'service="collab"']
    },
    {
      name: "worker",
      path: "/worker/metrics",
      patterns: ["openmirage_service_health", 'service="worker"']
    }
  ];

  for (const check of metricsChecks) {
    const response = await fetch(`${caddyBaseUrl}${check.path}`);
    const body = await response.text();

    if (!response.ok) {
      fail(`${check.name} metrics endpoint did not respond successfully`);
    }

    for (const pattern of check.patterns) {
      if (!body.includes(pattern)) {
        fail(`${check.name} metrics endpoint did not include ${pattern}`);
      }
    }
  }
}

function verifyDockerLogs() {
  const result = run("docker", [
    "compose",
    "logs",
    "--no-color",
    "--tail",
    "200",
    "caddy",
    "api",
    "collab",
    "worker"
  ]);
  const body = result.stdout;

  for (const pattern of [
    '"service":"api"',
    '"service":"collab"',
    '"service":"worker"',
    "magic link requested",
    "worker heartbeat",
    "collab websocket accepted"
  ]) {
    if (!body.includes(pattern)) {
      fail(`docker compose logs output did not include ${pattern}`);
    }
  }
}

async function verifyCollabAndWorker() {
  const collabHealth = await waitForJson(`${caddyBaseUrl}/collab/healthz`);

  if (!collabHealth.ok || collabHealth.details.websocketPath !== "/collab") {
    fail("collab /healthz did not report the expected websocket path");
  }

  const workerReady = await waitForJson(`${caddyBaseUrl}/worker/readyz`);

  if (!workerReady.ready) {
    fail("worker /readyz did not report ready through Caddy");
  }

  const workerStatus = await waitForJson(`${caddyBaseUrl}/worker/status`);

  if (workerStatus.service !== "worker") {
    fail("worker /status did not return a worker heartbeat");
  }
}

async function verifyAuthAndWebsocket() {
  const magicLinkRequest = await requestJson(
    `${caddyBaseUrl}/auth/magic-link/request`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        email: "dev@openmirage.local"
      })
    }
  );
  const magicLinkUrl = magicLinkRequest.body.magicLinkUrl;

  if (typeof magicLinkUrl !== "string" || !magicLinkUrl.includes("/auth/")) {
    fail("magic link request did not return a Caddy-routed magic link url");
  }

  if (new URL(magicLinkUrl).origin !== new URL(caddyBaseUrl).origin) {
    fail("magic link request did not use the expected public Caddy origin");
  }

  const consumeResponse = await fetch(magicLinkUrl, {
    redirect: "manual"
  });
  const setCookieHeader = consumeResponse.headers.get("set-cookie");

  if (consumeResponse.status !== 302 || !setCookieHeader) {
    fail("magic link consume did not issue a session cookie");
  }

  if (!setCookieHeader.startsWith(`${expectedCookieName}=`)) {
    fail("magic link consume did not issue the expected session cookie name");
  }

  if (!setCookieHeader.includes(`Path=${expectedCookiePath}`)) {
    fail("magic link consume did not issue the expected session cookie path");
  }

  if (
    !setCookieHeader.includes(`SameSite=${capitalize(expectedCookieSameSite)}`)
  ) {
    fail(
      "magic link consume did not issue the expected session cookie same-site policy"
    );
  }

  if (expectedSecureCookie && !setCookieHeader.includes("Secure")) {
    fail("magic link consume did not issue a secure session cookie");
  }

  if (!expectedSecureCookie && setCookieHeader.includes("Secure")) {
    fail("magic link consume unexpectedly issued a secure session cookie");
  }

  const sessionCookie = setCookieHeader.split(";")[0];
  const collabFixture = await createAuthenticatedCollabFixture(
    caddyBaseUrl,
    sessionCookie
  );

  const websocketProbe = spawnSync(
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
const documentName = ${JSON.stringify(`page:${collabFixture.pageId}`)};
const ws = new WebSocket(${JSON.stringify(`ws://127.0.0.1/collab?documentName=${encodeURIComponent(`page:${collabFixture.pageId}`)}&fileId=${encodeURIComponent(collabFixture.fileId)}&pageId=${encodeURIComponent(collabFixture.pageId)}&workspaceId=${encodeURIComponent(collabFixture.workspaceId)}`)}, {
  headers: { Cookie: ${JSON.stringify(sessionCookie)} }
});
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
ws.on("close", () => process.exit(0));`
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  if (websocketProbe.status !== 0) {
    fail(
      websocketProbe.stderr.trim() ||
        websocketProbe.stdout.trim() ||
        "websocket verification through Caddy failed"
    );
  }

  const unauthenticatedProbe = spawnSync(
    "pnpm",
    [
      "--filter",
      "@openmirage/collab",
      "exec",
      "node",
      "--input-type=module",
      "-e",
      `import WebSocket from "ws";
const ws = new WebSocket(${JSON.stringify(`ws://127.0.0.1/collab?documentName=${encodeURIComponent(`page:${collabFixture.pageId}`)}&fileId=${encodeURIComponent(collabFixture.fileId)}&pageId=${encodeURIComponent(collabFixture.pageId)}&workspaceId=${encodeURIComponent(collabFixture.workspaceId)}`)});
const timer = setTimeout(() => {
  console.error("timeout");
  process.exit(1);
}, 5000);
ws.on("unexpected-response", (_request, response) => {
  clearTimeout(timer);
  console.log(String(response.statusCode));
  process.exit(response.statusCode === 401 ? 0 : 1);
});
ws.on("open", () => {
  clearTimeout(timer);
  console.error("unexpected-open");
  process.exit(1);
});
ws.on("error", () => {});
ws.on("close", () => process.exit(0));`
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  if (unauthenticatedProbe.status !== 0) {
    fail(
      unauthenticatedProbe.stderr.trim() ||
        unauthenticatedProbe.stdout.trim() ||
        "unauthenticated websocket verification through Caddy failed"
    );
  }
}

async function verifyErrorRoute() {
  if (!verifyDiagnosticsErrorRoute) {
    return;
  }

  const response = await fetch(`${caddyBaseUrl}/__diagnostics/error`);

  if (response.status !== 500) {
    fail("diagnostics error route did not return 500 through Caddy");
  }
}

function verifyOperatorPorts() {
  const postgresProbe = run("docker", [
    "compose",
    "exec",
    "-T",
    "postgres",
    "pg_isready",
    "-U",
    "openmirage",
    "-d",
    "openmirage"
  ]);

  if (!postgresProbe.stdout.includes("accepting connections")) {
    fail("postgres did not accept connections in the Compose stack");
  }
}

async function verifyMinioPort() {
  const response = await fetch("http://127.0.0.1:9000/minio/health/live");

  if (!response.ok) {
    fail("minio did not respond on the published operator port");
  }
}

async function main() {
  log("running prerequisite verification");
  run("node", ["./scripts/verify-platform-prereqs.mjs"]);

  log("starting full docker compose stack");
  run("docker", ["compose", "up", "--build", "-d", "--wait"], {
    maxBuffer: 1024 * 1024 * 20
  });

  log("verifying homepage through Caddy");
  await verifyHomepage();

  log("verifying api health, readiness, and storage smoke path");
  await verifyApiAndStorage();

  log("verifying collab and worker routes through Caddy");
  await verifyCollabAndWorker();

  log("verifying auth flow and websocket upgrade through Caddy");
  await verifyAuthAndWebsocket();

  log("verifying metrics through Caddy");
  await verifyMetrics();

  if (verifyDiagnosticsErrorRoute) {
    log("verifying diagnostics error route through Caddy");
    await verifyErrorRoute();
  }

  log("verifying docker compose logs");
  verifyDockerLogs();

  log("verifying operator ports for postgres and minio");
  verifyOperatorPorts();
  await verifyMinioPort();

  log("platform infrastructure verification passed");
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof Error && error.message ? error.message : String(error);
  console.error(`[openmirage] verification failed: ${message}`);
  process.exitCode = 1;
} finally {
  cleanup();
}

function capitalize(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
