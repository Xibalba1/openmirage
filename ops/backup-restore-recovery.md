# Backup, Restore, And Recovery Runbook

## Purpose

Use this runbook to create, verify, restore, and drill OpenMirage backups for the single-VPS deployment model.

The recovery baseline is intentionally simple:

- Postgres-first backups
- optional on-box asset archives when storage is self-hosted
- manifest and checksum verification for every artifact set
- one clean restore drill into a disposable local Compose environment

## Prerequisites

Before backup or restore work, use the dedicated recovery prerequisite checks:

```bash
pnpm verify:recovery:prereqs
pnpm verify:recovery:prereqs staging-backup
pnpm verify:recovery:prereqs restore-drill
```

What these checks cover:

- local `pnpm`, Docker, and `docker compose`
- Docker daemon reachability
- baseline repo verification for local authoring
- SSH access and backup destination checks for remote backup runs
- artifact completeness and a clean local target for restore drills

## Artifact Model

Each backup run writes a timestamped artifact directory under `BACKUP_ROOT`:

```text
$BACKUP_ROOT/openmirage-backup-<timestamp>/
  manifest.json
  SHA256SUMS
  postgres.openmirage.dump
  assets.minio-data.tar.gz        # when STORAGE_PROVIDER=minio
  assets.local-storage.tar.gz     # when STORAGE_PROVIDER=local
```

`manifest.json` records:

- backup timestamp
- source host
- deploy tag when supplied through `BACKUP_DEPLOY_TAG`
- Postgres dump metadata
- storage provider and whether asset recovery is reconnect-only
- checked-in deploy assets required for reprovisioning
- required operator-managed files
- environment key inventory and checksum when `BACKUP_ENV_FILE` is supplied

`SHA256SUMS` is the integrity gate for the artifact set. Always verify it before restore.

## What Gets Backed Up

### Postgres

Postgres is always backed up:

- format: `pg_dump -Fc`
- artifact: `postgres.openmirage.dump`
- default source container: `openmirage-postgres`

### Self-Hosted Asset Data

Asset backup depends on `STORAGE_PROVIDER`:

- `minio`: archive MinIO data for the configured bucket
- `local`: archive the configured local storage root
- `s3-compatible`: do not copy objects; recovery means reconnecting to the external provider

### Deployment Recovery Inputs

Recovery also depends on:

- [`docker-compose.yml`](../docker-compose.yml)
- [`docker-compose.staging.yml`](../docker-compose.staging.yml)
- [`docker/Caddyfile`](../docker/Caddyfile)
- [`ops/staging-vps.md`](./staging-vps.md)
- the operator-managed environment file on the VPS

Repo-tracked files must not contain plaintext secrets.

## Create A Backup

### Remote Staging Or Staging-Equivalent Backup

```bash
export BACKUP_SSH_TARGET=<user@staging-host>
export VPS_DEPLOY_DIR=<staging-compose-root>
export BACKUP_ROOT=/var/backups/openmirage
export BACKUP_ENV_FILE=.env.staging
export BACKUP_DEPLOY_TAG=<ghcr-or-git-tag>
pnpm verify:recovery:prereqs staging-backup
pnpm backup:create
```

This writes the artifact directory to:

```text
$BACKUP_ROOT/openmirage-backup-<timestamp>/
```

### Local Backup

```bash
export BACKUP_ROOT=/tmp/openmirage-backups
pnpm backup:create
```

## Verify A Backup Artifact Set

For a remote artifact set:

```bash
export BACKUP_SSH_TARGET=<user@staging-host>
export BACKUP_ARTIFACT_DIR=/var/backups/openmirage/openmirage-backup-<timestamp>
pnpm backup:verify
```

For a local artifact set:

```bash
export BACKUP_ARTIFACT_DIR=/tmp/openmirage-backups/openmirage-backup-<timestamp>
pnpm backup:verify
```

## Restore A Backup

To restore an artifact set into a running local target:

```bash
export BACKUP_ARTIFACT_DIR=/tmp/openmirage-backups/openmirage-backup-<timestamp>
pnpm backup:restore
```

`pnpm backup:restore` restores:

- the Postgres dump into the running `openmirage-postgres` container
- on-box assets when the artifact set contains them

## Restore Drill

The required restore drill target is a disposable local Compose environment with fresh named volumes.

If the chosen artifact set lives on the VPS, copy it locally first:

```bash
mkdir -p /tmp/openmirage-backups
scp -r <user@staging-host>:/var/backups/openmirage/openmirage-backup-<timestamp> /tmp/openmirage-backups/
```

### Drill Flow

1. Produce an artifact set from staging or a staging-equivalent environment.
2. Verify it:

```bash
export BACKUP_ARTIFACT_DIR=/tmp/openmirage-backups/openmirage-backup-<timestamp>
pnpm backup:verify
```

3. Confirm the local target is clean:

```bash
pnpm verify:recovery:prereqs restore-drill
```

4. Run the destructive restore drill:

```bash
export OPENMIRAGE_RECOVERY_ALLOW_DESTRUCTIVE=true
pnpm backup:restore:drill
```

### What The Drill Does

- removes local Compose containers and volumes
- starts a clean Postgres and MinIO target
- restores the Postgres dump
- restores self-hosted assets when present
- starts the full stack
- runs [`scripts/verify-platform-infra.mjs`](../scripts/verify-platform-infra.mjs)

### Expected Success Checks

- `GET /`
- `GET /healthz`
- `GET /readyz`
- `GET /collab/healthz`
- `GET /worker/readyz`
- websocket upgrade behavior at `/collab`
- storage smoke verification through the API

If any check fails, inspect the artifact manifest, checksum results, and Compose logs before retrying.

## Recover A Failed VPS

To reprovision a failed staging VPS:

1. Provision a replacement VPS with Docker and `docker compose`.
2. Recreate the deploy root layout described in [`ops/staging-vps.md`](./staging-vps.md).
3. Restore the operator-managed `.env.staging`.
4. Copy the checked-in deploy assets into `$VPS_DEPLOY_DIR`.
5. Restore the Postgres dump into the replacement Postgres service.
6. If storage is self-hosted on-box, restore the asset archive into the replacement storage service or root.
7. Run the standard staging deploy workflow.
8. Run the staging smoke verification sequence.

For `STORAGE_PROVIDER=s3-compatible`, step 6 becomes restoring credentials and reconnecting the deployment to the existing provider.

## Failure Triage

If backup or restore fails, inspect these first:

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
- whether the active environment file still matches the intended storage provider and public origin
