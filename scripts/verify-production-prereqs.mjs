import {
  createSshArgs,
  expectedProductionEnvEntries,
  log,
  parseEnvFile,
  readProductionPrereqOptions,
  runChecked
} from "./production-prereqs-lib.mjs";

function readRemoteEnvFile(options) {
  return runChecked(
    "ssh",
    createSshArgs(options, `cat "${options.deployDir}/.env.production"`)
  );
}

function readRemoteDirectoryStatus(options, remotePath) {
  return runChecked(
    "ssh",
    createSshArgs(
      options,
      `[ -d "${remotePath}" ] && [ -w "${remotePath}" ] && echo ok || echo missing`
    )
  );
}

function verifyEqual(actual, expected, key, failures) {
  if (actual !== expected) {
    failures.push(`${key} expected ${JSON.stringify(expected)} but found ${JSON.stringify(actual ?? "")}`);
  }
}

try {
  const options = readProductionPrereqOptions();
  const failures = [];
  const expectedEnv = expectedProductionEnvEntries(options);

  log(`verifying remote deploy directory ${options.deployDir}`);

  if (readRemoteDirectoryStatus(options, options.deployDir) !== "ok") {
    failures.push(`missing or non-writable deploy directory ${options.deployDir}`);
  }

  if (readRemoteDirectoryStatus(options, `${options.deployDir}/docker`) !== "ok") {
    failures.push(`missing or non-writable docker subdirectory ${options.deployDir}/docker`);
  }

  log("verifying remote .env.production content");
  const remoteEnv = parseEnvFile(readRemoteEnvFile(options));

  for (const [key, expectedValue] of Object.entries(expectedEnv)) {
    if (key === "SENTRY_DSN") {
      if (remoteEnv[key] === undefined) {
        failures.push("SENTRY_DSN is missing from .env.production");
      }
      continue;
    }

    verifyEqual(remoteEnv[key], expectedValue, key, failures);
  }

  if (failures.length > 0) {
    console.error("[openmirage] production prerequisite verification failed:");
    for (const failure of failures) {
      console.error(`[openmirage] - ${failure}`);
    }
    process.exitCode = 1;
  } else {
    log("production prerequisite verification passed");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[openmirage] production prerequisite verification failed: ${message}`);
  process.exitCode = 1;
}
