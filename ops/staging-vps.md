# Staging VPS Runbook

This runbook standardizes the staging deployment procedure for the OpenMirage MVP on a single VPS. It extends the existing step 9 CI and deploy path; it does not introduce a second deployment system.

## Guardrails

Will do:

- Use GitHub Actions, GHCR, Docker Compose, and Caddy as the only staging deploy path.
- Treat `VPS_DEPLOY_DIR` as the single Compose project root on the VPS.
- Keep staging updates immutable-image based with `docker compose pull`, migration execution, and `docker compose up`.
- Keep secrets in the operator-managed `.env.staging` file on the VPS.
- Verify web, API, collab, worker, database readiness, and storage connectivity after each deploy.

Won't do:

- Won't build images on the VPS.
- Won't deploy from `git pull` or undocumented shell history on the server.
- Won't add Kubernetes, Terraform, Ansible, or backup automation in this slice.
- Won't attempt database down-migrations as a rollback mechanism.

## Prerequisite Gate

Before modifying any code, changing staging docs, or validating a deploy path, identify prerequisites you cannot satisfy from inside the repo, check them as pass/fail, and stop immediately if any fail. If any prerequisite fails, do not proceed. Output the failure and provide procedural, step-by-step instructions to complete the missing prerequisite first.

Local authoring prerequisites:

1. `pnpm` is installed and runnable.
2. Docker and `docker compose` are installed and the Docker daemon is reachable.
3. The repo prerequisite gate passes:
   ```bash
   pnpm verify:platform:prereqs
   node ./scripts/verify-platform-infra.mjs
   ```

Deploy-path prerequisites:

1. GitHub Actions is enabled for the repo.
2. GHCR publish permission is available to the workflow identity.
3. The GitHub `staging` Environment exists and is protected as intended.
4. CI can reach the staging VPS over SSH.
5. DNS for the staging hostname points to the VPS.
6. Inbound ports `80` and `443` reach Caddy on the VPS.
7. Docker and `docker compose` are installed on the VPS.
8. The operator has created the required staging `.env.staging` file on the VPS.

If a prerequisite fails, stop. Do not guess, work around it, or continue with partial validation.

## Standard VPS Layout

Use one deploy root for the Compose project:

```text
$VPS_DEPLOY_DIR/
  .env.staging
  docker-compose.yml
  docker-compose.staging.yml
  docker/
    Caddyfile
```

Rules:

- `$VPS_DEPLOY_DIR` is the only checked-in deploy asset location used by the workflow.
- `.env.staging` is operator-managed and persists across deploys.
- `docker-compose.yml`, `docker-compose.staging.yml`, and `docker/Caddyfile` are copied from the repo on every deploy.
- Persistent state uses Docker-managed named volumes for MVP:
  - `postgres-data`
  - `caddy-data`
  - `caddy-config`
- If staging intentionally self-hosts blob storage on-box, add a dedicated named volume for that service. Otherwise prefer an external S3-compatible provider.

## Required GitHub Environment Configuration

GitHub `staging` Environment secrets:

- `VPS_HOST`
- `VPS_PORT`
- `VPS_USER`
- `VPS_SSH_PRIVATE_KEY`
- `VPS_KNOWN_HOSTS`
- `VPS_DEPLOY_DIR`
- `GHCR_USERNAME`
- `GHCR_TOKEN`

GitHub `staging` Environment variables:

- `STAGING_PUBLIC_BASE_URL`

The deploy workflow does not create these values. Operators must create and maintain them.

## Required VPS Files

Operators must create `$VPS_DEPLOY_DIR/.env.staging` before the first deploy. Use [.env.staging.example](/Users/ik/repos/openmirage/.env.staging.example) as the baseline and add operator-managed secrets there.

Minimum staging env expectations:

- `OPENMIRAGE_ENV=staging`
- `CADDY_SITE_ADDRESS=<public staging host>`
- `APP_BASE_URL=https://<public staging host>`
- `OPENMIRAGE_PUBLIC_BASE_URL=https://<public staging host>`
- `OPENMIRAGE_PUBLIC_COLLAB_HTTP_URL=https://<public staging host>/collab`
- `OPENMIRAGE_PUBLIC_COLLAB_WS_URL=wss://<public staging host>/collab`
- `OPENMIRAGE_PUBLIC_WORKER_HTTP_URL=https://<public staging host>/worker`
- `SESSION_COOKIE_SECURE=true`
- storage configuration pointed at the chosen provider
- app/session/auth secrets required by the services

Preferred storage default:

- `STORAGE_PROVIDER=s3-compatible`
- use an external S3-compatible backend for staging by default

Optional supported variant:

- self-hosted MinIO on the VPS, only if explicitly chosen

## Fresh VPS Preparation

Provisioning the VM itself is out of scope for this slice. Once the VPS exists, prepare it with these steps:

1. Install Docker Engine or Docker Desktop-equivalent server packages.
2. Install `docker compose`.
3. Create the deploy root and `docker` subdirectory:
   ```bash
   mkdir -p "$VPS_DEPLOY_DIR/docker"
   ```
4. Create `$VPS_DEPLOY_DIR/.env.staging` from the repo example and fill in operator-managed values.
5. Confirm the deploy user can run Docker commands on the VPS.
6. Confirm the staging hostname resolves to the VPS and ports `80` and `443` are reachable.
7. Confirm GitHub Actions can SSH to the VPS using the configured key and known-hosts entry.

The deploy workflow copies the checked-in Compose and Caddy assets, so you do not need to clone the repo or build images on the VPS.

## Release And Update Flow

The canonical staging deploy entrypoint is `.github/workflows/staging-deploy.yml`.

Default deploy flow:

