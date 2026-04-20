# Domain And VPS Operator Runbook

## Purpose

Use this runbook to prepare and operate the OpenMirage staging and production VPS environments.

The deployment model is intentionally simple:

- one VPS per environment
- Docker Compose for runtime orchestration
- Caddy as the public entrypoint
- GitHub Actions for immutable-image deployments

## Environment Contract

The current environment origins are:

- staging: `https://staging.openmirage.iankinskey.com`
- production: `https://openmirage.iankinskey.com`

Each environment is expected to serve the application at the origin root with these routed paths behind Caddy:

- `/`
- `/auth`
- `/collab`
- `/worker`

## Prepare A VPS

Complete these steps once for each VPS:

1. Provision a Linux VPS with a stable public IPv4 address.
2. Install Docker Engine and `docker compose`.
3. Create a deploy user, for example `deploy`.
4. Ensure the deploy user can run Docker commands.
5. Open inbound TCP ports `80` and `443`.
6. Choose a deploy directory, for example `/srv/openmirage`.

Verify on the VPS:

```bash
docker --version
docker compose version
sudo ss -ltnp | grep -E ':(80|443)\s'
```

If ports `80` or `443` are already occupied, resolve that before deploying Caddy.

## Bootstrap Staging Files

From a local clone of the repo, create the staging environment file and deploy directory:

```bash
VPS_HOST=<staging-vps-host-or-ip> \
VPS_USER=deploy \
VPS_PORT=22 \
VPS_DEPLOY_DIR=/srv/openmirage \
STAGING_PUBLIC_BASE_URL=https://staging.openmirage.iankinskey.com \
node ./scripts/setup-staging-prereqs.mjs
```

Verify the generated staging files:

```bash
VPS_HOST=<staging-vps-host-or-ip> \
VPS_USER=deploy \
VPS_PORT=22 \
VPS_DEPLOY_DIR=/srv/openmirage \
STAGING_PUBLIC_BASE_URL=https://staging.openmirage.iankinskey.com \
node ./scripts/verify-staging-prereqs.mjs
```

This creates:

- `$VPS_DEPLOY_DIR/`
- `$VPS_DEPLOY_DIR/docker/`
- `$VPS_DEPLOY_DIR/.env.staging`

## Bootstrap Production Files

From a local clone of the repo, create the production environment file and deploy directory:

```bash
VPS_HOST=<production-vps-host-or-ip> \
VPS_USER=deploy \
VPS_PORT=22 \
VPS_DEPLOY_DIR=/srv/openmirage \
PRODUCTION_PUBLIC_BASE_URL=https://openmirage.iankinskey.com \
node ./scripts/setup-production-prereqs.mjs
```

Verify the generated production files:

```bash
VPS_HOST=<production-vps-host-or-ip> \
VPS_USER=deploy \
VPS_PORT=22 \
VPS_DEPLOY_DIR=/srv/openmirage \
PRODUCTION_PUBLIC_BASE_URL=https://openmirage.iankinskey.com \
node ./scripts/verify-production-prereqs.mjs
```

This creates:

- `$VPS_DEPLOY_DIR/`
- `$VPS_DEPLOY_DIR/docker/`
- `$VPS_DEPLOY_DIR/.env.production`

## Complete Operator-Managed Environment Values

The bootstrap helpers create the public-origin and Caddy-facing values. Operators still need to supply the environment-specific secrets and storage configuration.

At minimum, confirm the deployed environment includes:

- database credentials and a reachable Postgres instance
- storage provider configuration
- storage bucket and storage credentials
- application and session secrets required by the services
- `SMOKE_TEST_SHARED_SECRET` for staging verification
- optional `SENTRY_DSN`

Use [`.env.staging.example`](../.env.staging.example) as the baseline for staging values.

## Configure GitHub Environments

### Staging

The staging deployment workflow is [`.github/workflows/staging-deploy.yml`](../.github/workflows/staging-deploy.yml).

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
  - `STAGING_PUBLIC_BASE_URL=https://staging.openmirage.iankinskey.com`

To capture `VPS_KNOWN_HOSTS`:

```bash
ssh-keyscan -p 22 <staging-vps-host-or-ip>
```

### Production

The production deployment workflow is [`.github/workflows/production-deploy.yml`](../.github/workflows/production-deploy.yml).

Configure the GitHub `production` environment with:

- secrets:
  - `VPS_HOST`
  - `VPS_PORT`
  - `VPS_USER`
  - `VPS_SSH_PRIVATE_KEY`
  - `VPS_KNOWN_HOSTS`
  - `VPS_DEPLOY_DIR`
  - `GHCR_USERNAME`
  - `GHCR_TOKEN`
- variables:
  - `PRODUCTION_PUBLIC_BASE_URL=https://openmirage.iankinskey.com`

To capture `VPS_KNOWN_HOSTS`:

```bash
ssh-keyscan -p 22 <production-vps-host-or-ip>
```

## Run A Staging Deploy

From GitHub Actions, run `Staging Deploy` from `main`.

The workflow will:

1. resolve immutable GHCR image references
2. verify SSH access and required VPS files
3. sync checked-in Compose and Caddy assets
4. pull images
5. run migrations
6. recreate `web`, `api`, `collab`, `worker`, and `caddy`
7. run the public staging smoke checks

If the workflow fails, inspect the VPS:

```bash
ssh deploy@<staging-vps-host-or-ip>
cd /srv/openmirage
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs caddy
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs api
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs collab
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs worker
```

## Run A Production Deploy

From GitHub Actions, run `Production Deploy` from `main`.

The production workflow uses the same checked-in Compose and Caddy assets, but reads `.env.production` on the VPS and verifies the production origin after deploy.

If the workflow fails, inspect the VPS:

```bash
ssh deploy@<production-vps-host-or-ip>
cd /srv/openmirage
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.staging.yml logs caddy
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.staging.yml logs api
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.staging.yml logs collab
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.staging.yml logs worker
```

## Related Runbooks

- [Staging VPS deployment runbook](./staging-vps.md)
- [Backup, restore, and recovery runbook](./backup-restore-recovery.md)
- [Platform verification runbook](./platform-acceptance.md)
