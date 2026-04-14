# Backup Restore Drill Evidence

This file records the one-time clean-room restore drill for the MVP backup slice.

## Evidence Template

- Date:
- Source environment:
- Backup artifact directory:
- Storage provider:
- Commands run:
  - `pnpm verify:recovery:prereqs`
  - `pnpm backup:create`
  - `pnpm backup:verify`
  - `pnpm verify:recovery:prereqs restore-drill`
  - `OPENMIRAGE_RECOVERY_ALLOW_DESTRUCTIVE=true pnpm backup:restore:drill`
- Verification result:
  - `GET /`
  - `GET /healthz`
  - `GET /readyz`
  - `GET /collab/healthz`
  - `GET /worker/readyz`
  - websocket upgrade at `/collab`
  - storage smoke path
- Notes:

## Latest Recorded Drill

- Date: 2026-04-14
- Source environment: local staging-equivalent Compose stack
- Backup artifact directory: `/tmp/openmirage-backups/openmirage-backup-2026-04-14T22-41-32Z`
- Storage provider: `minio`
- Commands run:
  - `pnpm lint`
  - `docker compose up --build --wait`
  - `BACKUP_ROOT=/tmp/openmirage-backups pnpm backup:create`
  - `BACKUP_ARTIFACT_DIR=/tmp/openmirage-backups/openmirage-backup-2026-04-14T22-41-32Z pnpm backup:verify`
  - `BACKUP_ARTIFACT_DIR=/tmp/openmirage-backups/openmirage-backup-2026-04-14T22-41-32Z pnpm verify:recovery:prereqs restore-drill`
  - `docker compose down --remove-orphans`
  - `BACKUP_ARTIFACT_DIR=/tmp/openmirage-backups/openmirage-backup-2026-04-14T22-41-32Z pnpm verify:recovery:prereqs restore-drill`
  - `BACKUP_ARTIFACT_DIR=/tmp/openmirage-backups/openmirage-backup-2026-04-14T22-41-32Z OPENMIRAGE_RECOVERY_ALLOW_DESTRUCTIVE=true pnpm backup:restore:drill`
- Verification result:
  - `GET /`: passed during `scripts/verify-platform-infra.mjs`
  - `GET /healthz`: passed during `scripts/verify-platform-infra.mjs`
  - `GET /readyz`: passed during `scripts/verify-platform-infra.mjs`
  - `GET /collab/healthz`: passed during `scripts/verify-platform-infra.mjs`
  - `GET /worker/readyz`: passed during `scripts/verify-platform-infra.mjs`
  - websocket upgrade at `/collab`: passed during `scripts/verify-platform-infra.mjs`
  - storage smoke path: passed during `scripts/verify-platform-infra.mjs`
- Notes:
  - The restore-drill prerequisite gate correctly failed while the local Compose stack was still running, then passed after `docker compose down --remove-orphans --volumes`.
  - The MinIO backup archives bucket contents only and waits for `minio-init` to complete before restoring those contents into the clean target.
