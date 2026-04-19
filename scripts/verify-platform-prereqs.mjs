import { execFileSync, spawnSync } from "node:child_process";

const REQUIRED_PORTS = [80, 5432, 9000, 9001];
const STAGING_REQUIRED_PORTS = [80, 443, 5432, 9000, 9001];

function printStep(message) {
  console.log(`[openmirage] ${message}`);
}

function failPrerequisite(name, reason, correctiveSteps) {
  console.error(`[openmirage] prerequisite failed: ${name}`);
  console.error(`[openmirage] reason: ${reason}`);
  console.error("[openmirage] corrective steps:");
  for (const [index, step] of correctiveSteps.entries()) {
    console.error(`${index + 1}. ${step}`);
  }
  process.exit(1);
}

function isHttpsSiteAddress(value) {
  if (!value) {
    return false;
  }

  return !value.startsWith("http://");
}

function readDeploymentMode() {
  const environment = process.env.OPENMIRAGE_ENV ?? "development";
  const siteAddress = process.env.CADDY_SITE_ADDRESS ?? "http://localhost";
  const stagingLike =
    environment === "staging" ||
    environment === "production" ||
    isHttpsSiteAddress(siteAddress);

  return {
    environment,
    siteAddress,
    stagingLike
  };
}

function runChecked(command, args, failure) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  if (result.status !== 0) {
    failPrerequisite(
      failure.name,
      result.stderr.trim() || result.stdout.trim() || failure.reason,
      failure.correctiveSteps
    );
  }

  return result.stdout.trim();
}

function verifyCommand(command, args, name, correctiveSteps) {
  runChecked(command, args, {
    name,
    reason: `${command} ${args.join(" ")} failed`,
    correctiveSteps
  });
}

function readRunningComposeServices() {
  const services = runChecked(
    "docker",
    ["compose", "ps", "--services", "--status", "running"],
    {
      name: "docker compose service status",
      reason: "docker compose ps failed",
      correctiveSteps: [
        "Confirm Docker Desktop or Docker Engine is running.",
        "Confirm the current user can access the Docker daemon.",
        "Re-run the prerequisite verification command."
      ]
    }
  );

  return new Set(
    services
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  );
}

