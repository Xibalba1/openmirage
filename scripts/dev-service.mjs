import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const [entrypoint] = process.argv.slice(2);

if (!entrypoint) {
  throw new Error("Expected a service entrypoint path");
}

function parseEnvFile(contents) {
  const parsed = {};

  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    parsed[key] = value;
  }

  return parsed;
}

const envPath = resolve(process.cwd(), ".env");
const fileEnv = existsSync(envPath)
  ? parseEnvFile(readFileSync(envPath, "utf8"))
  : {};
const mergedEnv = {
  ...fileEnv,
  ...process.env
};

const child = spawn(
  process.execPath,
  ["--import", "tsx", entrypoint],
  {
    cwd: process.cwd(),
    env: mergedEnv,
    stdio: "inherit"
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
