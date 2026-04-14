# Backup, Restore, and Recovery Runbook

This runbook defines the MVP backup and recovery procedure for OpenMirage’s single-VPS deployment model. It extends the existing staging deploy flow in [`ops/staging-vps.md`](/Users/ik/repos/openmirage/ops/staging-vps.md:1) and does not introduce a second deployment system.

## Guardrails

Will do:

- Back up Postgres first using a custom-format `pg_dump` artifact.
- Back up self-hosted asset data only when storage is on-box:
  - `minio-data` when `STORAGE_PROVIDER=minio`
  - the configured storage root when `STORAGE_PROVIDER=local`
- Record deployment recovery inputs needed to recreate the stack:
  - checked-in deploy assets
  - operator-managed `.env.staging`
  - env key inventory and checksum for the chosen env file
- Verify every artifact set with `SHA256SUMS`.
- Require one clean restore drill into a disposable local Compose environment.

Won't do:

- Won't add PITR, WAL archiving, replication, or `pg_basebackup`.
- Won't automate offsite sync in this slice.
- Won't clone external S3/R2 objects locally in this slice.
- Won't proceed if prerequisite checks fail.

## Prerequisite Gate

Before modifying any code, identify any prerequisites to your work that you cannot accomplish (ex: software installs on the local machine). Check those prerequisites (pass or fail). If any fail, do not proceed. Output the failures and provide procedural, step-by-step instructions on how to complete/fulfill the failing prerequisites.

Use the dedicated prerequisite checker before backup or restore work:

```bash
pnpm verify:recovery:prereqs
pnpm verify:recovery:prereqs staging-backup
pnpm verify:recovery:prereqs restore-drill
```

### Local authoring prerequisites

`pnpm verify:recovery:prereqs` checks:

- `pnpm` is installed and runnable
- Docker and `docker compose` are installed
- the Docker daemon is reachable
- the repo prerequisite gate passes
- the repo baseline infrastructure verification passes

If any of these fail, stop. Complete the printed remediation steps before editing code or validating backup behavior.

### Staging backup prerequisites

Before producing staging artifacts, export:

```bash
export BACKUP_SSH_TARGET=<user@staging-host>
export VPS_DEPLOY_DIR=<staging-compose-root>
export BACKUP_ROOT=<operator-managed-backup-dir>
export BACKUP_ENV_FILE=.env.staging
```

Then run:

```bash
pnpm verify:recovery:prereqs staging-backup
```

This verifies:

- SSH access to the staging VPS
- Docker and `docker compose` on the VPS
- existence of `$VPS_DEPLOY_DIR/.env.staging`
- existence and writability of `$BACKUP_ROOT`
- minimum free space in `$BACKUP_ROOT`

If any check fails, stop. Complete the printed remediation steps before attempting a backup run.

### Restore drill prerequisites

Before a restore drill, export:

```bash
export BACKUP_ARTIFACT_DIR=<artifact-dir-from-pnpm-backup-create>
```

Then run:

```bash
pnpm verify:recovery:prereqs restore-drill
```

This verifies:

- Docker and `docker compose` are available locally
- the Docker daemon is reachable
- the artifact directory contains `manifest.json`
- the Postgres dump exists
- the local Compose target is clean before the drill begins

## Artifact Model

Each backup run writes a timestamped artifact directory under `BACKUP_ROOT`:

```text
$BACKUP_ROOT/openmirage-backup-<timestamp>/
  manifest.json
  SHA256SUMS
  postgres.openmirage.dump
  assets.minio-data.tar.gz          # when STORAGE_PROVIDER=minio
  assets.local-storage.tar.gz       # when STORAGE_PROVIDER=local
```

`manifest.json` records:

- backup timestamp
- source host
- deploy tag if supplied through `BACKUP_DEPLOY_TAG`
- Postgres dump file name and format
- storage provider and whether asset recovery is reconnect-only
- checked-in deploy assets required for reprovisioning
- required operator-managed files
- env key inventory and checksum if `BACKUP_ENV_FILE` is supplied

`SHA256SUMS` is the integrity gate for every artifact set. Always verify it before restore.

Naming contract:

- directory: `openmirage-backup-<UTC timestamp>`
- Postgres dump: `postgres.openmirage.dump`
- MinIO archive: `assets.minio-data.tar.gz`
- local-storage archive: `assets.local-storage.tar.gz`
- manifest: `manifest.json`
- checksums: `SHA256SUMS`

## Backup Scope

### Postgres

Always back up Postgres:

- format: `pg_dump -Fc`
- artifact: `postgres.openmirage.dump`
- source: running `openmirage-postgres` container by default

### Self-hosted asset data

Conditional behavior:

- `STORAGE_PROVIDER=minio`: archive the running MinIO data directory
- `STORAGE_PROVIDER=local`: archive the configured local storage root
- `STORAGE_PROVIDER=s3-compatible`: do not copy objects in this slice; recovery is provider reconnect plus config restoration

### Deployment recovery inputs

Recovery depends on:

