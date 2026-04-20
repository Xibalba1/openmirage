# Staging VPS Deployment Runbook

## Purpose

Use this runbook to deploy OpenMirage to the staging VPS and verify that the deployed stack is healthy through the public staging origin.

The supported staging deployment model is:

- GitHub Actions for deployment orchestration
- GHCR for immutable images
- Docker Compose on a single VPS
- Caddy as the only public entrypoint

## Prerequisites

Before the first staging deploy, confirm:

1. GitHub Actions is enabled for the repository.
2. The `staging` GitHub environment exists and is configured.
3. GHCR publish access is available to the workflow identity.
4. The staging hostname resolves to the target VPS.
5. Inbound ports `80` and `443` reach the VPS.
6. Docker and `docker compose` are installed on the VPS.
7. `$VPS_DEPLOY_DIR/.env.staging` exists on the VPS.

For local validation before deploying, use:

```bash
pnpm verify:platform:prereqs
pnpm verify:platform:infra
```

## Standard VPS Layout

Use one deploy root for the staging Compose project:

```text
$VPS_DEPLOY_DIR/
  .env.staging
  docker-compose.yml
  docker-compose.staging.yml
  docker/
    Caddyfile
```

Rules:

- `.env.staging` is operator-managed and persists across deploys.
- `docker-compose.yml`, `docker-compose.staging.yml`, and `docker/Caddyfile` are copied from the repo during each deploy.
- Persistent state uses Docker-managed named volumes.
- If staging self-hosts blob storage on-box, add a dedicated volume for that storage service.

## GitHub Environment Configuration

Configure the GitHub `staging` environment with:

- secrets:
  - `VPS_HOST`
  - `VPS_PORT`
  - `VPS_USER`
  - `VPS_SSH_PRIVATE_KEY`
  - `VPS_KNOWN_HOSTS`
  - `VPS_DEPLOY_DIR`
  - `GHCR_USERNAME`
  - `GHCR_TOKEN`
  - `STAGING_SMOKE_TEST_SECRET`
- variables:
  - `STAGING_PUBLIC_BASE_URL`

The workflow expects operators to create and maintain these values.

## Staging Environment File

Create `$VPS_DEPLOY_DIR/.env.staging` before the first deploy. Use [`.env.staging.example`](../.env.staging.example) as the baseline.

The staging environment must define, at minimum:

- `OPENMIRAGE_ENV=staging`
- `CADDY_SITE_ADDRESS=<public staging host>`
- `APP_BASE_URL=https://<public staging host>`
- `OPENMIRAGE_PUBLIC_BASE_URL=https://<public staging host>`
- `OPENMIRAGE_PUBLIC_COLLAB_HTTP_URL=https://<public staging host>/collab`
- `OPENMIRAGE_PUBLIC_COLLAB_WS_URL=wss://<public staging host>/collab`
- `OPENMIRAGE_PUBLIC_WORKER_HTTP_URL=https://<public staging host>/worker`
- `SESSION_COOKIE_SECURE=true`
- storage configuration for the selected provider
- service secrets required by the runtime
- `SMOKE_TEST_SHARED_SECRET`, matching the GitHub `STAGING_SMOKE_TEST_SECRET`

Recommended default for staging storage:

- `STORAGE_PROVIDER=s3-compatible`
- use an external S3-compatible backend by default

Self-hosted MinIO remains supported when explicitly chosen.

## Prepare A Fresh Staging VPS

Once the VPS exists, prepare it with these steps:

1. Install Docker Engine and `docker compose`.
2. Create the deploy root and `docker` subdirectory:

```bash
mkdir -p "$VPS_DEPLOY_DIR/docker"
```

3. Create `$VPS_DEPLOY_DIR/.env.staging`.
4. Confirm the deploy user can run Docker commands.
5. Confirm the staging hostname resolves to the VPS.
6. Confirm ports `80` and `443` are reachable.
7. Confirm GitHub Actions can SSH to the VPS with the configured key.

The repo does not need to be cloned on the VPS. The workflow copies the checked-in deploy assets during deploy.

## Deployment Flow

The canonical staging deploy entrypoint is [`.github/workflows/staging-deploy.yml`](../.github/workflows/staging-deploy.yml).

Default flow:

1. Merge the desired change to `main` so CI publishes immutable GHCR images.
2. Run the manual `Staging Deploy` workflow from `main`.
3. Leave `image_tag` empty to deploy the current commit SHA, or provide a previously published immutable tag to redeploy that release.
4. The workflow will:
   - verify SSH access and required files on the VPS
   - copy `docker-compose.yml`, `docker-compose.staging.yml`, and `docker/Caddyfile`
   - log into GHCR
   - pull images
   - run `db-migrate`
   - recreate the long-running services
   - run the public staging smoke checks

This workflow is the source of truth. Do not replace it with ad hoc server-side deploy steps.

## Post-Deploy Verification

Each staging deploy should verify all of the following through the public Caddy origin:

1. `GET /`
2. `GET /healthz`
3. `GET /readyz`
4. `GET /metrics`
5. `GET /collab/healthz`
6. `GET /collab/metrics`
7. `GET /worker/readyz`
8. `GET /worker/metrics`
9. `GET /worker/status`
10. websocket behavior at `/collab`
11. storage smoke upload, list, and delete through the API
12. authenticated asset delivery through the public staging origin

The workflow uses the checked-in verifier:

```bash
node ./scripts/verify-staging-deploy.mjs
```

## Rollback Expectations

Rollback means rerunning the same `Staging Deploy` workflow with a previously published immutable `image_tag`.

Notes:

- database down-migrations are not part of the supported workflow
- safe rollback assumes compatible schema changes
- when a schema change is not backward-compatible, the recovery path is a forward fix or a restore from backup

Use [`ops/backup-restore-recovery.md`](./backup-restore-recovery.md) for recovery procedures.

## Repeatability

The staging deployment procedure is considered healthy only if:

- a fresh VPS can be prepared from this runbook alone
- the same immutable tag can be redeployed without hand-editing server files
- post-deploy verification proves web, API, collaboration, worker, database readiness, and storage connectivity

Record fresh-VPS verification details in the platform evidence file described in [`ops/platform-acceptance.md`](./platform-acceptance.md).

## Failure Triage

If a deploy or smoke check fails, inspect the VPS first:

```bash
cd "$VPS_DEPLOY_DIR"
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml ps
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs caddy
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs api
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs collab
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs worker
```

Also confirm:

- `STAGING_SMOKE_TEST_SECRET` matches `SMOKE_TEST_SHARED_SECRET`
- storage credentials and bucket configuration are correct
- the public staging origin matches `.env.staging`
- websocket traffic is reaching `/collab`
