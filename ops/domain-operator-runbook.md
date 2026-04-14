# OpenMirage Domain And VPS Runbook

This runbook covers the operator work needed after DNS exists for:

- production: `openmirage.iankinskey.com`
- staging: `staging.openmirage.iankinskey.com`

It stays within the existing MVP deployment model: one VPS, Docker Compose, and Caddy as the single public entrypoint.

## Current State

Squarespace DNS records already exist for the two subdomains.

The remaining work is:

1. prepare the VPS
2. bootstrap staging and production env files on the VPS
3. confirm inbound networking for `80` and `443`
4. deploy staging through the existing GitHub workflow
5. deploy production through the same Compose assets on its chosen VPS

## What Codex Can Do

Codex can prepare commands, env-file content, checked-in deployment assets, and local repo changes.

Codex cannot:

- log into Squarespace
- create or reconfigure the VPS provider account
- open firewall rules in your cloud account
- log into your GitHub account or set GitHub repository secrets for you
- SSH into your VPS unless you provide reachable host access from this environment

## Hostname Contract

Use these origins exactly:

- staging app origin: `https://staging.openmirage.iankinskey.com`
- production app origin: `https://openmirage.iankinskey.com`

The repo expects each environment to live at the origin root, with these routed paths behind Caddy:

- `/`
- `/auth`
- `/collab`
- `/worker`

## Step 1: Prepare The VPS

Do this once per VPS.

1. Create a Linux VPS with a stable public IPv4 address.
2. Install Docker Engine and Docker Compose.
3. Create a deploy user, for example `deploy`.
4. Ensure that deploy user can run Docker commands.
5. Open inbound TCP ports `80` and `443`.
6. Choose a deploy directory, for example `/srv/openmirage`.

Verify on the VPS:

```bash
docker --version
docker compose version
sudo ss -ltnp | grep -E ':(80|443)\s'
```

If ports `80` or `443` are already occupied by another process, stop and resolve that before trying to deploy Caddy.

## Step 2: Bootstrap Staging Prereqs

Run this from your local clone of the repo after confirming SSH access to the staging VPS.

```bash
VPS_HOST=<staging-vps-host-or-ip> \
VPS_USER=deploy \
VPS_PORT=22 \
VPS_DEPLOY_DIR=/srv/openmirage \
STAGING_PUBLIC_BASE_URL=https://staging.openmirage.iankinskey.com \
pnpm setup:staging:prereqs
```

What this does:

- creates `/srv/openmirage`
- creates `/srv/openmirage/docker`
- writes `/srv/openmirage/.env.staging`

Then verify it:

```bash
VPS_HOST=<staging-vps-host-or-ip> \
VPS_USER=deploy \
VPS_PORT=22 \
VPS_DEPLOY_DIR=/srv/openmirage \
STAGING_PUBLIC_BASE_URL=https://staging.openmirage.iankinskey.com \
pnpm verify:staging:prereqs
```

Expected generated staging values:

```dotenv
OPENMIRAGE_ENV=staging
CADDY_SITE_ADDRESS=staging.openmirage.iankinskey.com
APP_BASE_URL=https://staging.openmirage.iankinskey.com
OPENMIRAGE_PUBLIC_BASE_URL=https://staging.openmirage.iankinskey.com
OPENMIRAGE_PUBLIC_COLLAB_HTTP_URL=https://staging.openmirage.iankinskey.com/collab
OPENMIRAGE_PUBLIC_COLLAB_WS_URL=wss://staging.openmirage.iankinskey.com/collab
OPENMIRAGE_PUBLIC_WORKER_HTTP_URL=https://staging.openmirage.iankinskey.com/worker
AUTH_PATH=/auth
COLLAB_WS_PATH=/collab
SESSION_COOKIE_NAME=openmirage_session
SESSION_COOKIE_PATH=/
SESSION_COOKIE_SAME_SITE=lax
SESSION_COOKIE_SECURE=true
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443
ENABLE_TEST_ERROR_ROUTES=false
SENTRY_DSN=
SENTRY_ENVIRONMENT=staging
SENTRY_RELEASE=0.1.0
```

## Step 3: Bootstrap Production Prereqs

Run this from your local clone of the repo after confirming SSH access to the production VPS.

```bash
VPS_HOST=<production-vps-host-or-ip> \
VPS_USER=deploy \
VPS_PORT=22 \
VPS_DEPLOY_DIR=/srv/openmirage \
PRODUCTION_PUBLIC_BASE_URL=https://openmirage.iankinskey.com \
pnpm setup:production:prereqs
```

Then verify it:

```bash
VPS_HOST=<production-vps-host-or-ip> \
VPS_USER=deploy \
VPS_PORT=22 \
VPS_DEPLOY_DIR=/srv/openmirage \
PRODUCTION_PUBLIC_BASE_URL=https://openmirage.iankinskey.com \
pnpm verify:production:prereqs
```

Expected generated production values:

