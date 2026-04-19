import { spawnSync } from "node:child_process";

function log(message) {
  console.log(`[openmirage] ${message}`);
}

function readSpawnOutput(result, fallback) {
  const stderr =
    typeof result.stderr === "string" ? result.stderr.trim() : "";
  const stdout =
    typeof result.stdout === "string" ? result.stdout.trim() : "";
  const errorMessage =
    result.error instanceof Error ? result.error.message : "";
  const signal = typeof result.signal === "string" ? result.signal : "";

  return (
    stderr ||
    stdout ||
    errorMessage ||
    signal ||
    fallback
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "pipe",
    ...options
  });

  if (result.status !== 0) {
    throw new Error(
      readSpawnOutput(result, `${command} ${args.join(" ")} failed`)
    );
  }
}

function cleanup() {
  spawnSync("docker", ["compose", "down", "--remove-orphans"], {
    cwd: process.cwd(),
    stdio: "inherit"
  });
}

async function main() {
  console.log(
    "before modifying any code, identify any prerequisites to your work that you cannot accomplish (ex: software installs on the local machine). check those prerequisites (pass or fail), if any fail, do not proceed. output the failures and provide procedural, step-by-step instructions on how to complete/fulfill the failing prerequisites"
  );

  log("running prerequisite verification");
  run("node", ["./scripts/verify-platform-prereqs.mjs"]);

  log("starting full docker compose stack");
  run("docker", ["compose", "up", "--build", "-d", "--wait"], {
    maxBuffer: 1024 * 1024 * 20
  });

  log("running Playwright MVP browser smoke");
  run("pnpm", ["--filter", "@openmirage/web", "test:e2e"], {
    env: {
      ...process.env,
      OPENMIRAGE_E2E_BASE_URL:
        process.env.OPENMIRAGE_E2E_BASE_URL ?? "http://127.0.0.1"
    },
    maxBuffer: 1024 * 1024 * 20
  });

  log("browser MVP smoke passed");
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof Error && error.message ? error.message : String(error);
  console.error(`[openmirage] browser smoke failed: ${message}`);
  process.exitCode = 1;
} finally {
  cleanup();
}
