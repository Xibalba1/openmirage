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

async function main() {
  log(`verifying staging deploy at ${baseUrl}`);
  await verifyHttpSurface();
  await verifyStorageSmoke();
  verifyWebsocketUpgrade();
  log("staging deploy verification passed");
}

main().catch((error) => {
  console.error(
    `[openmirage] staging deploy verification failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