```dotenv
OPENMIRAGE_ENV=production
CADDY_SITE_ADDRESS=openmirage.iankinskey.com
APP_BASE_URL=https://openmirage.iankinskey.com
OPENMIRAGE_PUBLIC_BASE_URL=https://openmirage.iankinskey.com
OPENMIRAGE_PUBLIC_COLLAB_HTTP_URL=https://openmirage.iankinskey.com/collab
OPENMIRAGE_PUBLIC_COLLAB_WS_URL=wss://openmirage.iankinskey.com/collab
OPENMIRAGE_PUBLIC_WORKER_HTTP_URL=https://openmirage.iankinskey.com/worker
AUTH_PATH=/auth
COLLAB_WS_PATH=/collab
SESSION_COOKIE_NAME=openmirage_session
SESSION_COOKIE_PATH=/
SESSION_COOKIE_SAME_SITE=lax
SESSION_COOKIE_SECURE=true
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443
ENABLE_TEST_ERROR_ROUTES=false
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=0.1.0
```

## Step 4: Fill In Remaining Operator-Managed Secrets

The bootstrap helpers only create the origin and Caddy-facing values. You still need to make sure the actual runtime secrets and storage settings are available to the deployment.

At minimum, verify the environment you deploy with includes:

- database credentials and reachable Postgres
- storage provider configuration
- storage bucket
- storage credentials
- auth secrets if required by the API service
- optional Sentry DSN

If staging and production use different infrastructure, keep those values isolated per environment.

## Step 5: Configure GitHub For Staging Deploys

The checked-in staging workflow already exists at [staging-deploy.yml](/Users/ik/repos/openmirage/.github/workflows/staging-deploy.yml:1).

In the GitHub repository:

1. Create or verify the `staging` Environment.
2. Add these environment secrets:
   - `VPS_HOST`
   - `VPS_PORT`
   - `VPS_USER`
   - `VPS_SSH_PRIVATE_KEY`
   - `VPS_KNOWN_HOSTS`
   - `VPS_DEPLOY_DIR`
   - `GHCR_USERNAME`
   - `GHCR_TOKEN`
3. Add this environment variable:
   - `STAGING_PUBLIC_BASE_URL=https://staging.openmirage.iankinskey.com`

To capture `VPS_KNOWN_HOSTS` from your machine:

```bash
ssh-keyscan -p 22 <staging-vps-host-or-ip>
```

## Step 6: Run The Staging Deploy

From GitHub Actions, run the `Staging Deploy` workflow from `main`.

That workflow will:

1. derive GHCR image tags
2. verify VPS prerequisites
3. sync `docker-compose.yml`, `docker-compose.staging.yml`, and `docker/Caddyfile`
4. pull images
5. run migrations
6. start `web`, `api`, `collab`, `worker`, and `caddy`
7. smoke test the public origin

If it fails, inspect:

```bash
ssh deploy@<staging-vps-host-or-ip>
cd /srv/openmirage
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs caddy
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs api
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs collab
docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml logs worker
```

## Step 7: Configure GitHub For Production Deploys

The repo now includes [production-deploy.yml](/Users/ik/repos/openmirage/.github/workflows/production-deploy.yml:1).

In the GitHub repository:

1. Create or verify the `production` Environment.
2. Add these environment secrets:
   - `VPS_HOST`
   - `VPS_PORT`
   - `VPS_USER`
   - `VPS_SSH_PRIVATE_KEY`
   - `VPS_KNOWN_HOSTS`
   - `VPS_DEPLOY_DIR`
   - `GHCR_USERNAME`
   - `GHCR_TOKEN`
3. Add this environment variable:
   - `PRODUCTION_PUBLIC_BASE_URL=https://openmirage.iankinskey.com`

To capture `VPS_KNOWN_HOSTS` from your machine:

```bash
ssh-keyscan -p 22 <production-vps-host-or-ip>
```

## Step 8: Run The Production Deploy

From GitHub Actions, run the `Production Deploy` workflow from `main`.

That workflow will:

1. derive GHCR image tags
2. verify VPS prerequisites
3. sync `docker-compose.yml`, `docker-compose.staging.yml`, and `docker/Caddyfile`
4. pull images
5. run migrations
6. start `web`, `api`, `collab`, `worker`, and `caddy`
7. smoke test the public origin

If it fails, inspect:

```bash
ssh deploy@<production-vps-host-or-ip>
cd /srv/openmirage
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.staging.yml logs caddy
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.staging.yml logs api
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.staging.yml logs collab
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.staging.yml logs worker
```

## Step 9: Confirm DNS And TLS Resolution

From your local machine:

```bash
dig +short openmirage.iankinskey.com
dig +short staging.openmirage.iankinskey.com
curl -I https://openmirage.iankinskey.com/
curl -I https://staging.openmirage.iankinskey.com/
```

Expected:

- DNS resolves to the intended VPS IP
- HTTPS succeeds
- Caddy serves a certificate for each hostname

## Operator Checklist

You still need to do these manually:

- provision the VPS or confirm the existing VPS details
- ensure ports `80` and `443` are open
- provide SSH reachability from your machine to each VPS
- set GitHub Environment secrets and variables
- trigger the staging workflow
- trigger the production workflow

Codex has already reduced the manual work by providing:

- the exact hostname contract
- the staging bootstrap path already in repo
- the production bootstrap and verification helpers added in this change
- the production GitHub Actions deploy workflow
- a concrete runbook for the remaining operator steps
