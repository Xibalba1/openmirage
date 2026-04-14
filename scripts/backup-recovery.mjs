import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, resolve } from "node:path";
import { hostname } from "node:os";

function log(message) {
  console.log(`[openmirage] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function readTextFile(path) {
  return readFileSync(path, "utf8");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
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
      result.stderr.trim() ||
        result.stdout.trim() ||
        `${command} ${args.join(" ")} failed`
    );
  }

  return result.stdout.trim();
}

function fileSha256(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function stringSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function toTimestamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[:]/g, "-")
    .replace(/\.\d{3}Z$/, "Z");
}

function parseEnvFile(path) {
  if (!path || !existsSync(path)) {
    return {};
  }

  return parseEnvFileFromText(readTextFile(path));
}

function pickEnv(key, envFileValues = {}) {
  return process.env[key] ?? envFileValues[key];
}

function usingRemoteBackupHost() {
  return Boolean(process.env.BACKUP_SSH_TARGET);
}

function resolveTimestampedArtifactDir(baseDirectory) {
  return `${baseDirectory.replace(/\/+$/, "")}/openmirage-backup-${toTimestamp()}`;
}

function resolveArtifactDir() {
  const backupRoot = process.env.BACKUP_ROOT;

  if (!backupRoot) {
    fail("BACKUP_ROOT is required");
  }

  const artifactDir = resolve(
    process.cwd(),
    resolveTimestampedArtifactDir(backupRoot)
  );
  mkdirSync(artifactDir, { recursive: true });
  return artifactDir;
}

function getPostgresSettings(envValues) {
  return {
    containerName:
      process.env.BACKUP_POSTGRES_CONTAINER ?? "openmirage-postgres",
    database:
      process.env.BACKUP_PGDATABASE ??
      pickEnv("POSTGRES_DB", envValues) ??
      "openmirage",
    user:
      process.env.BACKUP_PGUSER ??
      pickEnv("POSTGRES_USER", envValues) ??
      "openmirage"
  };
}

function getStorageSettings(envValues) {
  return {
    provider: pickEnv("STORAGE_PROVIDER", envValues) ?? "minio",
    localRoot:
      pickEnv("STORAGE_LOCAL_ROOT", envValues) ?? ".openmirage/storage",
    minioContainerName: process.env.BACKUP_MINIO_CONTAINER ?? "openmirage-minio"
  };
}

function ensureContainerRunning(name) {
  const output = run("docker", [
    "inspect",
    name,
    "--format",
    "{{.State.Running}}"
  ]);
  if (output !== "true") {
    fail(`${name} is not running`);
  }
}

function runRemote(script, args = []) {
  const sshTarget = process.env.BACKUP_SSH_TARGET;

  if (!sshTarget) {
    fail("BACKUP_SSH_TARGET is required for remote backup operations");
  }

  return run("ssh", [
    sshTarget,
    "sh",
    "-lc",
    script,
    "openmirage-backup",
    ...args
  ]);
}

function runRemoteWithOutput(script, args = []) {
  const sshTarget = process.env.BACKUP_SSH_TARGET;

  if (!sshTarget) {
    fail("BACKUP_SSH_TARGET is required for remote backup operations");
  }

  return run("ssh", [
    sshTarget,
    "sh",
    "-lc",
    script,
    "openmirage-backup",
    ...args
  ]);
}

function readRemoteTextFile(path) {
  return runRemoteWithOutput('cat "$1"', [path]);
}

function writeRemoteTextFile(path, contents) {
  const escapedContents = shellQuote(contents);
  runRemote(
    `mkdir -p "$(dirname "$1")" && printf %s ${escapedContents} > "$1"`,
    [path]
  );
}

function resolveRemoteEnvFilePath() {
  const deployDir = process.env.VPS_DEPLOY_DIR;

  if (!deployDir) {
    fail("VPS_DEPLOY_DIR is required for remote backup operations");
  }

  const envFile = process.env.BACKUP_ENV_FILE ?? ".env.staging";
  return envFile.startsWith("/")
    ? envFile
    : `${deployDir.replace(/\/+$/, "")}/${envFile}`;
}

function createPostgresDump(artifactDir, postgres) {
  const dumpFile = "postgres.openmirage.dump";
  const containerDumpPath = `/tmp/${dumpFile}`;

  ensureContainerRunning(postgres.containerName);
  log(`creating Postgres backup from ${postgres.containerName}`);
  run("docker", [
    "exec",
    postgres.containerName,
    "sh",
    "-lc",
    `rm -f ${containerDumpPath} && pg_dump -U ${postgres.user} -d ${postgres.database} -Fc -f ${containerDumpPath}`
  ]);
  run("docker", [
    "cp",
    `${postgres.containerName}:${containerDumpPath}`,
    resolve(artifactDir, dumpFile)
  ]);
  run("docker", [
    "exec",
    postgres.containerName,
    "rm",
    "-f",
    containerDumpPath
  ]);
  return dumpFile;
}

function createMinioArchive(artifactDir, storage) {
  const archiveFile = "assets.minio-data.tar.gz";
  const temporaryDataDir = resolve(artifactDir, ".minio-data");
  const bucketName = process.env.STORAGE_BUCKET ?? "openmirage-assets";

  ensureContainerRunning(storage.minioContainerName);
  log(`creating MinIO asset archive from ${storage.minioContainerName}`);
  rmSync(temporaryDataDir, { recursive: true, force: true });
  mkdirSync(temporaryDataDir, { recursive: true });
  run("docker", [
    "cp",
    `${storage.minioContainerName}:/data/${bucketName}/.`,
    temporaryDataDir
  ]);
  run("tar", [
    "-czf",
    resolve(artifactDir, archiveFile),
    "-C",
    temporaryDataDir,
    "."
  ]);
  rmSync(temporaryDataDir, { recursive: true, force: true });
  return archiveFile;
}

function createLocalStorageArchive(artifactDir, storage) {
  const archiveFile = "assets.local-storage.tar.gz";
  const localRoot = resolve(process.cwd(), storage.localRoot);

  if (!existsSync(localRoot)) {
    fail(`local storage root does not exist: ${localRoot}`);
  }

  log(`creating local storage archive from ${localRoot}`);
  run("tar", ["-czf", resolve(artifactDir, archiveFile), "-C", localRoot, "."]);
  return archiveFile;
}

function createRemotePostgresDump(artifactDir, postgres) {
  const dumpFile = "postgres.openmirage.dump";

  log(`creating Postgres backup on ${process.env.BACKUP_SSH_TARGET}`);
  runRemote(
    [
      "set -euo pipefail",
      'artifact_dir="$1"',
      'postgres_container="$2"',
      'database_name="$3"',
      'database_user="$4"',
      'dump_file="$5"',
      'container_dump_path="/tmp/$dump_file"',
      'mkdir -p "$artifact_dir"',
      'docker inspect "$postgres_container" --format "{{.State.Running}}" | grep -qx true',
      'docker exec "$postgres_container" sh -lc "rm -f \\"$container_dump_path\\" && pg_dump -U \\"$database_user\\" -d \\"$database_name\\" -Fc -f \\"$container_dump_path\\""',
      'docker cp "$postgres_container:$container_dump_path" "$artifact_dir/$dump_file"',
      'docker exec "$postgres_container" rm -f "$container_dump_path"'
    ].join("; "),
    [
      artifactDir,
      postgres.containerName,
      postgres.database,
      postgres.user,
      dumpFile
    ]
  );
  return dumpFile;
}

function createRemoteMinioArchive(artifactDir, storage) {
  const archiveFile = "assets.minio-data.tar.gz";
  const bucketName = process.env.STORAGE_BUCKET ?? "openmirage-assets";

  log(`creating MinIO asset archive on ${process.env.BACKUP_SSH_TARGET}`);
  runRemote(
    [
      "set -euo pipefail",
      'artifact_dir="$1"',
      'minio_container="$2"',
      'bucket_name="$3"',
      'archive_file="$4"',
      'temporary_data_dir="$artifact_dir/.minio-data"',
      'mkdir -p "$artifact_dir"',
      'docker inspect "$minio_container" --format "{{.State.Running}}" | grep -qx true',
      'rm -rf "$temporary_data_dir"',
      'mkdir -p "$temporary_data_dir"',
      'docker cp "$minio_container:/data/$bucket_name/." "$temporary_data_dir"',
      'tar -czf "$artifact_dir/$archive_file" -C "$temporary_data_dir" .',
      'rm -rf "$temporary_data_dir"'
    ].join("; "),
    [artifactDir, storage.minioContainerName, bucketName, archiveFile]
  );
  return archiveFile;
}

function createRemoteLocalStorageArchive(artifactDir, storage) {
  const archiveFile = "assets.local-storage.tar.gz";

  log(
    `creating local-storage asset archive on ${process.env.BACKUP_SSH_TARGET}`
  );
  runRemote(
    [
      "set -euo pipefail",
      'artifact_dir="$1"',
      'local_root="$2"',
      'archive_file="$3"',
      'test -d "$local_root"',
      'mkdir -p "$artifact_dir"',
      'tar -czf "$artifact_dir/$archive_file" -C "$local_root" .'
    ].join("; "),
    [artifactDir, storage.localRoot, archiveFile]
  );
  return archiveFile;
}

function writeChecksums(artifactDir, files) {
  const lines = files.map(
    (file) => `${fileSha256(resolve(artifactDir, file))}  ${file}`
  );
  writeFileSync(resolve(artifactDir, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

function buildManifest({
  artifactDir,
  envFilePath,
  envFileContents,
  envValues,
  postgresDumpFile,
  storageArchiveFile,
  storage
}) {
  const deployAssetPaths = [
    "docker-compose.yml",
    "docker-compose.staging.yml",
    "docker/Caddyfile",
    "ops/staging-vps.md",
    "ops/backup-restore-recovery.md"
  ].filter((file) => existsSync(resolve(process.cwd(), file)));
  const envInventoryKeys = envFilePath ? Object.keys(envValues).sort() : [];

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    artifactDirectory: basename(artifactDir),
    sourceHost: process.env.BACKUP_SOURCE_HOST ?? hostname(),
    sourceMode: usingRemoteBackupHost() ? "ssh" : "local",
    deployTag:
      process.env.BACKUP_DEPLOY_TAG ??
      process.env.OPENMIRAGE_DEPLOY_TAG ??
      null,
    postgres: {
      containerName:
        process.env.BACKUP_POSTGRES_CONTAINER ?? "openmirage-postgres",
      dumpFile: postgresDumpFile,
      format: "pg_dump-custom"
    },
    storage: {
      provider: storage.provider,
      archiveFile: storageArchiveFile,
      reconnectOnly: storage.provider === "s3-compatible",
      localRoot: storage.provider === "local" ? storage.localRoot : null
    },
    deploymentRecovery: {
      checkedInAssets: deployAssetPaths,
      requiredOperatorFiles: ["$VPS_DEPLOY_DIR/.env.staging"],
      envFilePath: envFilePath ? basename(envFilePath) : null,
      envInventoryKeys,
      envInventorySha256:
        envFilePath && typeof envFileContents === "string"
          ? stringSha256(envFileContents)
          : null
    }
  };
}

function readManifestFromArtifactDir() {
  const artifactDir = process.env.BACKUP_ARTIFACT_DIR;

  if (!artifactDir) {
    fail("BACKUP_ARTIFACT_DIR is required");
  }

  const absoluteArtifactDir = resolve(process.cwd(), artifactDir);
  const manifestPath = resolve(absoluteArtifactDir, "manifest.json");

  if (!existsSync(manifestPath)) {
    fail(`manifest not found: ${manifestPath}`);
  }

  return {
    artifactDir: absoluteArtifactDir,
    manifest: JSON.parse(readTextFile(manifestPath))
  };
}

function readRemoteManifestFromArtifactDir() {
  const artifactDir = process.env.BACKUP_ARTIFACT_DIR;

  if (!artifactDir) {
    fail("BACKUP_ARTIFACT_DIR is required");
  }

  const manifestPath = `${artifactDir.replace(/\/+$/, "")}/manifest.json`;
  const manifestContents = readRemoteTextFile(manifestPath);

  return {
    artifactDir,
    manifest: JSON.parse(manifestContents)
  };
}

function verifyChecksums(artifactDir) {
  const checksumPath = resolve(artifactDir, "SHA256SUMS");

  if (!existsSync(checksumPath)) {
    fail(`checksum file missing: ${checksumPath}`);
  }

  const mismatches = [];
  for (const line of readTextFile(checksumPath).split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const [expected, file] = line.split(/\s{2}/);
    const actual = fileSha256(resolve(artifactDir, file));
    if (expected !== actual) {
      mismatches.push(`${file}: expected ${expected}, received ${actual}`);
    }
  }

  if (mismatches.length > 0) {
    fail(`checksum verification failed:\n${mismatches.join("\n")}`);
  }
}

function verifyRemoteChecksums(artifactDir) {
  runRemote(
    [
      "set -euo pipefail",
      'artifact_dir="$1"',
      'cd "$artifact_dir"',
      "test -f SHA256SUMS",
      "sha256sum -c SHA256SUMS"
    ].join("; "),
    [artifactDir]
  );
}

function restorePostgres({ artifactDir, manifest }) {
  const postgres = getPostgresSettings({});
  const dumpPath = resolve(artifactDir, manifest.postgres.dumpFile);
  const containerDumpPath = `/tmp/${manifest.postgres.dumpFile}`;

  ensureContainerRunning(postgres.containerName);
  log(`restoring Postgres dump into ${postgres.containerName}`);
  run("docker", [
    "cp",
    dumpPath,
    `${postgres.containerName}:${containerDumpPath}`
  ]);
  run("docker", [
    "exec",
    postgres.containerName,
    "sh",
    "-lc",
    [
      "set -euo pipefail",
      `psql -U ${postgres.user} -d postgres -c "DROP DATABASE IF EXISTS ${postgres.database};"`,
      `psql -U ${postgres.user} -d postgres -c "CREATE DATABASE ${postgres.database};"`,
      `pg_restore -U ${postgres.user} -d ${postgres.database} --clean --if-exists ${containerDumpPath}`,
      `rm -f ${containerDumpPath}`
    ].join(" && ")
  ]);
}

function restoreAssets({ artifactDir, manifest }) {
  const archiveFile = manifest.storage.archiveFile;

  if (!archiveFile) {
    log("no self-hosted asset archive present; skipping asset restore");
    return;
  }

  const storage = getStorageSettings({
    STORAGE_PROVIDER: manifest.storage.provider,
    STORAGE_LOCAL_ROOT: manifest.storage.localRoot ?? undefined
  });
  const archivePath = resolve(artifactDir, archiveFile);

  if (manifest.storage.provider === "minio") {
    const temporaryDataDir = resolve(artifactDir, ".minio-restore");
    const bucketName = process.env.STORAGE_BUCKET ?? "openmirage-assets";
    ensureContainerRunning(storage.minioContainerName);
    log(`restoring MinIO assets into ${storage.minioContainerName}`);
    rmSync(temporaryDataDir, { recursive: true, force: true });
    mkdirSync(temporaryDataDir, { recursive: true });
    run("tar", ["-xzf", archivePath, "-C", temporaryDataDir]);
    run("docker", [
      "exec",
      storage.minioContainerName,
      "sh",
      "-lc",
      `mkdir -p /data/${bucketName} && rm -rf /data/${bucketName}/* /data/${bucketName}/.[!.]* /data/${bucketName}/..?*`
    ]);
    run("docker", [
      "cp",
      `${temporaryDataDir}/.`,
      `${storage.minioContainerName}:/data/${bucketName}`
    ]);
    rmSync(temporaryDataDir, { recursive: true, force: true });
    return;
  }

  if (manifest.storage.provider === "local") {
    const localRoot = resolve(process.cwd(), storage.localRoot);
    rmSync(localRoot, { recursive: true, force: true });
    mkdirSync(localRoot, { recursive: true });
    log(`restoring local asset archive into ${localRoot}`);
    run("tar", ["-xzf", archivePath, "-C", localRoot]);
    return;
  }

  log(
    "storage provider is external s3-compatible; skipping local asset restore"
  );
}

function waitForCommandSuccess(command, args, predicate, timeoutMs = 120000) {
  const startedAt = Date.now();
  let lastOutput = "";

  while (Date.now() - startedAt < timeoutMs) {
    const result = spawnSync(command, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe"
    });

    lastOutput = `${result.stdout.trim()}\n${result.stderr.trim()}`.trim();

    if (result.status === 0 && predicate(result.stdout.trim())) {
      return;
    }
  }

  fail(
    `${command} ${args.join(" ")} did not reach the expected state within ${timeoutMs}ms` +
      (lastOutput ? `\n${lastOutput}` : "")
  );
}

function runRestoreDrill() {
  const { artifactDir, manifest } = readManifestFromArtifactDir();

  if (process.env.OPENMIRAGE_RECOVERY_ALLOW_DESTRUCTIVE !== "true") {
    fail("restore-drill requires OPENMIRAGE_RECOVERY_ALLOW_DESTRUCTIVE=true");
  }

  verifyChecksums(artifactDir);
  log("clearing local compose target to guarantee fresh volumes");
  run("docker", ["compose", "down", "--remove-orphans", "--volumes"]);

  log("starting clean restore target dependencies");
  run("docker", ["compose", "up", "-d", "postgres", "minio", "minio-init"]);
  waitForCommandSuccess(
    "docker",
    [
      "inspect",
      "openmirage-postgres",
      "--format",
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}"
    ],
    (output) => output === "healthy"
  );
  waitForCommandSuccess(
    "docker",
    ["inspect", "openmirage-minio", "--format", "{{.State.Running}}"],
    (output) => output === "true"
  );
  waitForCommandSuccess(
    "docker",
    [
      "inspect",
      "openmirage-minio-init",
      "--format",
      "{{.State.Status}}:{{.State.ExitCode}}"
    ],
    (output) => output === "exited:0"
  );

  restorePostgres({ artifactDir, manifest });
  restoreAssets({ artifactDir, manifest });

  log("starting the full stack on restored state");
  run("docker", ["compose", "up", "--build", "-d", "--wait"]);

  log("running baseline verification against the restored stack");
  run("node", ["./scripts/verify-platform-infra.mjs"]);
}

function createBackup() {
  if (usingRemoteBackupHost()) {
    createRemoteBackup();
    return;
  }

  const envFilePath = process.env.BACKUP_ENV_FILE
    ? resolve(process.cwd(), process.env.BACKUP_ENV_FILE)
    : null;
  const envValues = parseEnvFile(envFilePath);
  const artifactDir = resolveArtifactDir();
  const postgres = getPostgresSettings(envValues);
  const storage = getStorageSettings(envValues);

  const postgresDumpFile = createPostgresDump(artifactDir, postgres);
  let storageArchiveFile = null;

  if (storage.provider === "minio") {
    storageArchiveFile = createMinioArchive(artifactDir, storage);
  } else if (storage.provider === "local") {
    storageArchiveFile = createLocalStorageArchive(artifactDir, storage);
  } else {
    log(
      "storage provider is external s3-compatible; recording reconnect-only dependency"
    );
  }

  const manifest = buildManifest({
    artifactDir,
    envFilePath,
    envFileContents: envFilePath ? readTextFile(envFilePath) : null,
    envValues,
    postgresDumpFile,
    storageArchiveFile,
    storage
  });
  writeFileSync(
    resolve(artifactDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  const checksumFiles = ["manifest.json", postgresDumpFile];
  if (storageArchiveFile) {
    checksumFiles.push(storageArchiveFile);
  }
  writeChecksums(artifactDir, checksumFiles);

  log(`backup artifact created at ${artifactDir}`);
}

function createRemoteBackup() {
  const artifactDir = resolveTimestampedArtifactDir(process.env.BACKUP_ROOT);
  const envFilePath = resolveRemoteEnvFilePath();
  const envFileContents = readRemoteTextFile(envFilePath);
  const envValues = parseEnvFileFromText(envFileContents);
  const postgres = getPostgresSettings(envValues);
  const storage = getStorageSettings(envValues);

  const postgresDumpFile = createRemotePostgresDump(artifactDir, postgres);
  let storageArchiveFile = null;

  if (storage.provider === "minio") {
    storageArchiveFile = createRemoteMinioArchive(artifactDir, storage);
  } else if (storage.provider === "local") {
    storageArchiveFile = createRemoteLocalStorageArchive(artifactDir, storage);
  } else {
    log(
      "storage provider is external s3-compatible; recording reconnect-only dependency"
    );
  }

  const manifest = buildManifest({
    artifactDir,
    envFilePath,
    envFileContents,
    envValues,
    postgresDumpFile,
    storageArchiveFile,
    storage
  });

  writeRemoteTextFile(
    `${artifactDir}/manifest.json`,
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  const checksumFiles = ["manifest.json", postgresDumpFile];
  if (storageArchiveFile) {
    checksumFiles.push(storageArchiveFile);
  }

  runRemote(
    [
      "set -euo pipefail",
      'artifact_dir="$1"',
      "shift",
      'cd "$artifact_dir"',
      'sha256sum "$@" > SHA256SUMS'
    ].join("; "),
    [artifactDir, ...checksumFiles]
  );

  log(
    `backup artifact created at ${process.env.BACKUP_SSH_TARGET}:${artifactDir}`
  );
}

function parseEnvFileFromText(contents) {
  const result = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    result[key] = value;
  }

  return result;
}

function verifyBackupArtifacts() {
  if (usingRemoteBackupHost()) {
    verifyRemoteBackupArtifacts();
    return;
  }

  const { artifactDir, manifest } = readManifestFromArtifactDir();

  if (!existsSync(resolve(artifactDir, manifest.postgres.dumpFile))) {
    fail(`postgres dump missing: ${manifest.postgres.dumpFile}`);
  }

  if (statSync(resolve(artifactDir, manifest.postgres.dumpFile)).size === 0) {
    fail(`postgres dump is empty: ${manifest.postgres.dumpFile}`);
  }

  if (
    manifest.storage.archiveFile &&
    !existsSync(resolve(artifactDir, manifest.storage.archiveFile))
  ) {
    fail(`storage archive missing: ${manifest.storage.archiveFile}`);
  }

  verifyChecksums(artifactDir);
  log(`backup artifacts verified in ${artifactDir}`);
}

function verifyRemoteBackupArtifacts() {
  const { artifactDir, manifest } = readRemoteManifestFromArtifactDir();

  runRemote(
    [
      "set -euo pipefail",
      'artifact_dir="$1"',
      'postgres_dump="$2"',
      'test -f "$artifact_dir/$postgres_dump"',
      'test -s "$artifact_dir/$postgres_dump"'
    ].join("; "),
    [artifactDir, manifest.postgres.dumpFile]
  );

  if (manifest.storage.archiveFile) {
    runRemote(
      [
        "set -euo pipefail",
        'artifact_dir="$1"',
        'archive_file="$2"',
        'test -f "$artifact_dir/$archive_file"'
      ].join("; "),
      [artifactDir, manifest.storage.archiveFile]
    );
  }

  verifyRemoteChecksums(artifactDir);
  log(
    `backup artifacts verified in ${process.env.BACKUP_SSH_TARGET}:${artifactDir}`
  );
}

function restoreBackup() {
  const { artifactDir, manifest } = readManifestFromArtifactDir();
  verifyChecksums(artifactDir);
  restorePostgres({ artifactDir, manifest });
  restoreAssets({ artifactDir, manifest });
  log("backup restore completed");
}

function main() {
  const command = process.argv[2];

  if (command === "create") {
    createBackup();
    return;
  }

  if (command === "verify") {
    verifyBackupArtifacts();
    return;
  }

  if (command === "restore") {
    restoreBackup();
    return;
  }

  if (command === "restore-drill") {
    runRestoreDrill();
    return;
  }

  fail(
    "usage: node ./scripts/backup-recovery.mjs <create|verify|restore|restore-drill>"
  );
}

main();
