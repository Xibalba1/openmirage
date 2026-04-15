import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createScpArgs,
  createSshArgs,
  log,
  readStagingPrereqOptions,
  renderStagingEnvFile,
  runChecked
} from "./staging-prereqs-lib.mjs";

function printUsage() {
  console.log(`Usage:
  node ./scripts/setup-staging-prereqs.mjs \\
    --host <vps-host> \\
    --user <vps-user> \\
    --deploy-dir </absolute/deploy/dir> \\
    --public-base-url <https://staging.example.com> \\
    [--port 22] [--ssh-key-path ~/.ssh/id_ed25519] [--force]

Environment fallback:
  VPS_HOST, VPS_USER, VPS_PORT, VPS_DEPLOY_DIR, STAGING_PUBLIC_BASE_URL,
  VPS_SSH_KEY_PATH, SESSION_COOKIE_NAME, SESSION_COOKIE_PATH,
  SESSION_COOKIE_SAME_SITE, ENABLE_TEST_ERROR_ROUTES, SENTRY_DSN,
  SENTRY_ENVIRONMENT, SENTRY_RELEASE`);
}

function remoteFileExists(options, remotePath) {
  const command = `[ -f "${remotePath}" ] && echo present || echo missing`;
  return runChecked("ssh", createSshArgs(options, command)) === "present";
}

try {
  if (process.argv.includes("--help")) {
    printUsage();
    process.exit(0);
  }

  const options = readStagingPrereqOptions();
  const envFileContent = `${renderStagingEnvFile(options)}\n`;
  const envFilePath = `${options.deployDir}/.env.staging`;

  log(`ensuring remote deploy directory ${options.deployDir}`);
  runChecked(
    "ssh",
    createSshArgs(
      options,
      `mkdir -p "${options.deployDir}/docker" && chmod 755 "${options.deployDir}" "${options.deployDir}/docker"`
    )
  );

  const envExists = remoteFileExists(options, envFilePath);

  if (envExists && !options.force) {
    log(
      `remote env file already exists at ${envFilePath}; use --force to overwrite it`
    );
    process.exit(0);
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "openmirage-staging-"));
  const localEnvFile = path.join(tempDir, ".env.staging");

  try {
    writeFileSync(localEnvFile, envFileContent, "utf8");
    log(
      `${envExists ? "overwriting" : "creating"} remote env file ${envFilePath}`
    );
    runChecked(
      "scp",
      createScpArgs(
        options,
        localEnvFile,
        `${options.user}@${options.host}:${envFilePath}`
      )
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }

  log("staging prerequisite setup completed");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[openmirage] staging prerequisite setup failed: ${message}`);
  process.exitCode = 1;
}
