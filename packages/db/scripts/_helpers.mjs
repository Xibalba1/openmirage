import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const DEFAULT_DATABASE_URL =
  "postgres://openmirage:openmirage@localhost:5432/openmirage";

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

export function loadScriptEnv() {
  const envPath = resolve(process.cwd(), ".env");
  const fileEnv = existsSync(envPath)
    ? parseEnvFile(readFileSync(envPath, "utf8"))
    : {};

  return {
    DATABASE_URL: DEFAULT_DATABASE_URL,
    ...fileEnv,
    ...process.env
  };
}

export function requireFlagValue(flagName) {
  const flagIndex = process.argv.indexOf(flagName);

  if (flagIndex === -1 || !process.argv[flagIndex + 1]) {
    throw new Error(`Expected ${flagName} <value>`);
  }

  return process.argv[flagIndex + 1];
}

export function runNodePgMigrate(args) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(command, ["exec", "node-pg-migrate", ...args], {
    cwd: process.cwd(),
    env: loadScriptEnv(),
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 0);
}
