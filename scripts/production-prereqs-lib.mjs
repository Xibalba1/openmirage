import { spawnSync } from "node:child_process";

function normalizeArgKey(value) {
  return value.replace(/^--/, "").replaceAll("-", "_");
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const key = normalizeArgKey(token);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function readOption(args, key, envName, defaultValue) {
  const argKey = key.replaceAll("-", "_");

  if (args[argKey] !== undefined) {
    return args[argKey];
  }

  if (envName && process.env[envName] !== undefined) {
    return process.env[envName];
  }

  return defaultValue;
}

function parseBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "y"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n"].includes(normalized)) {
    return false;
  }

  throw new Error(`invalid boolean value: ${value}`);
}

export function readProductionPrereqOptions(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const publicBaseUrl = readOption(
    args,
    "public-base-url",
    "PRODUCTION_PUBLIC_BASE_URL"
  );
  const deployDir = readOption(args, "deploy-dir", "VPS_DEPLOY_DIR");
  const host = readOption(args, "host", "VPS_HOST");
  const port = readOption(args, "port", "VPS_PORT", "22");
  const user = readOption(args, "user", "VPS_USER");
  const sshKeyPath = readOption(args, "ssh-key-path", "VPS_SSH_KEY_PATH");
  const force = parseBoolean(readOption(args, "force", "OPENMIRAGE_FORCE"), false);
  const sessionCookieName = readOption(
    args,
    "session-cookie-name",
    "SESSION_COOKIE_NAME",
    "openmirage_session"
  );
  const sessionCookiePath = readOption(
    args,
    "session-cookie-path",
    "SESSION_COOKIE_PATH",
    "/"
  );
  const sessionCookieSameSite = readOption(
    args,
    "session-cookie-same-site",
    "SESSION_COOKIE_SAME_SITE",
    "lax"
  );
  const enableTestErrorRoutes = parseBoolean(
    readOption(
      args,
      "enable-test-error-routes",
      "ENABLE_TEST_ERROR_ROUTES",
      "false"
    ),
    false
  );
  const sentryDsn = readOption(args, "sentry-dsn", "SENTRY_DSN", "");
  const sentryEnvironment = readOption(
    args,
    "sentry-environment",
    "SENTRY_ENVIRONMENT",
    "production"
  );
  const sentryRelease = readOption(
    args,
    "sentry-release",
    "SENTRY_RELEASE",
    process.env.APP_VERSION ?? "0.1.0"
  );

  if (!host) {
    throw new Error("missing VPS host; set --host or VPS_HOST");
  }

  if (!user) {
    throw new Error("missing VPS user; set --user or VPS_USER");
  }

  if (!deployDir) {
    throw new Error("missing deploy directory; set --deploy-dir or VPS_DEPLOY_DIR");
  }

  if (!publicBaseUrl) {
    throw new Error(
      "missing production public base url; set --public-base-url or PRODUCTION_PUBLIC_BASE_URL"
    );
  }

  const parsedPublicBaseUrl = new URL(publicBaseUrl);

  if (parsedPublicBaseUrl.protocol !== "https:") {
    throw new Error("production public base url must start with https://");
  }

  return {
    deployDir,
    enableTestErrorRoutes,
    force,
    host,
    port,
    publicBaseUrl: parsedPublicBaseUrl,
    sentryDsn,
    sentryEnvironment,
    sentryRelease,
    sessionCookieName,
    sessionCookiePath,
    sessionCookieSameSite,
    sshKeyPath,
    user
  };
}

export function createSshArgs(options, remoteCommand) {
  const args = [
    "-4",
    "-p",
    String(options.port),
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10"
  ];

  if (options.sshKeyPath) {
    args.push("-i", options.sshKeyPath);
  }

  args.push(`${options.user}@${options.host}`, remoteCommand);
  return args;
}

export function createScpArgs(options, sourcePath, destinationPath) {
  const args = ["-4", "-P", String(options.port)];

  if (options.sshKeyPath) {
    args.push("-i", options.sshKeyPath);
  }

  args.push(sourcePath, destinationPath);
  return args;
}

export function runChecked(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"]
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${command} failed`);
  }

  return result.stdout.trim();
}

export function renderProductionEnvFile(options) {
  const appOrigin = options.publicBaseUrl.origin;
  const caddySiteAddress = options.publicBaseUrl.host;
  const collabWsUrl = new URL("/collab", appOrigin);

  collabWsUrl.protocol = "wss:";

  return [
    "OPENMIRAGE_ENV=production",
    `CADDY_SITE_ADDRESS=${caddySiteAddress}`,
    `APP_BASE_URL=${appOrigin}`,
    `OPENMIRAGE_PUBLIC_BASE_URL=${appOrigin}`,
    `OPENMIRAGE_PUBLIC_COLLAB_HTTP_URL=${new URL("/collab", appOrigin).toString()}`,
    `OPENMIRAGE_PUBLIC_COLLAB_WS_URL=${collabWsUrl.toString()}`,
    `OPENMIRAGE_PUBLIC_WORKER_HTTP_URL=${new URL("/worker", appOrigin).toString()}`,
    "AUTH_PATH=/auth",
    "COLLAB_WS_PATH=/collab",
    `SESSION_COOKIE_NAME=${options.sessionCookieName}`,
    `SESSION_COOKIE_PATH=${options.sessionCookiePath}`,
    `SESSION_COOKIE_SAME_SITE=${options.sessionCookieSameSite}`,
    "SESSION_COOKIE_SECURE=true",
    "CADDY_HTTP_PORT=80",
    "CADDY_HTTPS_PORT=443",
    `ENABLE_TEST_ERROR_ROUTES=${options.enableTestErrorRoutes ? "true" : "false"}`,
    `SENTRY_DSN=${options.sentryDsn}`,
    `SENTRY_ENVIRONMENT=${options.sentryEnvironment}`,
    `SENTRY_RELEASE=${options.sentryRelease}`
  ].join("\n");
}

export function parseEnvFile(content) {
  const parsed = {};

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    parsed[key] = value;
  }

  return parsed;
}

export function expectedProductionEnvEntries(options) {
  return parseEnvFile(renderProductionEnvFile(options));
}

export function log(message) {
  console.log(`[openmirage] ${message}`);
}
