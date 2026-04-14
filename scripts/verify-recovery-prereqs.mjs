import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function log(message) {
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

function runChecked(command, args, failure, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "pipe",
    ...options
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
  runChecked(
    command,
    args,
    {
      name,
      reason: `${command} ${args.join(" ")} failed`,
      correctiveSteps
    },
    {}
  );
}

function parseArtifactManifest(dir) {
  const manifestPath = resolve(dir, "manifest.json");

  if (!existsSync(manifestPath)) {
    failPrerequisite(
      "backup manifest present",
      `${manifestPath} does not exist`,
      [
        "Run `pnpm backup:create` against the source environment first.",
        "Set BACKUP_ARTIFACT_DIR to the artifact directory that contains `manifest.json`.",
        "Re-run the prerequisite verification command."
      ]
    );
  }

  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    failPrerequisite(
      "backup manifest readable",
      error instanceof Error ? error.message : String(error),
      [
        "Regenerate the backup artifact set with `pnpm backup:create`.",
        "Confirm the artifact directory is complete and readable.",
        "Re-run the prerequisite verification command."
      ]
    );
  }
}

function verifyAuthoringPrereqs() {
  log("verifying local authoring prerequisites");
  verifyCommand("pnpm", ["--version"], "pnpm availability", [
    "Install pnpm 9.15.0 or newer.",
    "If pnpm is not installed globally, run `corepack enable` and `corepack pnpm`.",
    "Re-run the prerequisite verification command."
  ]);
  verifyCommand("docker", ["--version"], "docker cli", [
    "Install Docker Desktop or Docker Engine.",
    "Confirm the Docker CLI is on PATH.",
    "Re-run the prerequisite verification command."
  ]);
  verifyCommand("docker", ["compose", "version"], "docker compose", [
    "Install Docker Compose v2.",
    "Confirm `docker compose version` succeeds.",
    "Re-run the prerequisite verification command."
  ]);
  verifyCommand("docker", ["info"], "docker daemon access", [
    "Start Docker Desktop or Docker Engine.",
    "Confirm the current user can access the Docker daemon.",
    "Re-run the prerequisite verification command."
  ]);

  log("verifying repo baseline prerequisite gate");
  verifyCommand(
    "pnpm",
    ["verify:platform:prereqs"],
    "platform prerequisite gate",
    [
      "Read the failing prerequisite output from `pnpm verify:platform:prereqs`.",
      "Complete the printed remediation steps.",
      "Re-run the prerequisite verification command."
    ]
  );

  log("verifying repo baseline infrastructure check");
  verifyCommand(
    "node",
    ["./scripts/verify-platform-infra.mjs"],
    "platform baseline infrastructure verification",
    [
      "Read the failing verification output from `node ./scripts/verify-platform-infra.mjs`.",
      "Fix the Docker, image, or runtime issue before continuing.",
      "Re-run the prerequisite verification command."
    ]
  );
}

function verifyStagingBackupPrereqs() {
  const sshTarget = process.env.BACKUP_SSH_TARGET;
  const deployDir = process.env.VPS_DEPLOY_DIR;
  const backupRoot = process.env.BACKUP_ROOT;
  const minFreeKb = Number(process.env.BACKUP_MIN_FREE_KB ?? "1048576");

  if (!sshTarget) {
    failPrerequisite(
      "BACKUP_SSH_TARGET configured",
      "BACKUP_SSH_TARGET is required in staging-backup mode",
      [
        "Set BACKUP_SSH_TARGET to the SSH target for the staging VPS, for example `deploy@example.com`.",
        "Ensure SSH authentication is configured for non-interactive access if required.",
        "Re-run the prerequisite verification command."
      ]
    );
  }

  if (!deployDir) {
    failPrerequisite(
      "VPS_DEPLOY_DIR configured",
      "VPS_DEPLOY_DIR is required in staging-backup mode",
      [
        "Set VPS_DEPLOY_DIR to the staging Compose project root on the VPS.",
        "Use the same path used by the staging deploy workflow.",
        "Re-run the prerequisite verification command."
      ]
    );
  }

  if (!backupRoot) {
    failPrerequisite(
      "BACKUP_ROOT configured",
      "BACKUP_ROOT is required in staging-backup mode",
      [
        "Set BACKUP_ROOT to the operator-managed backup directory on the VPS.",
        "Create the directory on the VPS before retrying.",
        "Re-run the prerequisite verification command."
      ]
    );
  }

  log("verifying staging backup operator access");
  runChecked(
    "ssh",
    [
      sshTarget,
      "sh",
      "-lc",
      'set -euo pipefail; docker --version; docker compose version; test -d "$1"; test -f "$1/.env.staging"; test -d "$2"; test -w "$2"; free_kb=$(df -Pk "$2" | awk \'NR==2 {print $4}\'); test "$free_kb" -ge "$3"',
      "openmirage-recovery-check",
      deployDir,
      backupRoot,
      String(minFreeKb)
    ],
    {
      name: "staging VPS backup access",
      reason: "remote prerequisite verification failed",
      correctiveSteps: [
        "Confirm SSH access to the staging VPS works from this machine.",
        "Confirm Docker and Docker Compose are installed on the VPS.",
        `Confirm ${deployDir}/.env.staging exists on the VPS.`,
        `Confirm ${backupRoot} exists, is writable, and has at least ${minFreeKb} KB free.`,
        "Re-run the prerequisite verification command."
      ]
    }
  );
}