function verifyPortsAvailable(runningServices, stagingLike) {
  if (runningServices.has("postgres") || runningServices.has("minio")) {
    return;
  }

  const requiredPorts = stagingLike ? STAGING_REQUIRED_PORTS : REQUIRED_PORTS;
  const lsofArgs = requiredPorts.flatMap((port) => [`-iTCP:${port}`]);

  try {
    const output = execFileSync("lsof", ["-nP", ...lsofArgs, "-sTCP:LISTEN"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();

    if (output) {
      failPrerequisite(
        "required ports available",
        `one or more required ports are already in use:\n${output}`,
        [
          `Stop the processes listening on ports ${requiredPorts.join(", ")}.`,
          "Or change the port mappings in docker-compose.yml to unused ports.",
          "Re-run the prerequisite verification command."
        ]
      );
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 1
    ) {
      return;
    }

    failPrerequisite("required ports available", String(error), [
      "Ensure lsof is available on the machine.",
      `Manually confirm ports ${requiredPorts.join(", ")} are free.`,
      "Re-run the prerequisite verification command."
    ]);
  }
}

function verifyStagingEnv(deploymentMode) {
  if (!deploymentMode.stagingLike) {
    return;
  }

  const requiredStringVars = [
    ["CADDY_SITE_ADDRESS", deploymentMode.siteAddress],
    ["APP_BASE_URL", process.env.APP_BASE_URL],
    ["OPENMIRAGE_PUBLIC_BASE_URL", process.env.OPENMIRAGE_PUBLIC_BASE_URL],
    [
      "OPENMIRAGE_PUBLIC_COLLAB_WS_URL",
      process.env.OPENMIRAGE_PUBLIC_COLLAB_WS_URL
    ]
  ];

  for (const [name, value] of requiredStringVars) {
    if (!value) {
      failPrerequisite(
        `${name} configured for staging`,
        `${name} is required when OPENMIRAGE_ENV is staging/production or when CADDY_SITE_ADDRESS enables TLS`,
        [
          `Set ${name} in the shell, CI environment, or Compose env file.`,
          "Use the public staging origin rather than an internal container hostname.",
          "Re-run the prerequisite verification command."
        ]
      );
    }
  }

  if (
    !deploymentMode.siteAddress.startsWith("https://") &&
    !/^[^:/]+$/.test(deploymentMode.siteAddress)
  ) {
    failPrerequisite(
      "CADDY_SITE_ADDRESS staging format",
      "CADDY_SITE_ADDRESS must be a bare host like staging.example.com or an explicit https:// URL for staging",
      [
        "Set CADDY_SITE_ADDRESS to the public staging hostname, for example `staging.example.com`.",
        "Do not use an internal container hostname or an http:// origin for staging.",
        "Re-run the prerequisite verification command."
      ]
    );
  }

  for (const [name, value] of [
    ["APP_BASE_URL", process.env.APP_BASE_URL],
    ["OPENMIRAGE_PUBLIC_BASE_URL", process.env.OPENMIRAGE_PUBLIC_BASE_URL]
  ]) {
    if (!value?.startsWith("https://")) {
      failPrerequisite(
        `${name} https origin`,
        `${name} must start with https:// in staging`,
        [
          `Set ${name} to the public HTTPS staging origin, for example \`https://staging.example.com\`.`,
          "Ensure the value matches the Caddy-facing origin used by the browser.",
          "Re-run the prerequisite verification command."
        ]
      );
    }
  }

  if (!process.env.OPENMIRAGE_PUBLIC_COLLAB_WS_URL?.startsWith("wss://")) {
    failPrerequisite(
      "OPENMIRAGE_PUBLIC_COLLAB_WS_URL secure websocket origin",
      "OPENMIRAGE_PUBLIC_COLLAB_WS_URL must start with wss:// in staging",
      [
        "Set OPENMIRAGE_PUBLIC_COLLAB_WS_URL to the public secure websocket URL, for example `wss://staging.example.com/collab`.",
        "Ensure the path matches COLLAB_WS_PATH.",
        "Re-run the prerequisite verification command."
      ]
    );
  }

  if ((process.env.SESSION_COOKIE_SECURE ?? "").toLowerCase() === "false") {
    failPrerequisite(
      "SESSION_COOKIE_SECURE enabled for staging",
      "SESSION_COOKIE_SECURE must not be false in staging",
      [
        "Set SESSION_COOKIE_SECURE=true or omit it to use the staging default.",
        "Re-run the prerequisite verification command."
      ]
    );
  }
}

function verifyDockerStack() {
  runChecked(
    "docker",
    ["compose", "up", "-d", "postgres", "minio", "minio-init"],
    {
      name: "docker compose dependency startup",
      reason: "docker compose up failed",
      correctiveSteps: [
        "Confirm Docker Desktop or Docker Engine is running.",
        "Confirm the image tags in docker-compose.yml are valid and pullable.",
        "Confirm the current user can access the Docker daemon.",
        "Re-run the prerequisite verification command."
      ]
    }
  );

  const runningServices = readRunningComposeServices();

  for (const service of ["postgres", "minio"]) {
    if (!runningServices.has(service)) {
      failPrerequisite(
        `${service} running in docker compose`,
        `${service} did not reach running state`,
        [
          `Run \`docker compose logs ${service}\` to inspect the startup failure.`,
          "Fix the Docker image, configuration, or local port conflict.",
          "Re-run the prerequisite verification command."
        ]
      );
    }
  }

  const postgresHealthArgs = [
    "inspect",
    "openmirage-postgres",
    "--format",
    "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}"
  ];

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const postgresState = runChecked("docker", postgresHealthArgs, {
      name: "postgres container health",
      reason: "docker inspect failed for openmirage-postgres",
      correctiveSteps: [
        "Confirm the `postgres` service container exists by running `docker compose ps`.",
        "Inspect `docker compose logs postgres` and fix the startup issue.",
        "Re-run the prerequisite verification command."
      ]
    });

    if (postgresState === "healthy") {
      return;
    }

    if (attempt < 29) {
      spawnSync("sleep", ["1"], {
        cwd: process.cwd(),
        stdio: "ignore"
      });
    }
  }

  const finalPostgresState = runChecked("docker", postgresHealthArgs, {
    name: "postgres container health",
    reason: "docker inspect failed for openmirage-postgres",
    correctiveSteps: [
      "Confirm the `postgres` service container exists by running `docker compose ps`.",
      "Inspect `docker compose logs postgres` and fix the startup issue.",
      "Re-run the prerequisite verification command."
    ]
  });

  failPrerequisite(
    "postgres container health",
    `postgres reported ${finalPostgresState}`,
    [
      "Run `docker compose logs postgres` and wait for the healthcheck to pass.",
      "Confirm port 5432 is not conflicted and the container has fully initialized.",
      "Re-run the prerequisite verification command."
    ]
  );
}

function verifyBrowserAutomationRuntime() {
  verifyCommand(
    "pnpm",
    ["exec", "playwright", "--version"],
    "playwright cli available",
    [
      "Install workspace dependencies with `pnpm install`.",
      "Confirm `pnpm exec playwright --version` succeeds.",
      "Re-run the prerequisite verification command."
    ]
  );

  runChecked(
    "node",
    [
      "--input-type=module",
      "-e",
      "import { chromium } from '@playwright/test'; const browser = await chromium.launch({ headless: true }); await browser.close();"
    ],
    {
      name: "playwright chromium runtime",
      reason: "playwright chromium launch failed",
      correctiveSteps: [
        "Install the local browser runtime with `pnpm --filter @openmirage/web test:e2e:install` or `pnpm exec playwright install chromium`.",
        "If the install already ran, inspect the failing browser launch message for missing OS dependencies or a bad browser cache.",
        "Re-run the prerequisite verification command."
      ]
    }
  );
}

printStep("verifying pnpm availability");
verifyCommand("pnpm", ["--version"], "pnpm available", [
  "Install pnpm 9.15.0 or newer.",
  "Verify `pnpm --version` succeeds.",
  "Re-run the prerequisite verification command."
]);

printStep("verifying docker cli");
verifyCommand("docker", ["--version"], "docker cli available", [
  "Install Docker Desktop or Docker Engine.",
  "Verify `docker --version` succeeds.",
  "Re-run the prerequisite verification command."
]);

printStep("verifying docker compose");
verifyCommand("docker", ["compose", "version"], "docker compose available", [
  "Install a Docker Compose-capable Docker distribution.",
  "Verify `docker compose version` succeeds.",
  "Re-run the prerequisite verification command."
]);

printStep("verifying docker daemon access");
verifyCommand("docker", ["ps"], "docker daemon access", [
  "Start Docker Desktop or the Docker daemon.",
  "Ensure the current user can access the Docker socket.",
  "Re-run the prerequisite verification command."
]);

const deploymentMode = readDeploymentMode();
const runningServices = readRunningComposeServices();

printStep("verifying staging-aware proxy env prerequisites");
verifyStagingEnv(deploymentMode);

printStep("verifying required ports are free");
verifyPortsAvailable(runningServices, deploymentMode.stagingLike);

printStep("verifying docker compose postgres/minio prerequisites");
verifyDockerStack();

printStep("verifying browser automation runtime");
verifyBrowserAutomationRuntime();

printStep("all prerequisite checks passed");
