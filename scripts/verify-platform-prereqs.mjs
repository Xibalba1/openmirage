import { execFileSync, spawnSync } from "node:child_process";

const REQUIRED_PORTS = [5432, 9000, 9001];

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

function verifyPortsAvailable(runningServices) {
  if (runningServices.has("postgres") || runningServices.has("minio")) {
    return;
  }

  try {
    const output = execFileSync(
      "lsof",
      ["-nP", "-iTCP:5432", "-iTCP:9000", "-iTCP:9001", "-sTCP:LISTEN"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    ).trim();

    if (output) {
      failPrerequisite(
        "required ports available",
        `one or more required ports are already in use:\n${output}`,
        [
          `Stop the processes listening on ports ${REQUIRED_PORTS.join(", ")}.`,
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
      `Manually confirm ports ${REQUIRED_PORTS.join(", ")} are free.`,
      "Re-run the prerequisite verification command."
    ]);
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

const runningServices = readRunningComposeServices();

printStep("verifying required ports are free");
verifyPortsAvailable(runningServices);

printStep("verifying docker compose postgres/minio prerequisites");
verifyDockerStack();

printStep("all prerequisite checks passed");