1. Merge the desired change to `main` so CI publishes immutable GHCR images.
2. Run the manual `Staging Deploy` workflow from `main`.
3. Leave the `image_tag` input empty to deploy the current commit SHA, or provide a previously published immutable tag to redeploy that release.
4. The workflow:
   - derives GHCR image references from the selected immutable tag
   - verifies SSH access plus the required VPS files
   - copies `docker-compose.yml`, `docker-compose.staging.yml`, and `docker/Caddyfile` into `$VPS_DEPLOY_DIR`
   - logs the VPS into GHCR
   - runs `docker compose pull`
   - runs `docker compose run --rm db-migrate`
   - runs `docker compose up -d --no-build --no-deps web api collab worker caddy`
   - executes the public smoke verification sequence

This flow is the source of truth. Do not replace it with ad hoc SSH commands except when debugging a failed deployment.

## Migration And Rollback Expectations

Migration behavior:

- Each staging deploy runs `db-migrate` before updating the long-running services.
- The migration image is derived from the same immutable tag as the application images.

Rollback behavior:

- Rollback means rerunning the same `Staging Deploy` workflow with a previously published immutable `image_tag`.
- Safe rollback assumes the intervening migrations are backward-compatible or at least non-breaking for the older application image.
- Database rollback is not part of this slice.
- If a deploy succeeds at the image level but a migration is incompatible with the prior image, the response is:
  - ship a forward fix, or
  - use the backup/restore recovery procedure defined in step 12

Do not invent manual down-migration steps on the VPS.

## Post-Deploy Verification

Each deploy is only successful if all of these checks pass through the public Caddy origin:

1. `GET /`
2. `GET /healthz`
3. `GET /readyz`
4. `GET /collab/healthz`
5. `GET /worker/readyz`
6. authenticated page-scoped collab bootstrap at `/collab`:
   - request a dev magic link and consume a session cookie
   - create a verification project/file/page through the API
   - open `/collab` with `documentName`, `workspaceId`, `fileId`, and `pageId`
   - complete the Hocuspocus auth handshake and receive a sync reply
7. storage smoke path:
   - `GET /internal/storage/smoke`
   - `POST /internal/storage/smoke`
   - `DELETE /internal/storage/smoke?key=...`

The workflow uses the checked-in verifier:

```bash
node ./scripts/verify-staging-deploy.mjs
```

`/readyz` is the database-readiness gate for staging because the API readiness contract already verifies live Postgres reachability and storage readiness.

## Repeatability Expectations

The deployment procedure is considered correct only if:

- a fresh VPS can be prepared from this runbook without consulting prior shell history
- the same tag can be redeployed without changing server files by hand
- a previous immutable tag can be redeployed through the workflow input
- post-deploy verification proves web, API, collab, worker, database readiness, and storage connectivity

## Fresh VPS Verification

Step 10 is not considered closed until one disposable or newly provisioned VPS has been prepared strictly from this runbook and the proof has been recorded in [`ops/platform-acceptance-evidence.json`](/Users/ik/repos/openmirage/ops/platform-acceptance-evidence.json:1).

Use this procedure:

1. Start from a clean VPS with only base VM provisioning completed.
2. Install Docker Engine and `docker compose`.
3. Create `$VPS_DEPLOY_DIR` and `$VPS_DEPLOY_DIR/docker`.
4. Create `$VPS_DEPLOY_DIR/.env.staging` from [.env.staging.example](/Users/ik/repos/openmirage/.env.staging.example:1) and fill in the operator-managed values.
5. Confirm the deploy user can run Docker commands.
6. Confirm DNS, ports `80` and `443`, and GitHub Actions SSH access are working.
7. Run the canonical `Staging Deploy` workflow without adding undocumented shell commands on the VPS.
8. Confirm the public smoke checks pass and the deployed stack is reachable through the documented staging routes.
9. Record the following in `ops/platform-acceptance-evidence.json`:
   - `freshVpsPreparedFromRunbook=true`
   - `freshVpsVerifiedAt`
   - `freshVpsTarget`
   - the workflow run URL used for the rehearsal
   - whether any undocumented shell history, manual repo changes, or ad hoc deploy steps were needed

If any undocumented step is required, stop and update this runbook before treating the rehearsal as proof.

## Failure Triage

If the deploy or smoke verification fails, inspect these first on the VPS:

```bash
cd "$VPS_DEPLOY_DIR"
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml ps
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs caddy
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs api
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs collab
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs worker
```

Also inspect:

- generated magic-link origin and cookie flags
- storage credentials, bucket, and provider-specific connectivity
- authenticated page-scoped collab handshake and sync at `/collab`
- whether `.env.staging` still matches the public staging origin

## Relationship To Later Steps

This slice defines the VPS layout and repeatable deploy procedure only. Backup automation, restore drills, and full recovery validation remain step 12 work. When that slice lands, it should attach to this layout by backing up the Postgres data and the operator-managed deployment configuration needed to recreate the stack.

## Relationship To Recovery

The recovery slice is now defined in [`ops/backup-restore-recovery.md`](/Users/ik/repos/openmirage/ops/backup-restore-recovery.md:1).

Use the staging deploy flow and the recovery flow together:

- staging deploy remains the only supported way to update runtime images on the VPS
- backup artifacts should be produced from the deployed staging stack by running `pnpm backup:create` with `BACKUP_SSH_TARGET`, `VPS_DEPLOY_DIR`, and `BACKUP_ROOT` set
- `.env.staging` remains operator-managed and must be preserved for recovery
- a failed VPS should be reprovisioned by restoring the operator-managed env/config, restoring Postgres, reconnecting or restoring storage, and then rerunning the staging deploy workflow

The deploy workflow is not a substitute for backups, and backups are not a substitute for rerunning the immutable-image deploy flow.
