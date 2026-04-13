import { spawn, spawnSync } from "node:child_process";

const apiPort = process.env.API_PORT ?? "4400";
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const smokeKey = `smoke/verify-${Date.now()}.txt`;

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

async function waitForJson(url, timeoutMs = 30_000) {
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

  return body;
}

let shuttingDown = false;
let apiProcess;

function cleanup() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill("SIGTERM");
  }

  spawnSync("docker", ["compose", "down"], {
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

async function main() {
  log("running prerequisite verification");
  run("node", ["./scripts/verify-platform-prereqs.mjs"]);

  log("running database migrations");
  run("pnpm", ["db:migrate:up"]);

  log("checking migration status");
  run("pnpm", ["db:migrate:status"]);

  log("seeding development bootstrap");
  run("pnpm", ["db:seed"]);

  log("starting api service for storage verification");
  apiProcess = spawn("pnpm", ["--filter", "@openmirage/api", "dev"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: apiPort,
      SERVICE_HOST: "127.0.0.1"
    },
    stdio: "inherit"
  });

  const ready = await waitForJson(`${apiBaseUrl}/readyz`);

  if (!ready.ready) {
    fail("api /readyz did not report ready after startup");
  }

  log("verifying initial storage smoke list");
  const initialList = await waitForJson(`${apiBaseUrl}/internal/storage/smoke`);

  if (!Array.isArray(initialList.objects)) {
    fail("storage smoke list did not return an objects array");
  }

  log("uploading storage smoke object");
  const uploaded = await requestJson(`${apiBaseUrl}/internal/storage/smoke`, {
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

  if (uploaded.object?.key !== smokeKey) {
    fail("storage smoke upload did not return the expected key");
  }

  log("verifying uploaded object appears in list");
  const listed = await requestJson(`${apiBaseUrl}/internal/storage/smoke`);

  if (!listed.objects.some((entry) => entry.key === smokeKey)) {
    fail("uploaded smoke object was not listed by the api");
  }

  log("deleting storage smoke object");
  await requestJson(
    `${apiBaseUrl}/internal/storage/smoke?key=${encodeURIComponent(smokeKey)}`,
    {
      method: "DELETE"
    }
  );

  log("verifying final storage smoke list");
  const finalList = await requestJson(`${apiBaseUrl}/internal/storage/smoke`);

  if (finalList.objects.some((entry) => entry.key === smokeKey)) {
    fail("deleted smoke object still appears in the api list");
  }

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