function verifyRestoreDrillPrereqs() {
  const artifactDir = process.env.BACKUP_ARTIFACT_DIR;

  if (!artifactDir) {
    failPrerequisite(
      "BACKUP_ARTIFACT_DIR configured",
      "BACKUP_ARTIFACT_DIR is required in restore-drill mode",
      [
        "Set BACKUP_ARTIFACT_DIR to a backup artifact directory produced by `pnpm backup:create`.",
        "Confirm the directory contains `manifest.json`, `SHA256SUMS`, and the Postgres dump.",
        "Re-run the prerequisite verification command."
      ]
    );
  }

  const absoluteArtifactDir = resolve(process.cwd(), artifactDir);
  const manifest = parseArtifactManifest(absoluteArtifactDir);
  const dumpPath = resolve(absoluteArtifactDir, manifest.postgres.dumpFile);

  log("verifying restore drill local dependencies");
  verifyCommand("docker", ["--version"], "docker cli", [
    "Install Docker Desktop or Docker Engine.",
    "Confirm the Docker CLI is on PATH.",
    "Re-run the prerequisite verification command."
  ]);
  verifyCommand("docker", ["compose", "version"], "docker compose", [
    "Install Docker Compose v2.",
    "Confirm `docker compose version` succeeds.",
    "Re-run the prerequisite verification command."
  ]);
  verifyCommand("docker", ["info"], "docker daemon access", [
    "Start Docker Desktop or Docker Engine.",
    "Confirm the current user can access the Docker daemon.",
    "Re-run the prerequisite verification command."
  ]);

  if (!existsSync(dumpPath)) {
    failPrerequisite(
      "postgres dump artifact present",
      `${dumpPath} does not exist`,
      [
        "Re-run `pnpm backup:create` against the source environment.",
        "Set BACKUP_ARTIFACT_DIR to the complete artifact directory.",
        "Re-run the prerequisite verification command."
      ]
    );
  }

  const runningServices = runChecked(
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

  if (runningServices.trim()) {
    failPrerequisite(
      "clean local compose target",
      `local services are still running:\n${runningServices}`,
      [
        "Run `docker compose down --remove-orphans --volumes` to clear the local target first.",
        "Confirm no OpenMirage compose services are still running.",
        "Re-run the prerequisite verification command."
      ]
    );
  }
}

function main() {
  const mode = process.argv[2] ?? "authoring";
  log(`running recovery prerequisite verification in ${mode} mode`);

  if (mode === "authoring") {
    verifyAuthoringPrereqs();
  } else if (mode === "staging-backup") {
    verifyStagingBackupPrereqs();
  } else if (mode === "restore-drill") {
    verifyRestoreDrillPrereqs();
  } else {
    failPrerequisite(
      "recovery prerequisite mode",
      `unsupported mode: ${mode}`,
      [
        "Use one of: `authoring`, `staging-backup`, or `restore-drill`.",
        "Re-run the prerequisite verification command."
      ]
    );
  }

  log("all recovery prerequisite checks passed");
}

main();