- [`docker-compose.yml`](/Users/ik/repos/openmirage/docker-compose.yml:1)
- [`docker-compose.staging.yml`](/Users/ik/repos/openmirage/docker-compose.staging.yml:1)
- [`docker/Caddyfile`](/Users/ik/repos/openmirage/docker/Caddyfile:1)
- [`ops/staging-vps.md`](/Users/ik/repos/openmirage/ops/staging-vps.md:1)
- this runbook
- operator-managed `$VPS_DEPLOY_DIR/.env.staging`

Do not store plaintext secrets in repo-tracked files.

## Commands

### Create a staging or staging-equivalent backup

For staging backup generation directly onto the VPS backup root:

```bash
export BACKUP_SSH_TARGET=<user@staging-host>
export VPS_DEPLOY_DIR=<staging-compose-root>
export BACKUP_ROOT=/var/backups/openmirage
export BACKUP_ENV_FILE=.env.staging
export BACKUP_DEPLOY_TAG=<ghcr-or-git-tag>
pnpm verify:recovery:prereqs staging-backup
pnpm backup:create
```

This writes the artifact directory on the staging VPS at:

```text
$BACKUP_ROOT/openmirage-backup-<timestamp>/
```

For a local staging-equivalent backup generation run:

```bash
export BACKUP_ROOT=/tmp/openmirage-backups
pnpm backup:create
```

### Verify an artifact set

To verify an artifact set in the staging VPS backup root:

```bash
export BACKUP_SSH_TARGET=<user@staging-host>
export BACKUP_ARTIFACT_DIR=/var/backups/openmirage/openmirage-backup-<timestamp>
pnpm backup:verify
```

To verify a copied local artifact set:

```bash
export BACKUP_ARTIFACT_DIR=/tmp/openmirage-backups/openmirage-backup-<timestamp>
pnpm backup:verify
```

### Restore an artifact set into a running target

```bash
export BACKUP_ARTIFACT_DIR=/tmp/openmirage-backups/openmirage-backup-<timestamp>
pnpm backup:restore
```

`pnpm backup:restore` restores the Postgres dump into the running `openmirage-postgres` container and restores on-box assets when the artifact set contains them.

## One-Time Restore Drill

The required restore drill target is a disposable local Compose environment with fresh named volumes.

Before starting the drill, copy the chosen staging artifact directory onto the local machine if it was created on the VPS:

```bash
mkdir -p /tmp/openmirage-backups
scp -r <user@staging-host>:/var/backups/openmirage/openmirage-backup-<timestamp> /tmp/openmirage-backups/
```

### Drill flow

1. Produce an artifact set from staging or a staging-equivalent environment.
2. Verify it:
   ```bash
   export BACKUP_ARTIFACT_DIR=/tmp/openmirage-backups/openmirage-backup-<timestamp>
   pnpm backup:verify
   ```
3. Confirm the local target is disposable and currently stopped:
   ```bash
   pnpm verify:recovery:prereqs restore-drill
   ```
4. Run the destructive clean-room restore drill:
   ```bash
   export OPENMIRAGE_RECOVERY_ALLOW_DESTRUCTIVE=true
   pnpm backup:restore:drill
   ```

### What the drill does

- removes local Compose containers and volumes
- starts a clean Postgres + MinIO target
- restores the Postgres dump
- restores self-hosted assets if present
- starts the full stack
- runs [`scripts/verify-platform-infra.mjs`](/Users/ik/repos/openmirage/scripts/verify-platform-infra.mjs:1)

### Expected success checks

- `GET /`
- `GET /healthz`
- `GET /readyz`
- `GET /collab/healthz`
- `GET /worker/readyz`
- websocket upgrade behavior at `/collab`
- storage smoke path verification through the API

If any check fails, stop and inspect the artifact manifest, Compose logs, and checksum results before retrying.

## Failed VPS Recovery

To reprovision a failed staging VPS:

1. Provision a replacement VPS with Docker and `docker compose`.
2. Recreate the deploy root layout described in [`ops/staging-vps.md`](/Users/ik/repos/openmirage/ops/staging-vps.md:1).
3. Restore the operator-managed `.env.staging`.
4. Copy the checked-in deploy assets from the repo into `$VPS_DEPLOY_DIR`.
5. Restore the Postgres dump into the replacement Postgres service.
6. If storage is self-hosted on-box, restore the asset archive into the replacement host’s storage service/root.
7. Run the documented staging deploy workflow to bring the immutable images back up.
8. Run the staging smoke verification sequence.

For `STORAGE_PROVIDER=s3-compatible`, step 6 is replaced by restoring credentials and reconnecting the service to the existing provider.

## Failure Triage

Inspect these first when backup or restore fails:

```bash
docker compose ps
docker compose logs postgres
docker compose logs minio
docker compose logs api
docker compose logs collab
docker compose logs worker
```

Also inspect:

- `manifest.json`
- `SHA256SUMS`
- free space in the backup destination
- whether `.env.staging` still matches the intended storage provider and public origin
