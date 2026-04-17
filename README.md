# OpenMirage

OpenMirage is a browser-based, self-hostable collaborative UI design workspace for startup product teams. This repository currently implements the runtime service scaffolding slice plus the initial Postgres metadata, auth/session, storage, and observability baselines: bootable `web`, `api`, `collab`, and `worker` shells with shared env, health, logging, metrics, migrations, development bootstrap contracts, magic-link auth, server-managed sessions, and pluggable blob storage.

## Current Slice

This slice establishes the initial runtime contract for the platform services while keeping the product itself empty.

Included now:

- independently bootable `web`, `api`, `collab`, and `worker` dev services
- shared env parsing and validation in `@openmirage/config-env`
- structured service logging, metrics, and error-reporting bootstrap in `@openmirage/observability`
- Postgres migration and reset workflow in `@openmirage/db`
- relational metadata schema for workspaces, files, pages, auth artifacts, comments, assets, share links, and export jobs
- deterministic development bootstrap data for one workspace and one test user flow
- magic-link auth request and consume flow with Postgres-backed sessions
- protected session validation and workspace membership lookup endpoints
- collab websocket authorization delegated to the API/session layer
- API health and readiness endpoints
- collab health endpoint plus websocket mount path
- worker heartbeat and HTTP status surface
- a React/Vite landing shell that probes API and collab reachability
- Prometheus-compatible `/metrics` endpoints for `api`, `collab`, and `worker`
- env-gated forced test error routes and Sentry integration for backend services
- a provider-backed storage abstraction with `minio`, generic `s3-compatible`, and `local` adapters
- production-oriented Dockerfiles for `web`, `api`, `collab`, and `worker`
- a full local Docker Compose stack for Caddy, web, api, collab, worker, PostgreSQL, and MinIO
- Compose-managed migration and development bootstrap jobs
- Caddy as the single local browser entrypoint with websocket proxying for collab
- API storage smoke endpoints for upload, list, and delete verification through the abstraction
- CI image validation and a protected staging deploy workflow that reuses the same checked-in artifacts
- a step 13 acceptance runbook and external evidence contract for staging and backup/restore closure

Not included yet:

- editor, canvas, files/pages/projects, comments, or other product routes
- SMTP-backed magic-link delivery or polished authenticated product flows
- collab document persistence or page authorization
- worker jobs, exports, or cleanup processing
- offsite backup replication or PITR

## Requirements

- Node.js `20.15.0` or newer
- `pnpm` `9.15.0` or newer

If `pnpm` is not installed globally, use `corepack enable` and `corepack pnpm`.

## Workspace Layout

- `apps/web`: browser frontend shell placeholder
- `apps/api`: HTTP API service placeholder
- `apps/collab`: realtime collaboration service placeholder
- `apps/worker`: background worker placeholder
- `packages/types`: shared service and domain contract placeholders
- `packages/auth`: auth and session helper placeholders
- `packages/db`: Postgres metadata schema, migrations, and development bootstrap helpers
- `packages/storage`: blob storage abstraction placeholders
- `packages/observability`: logging and health helper placeholders
- `packages/config-*`: shared TypeScript, ESLint, Prettier, env, and test baselines

## Canonical Commands

The canonical local bootstrap path for this slice is:

```bash
pnpm verify:platform:prereqs
docker compose up --build --wait
```

Before modifying code or trying to boot the stack on a new machine, identify prerequisites you cannot satisfy from inside the repo, check them, and stop immediately if any fail. If the prerequisite check fails, do not proceed; use the printed remediation steps, fix the failing prerequisite, and rerun the check before you continue.

For this proxy/runtime slice, treat the following as mandatory prerequisites before code changes or infrastructure verification:

- local software and access: `pnpm`, Docker, Docker Compose, access to the Docker daemon
- required local ports for the selected mode
- current Compose stack can start its baseline dependencies
- for staging-shaped runs: the public Caddy hostname, HTTPS app origin, and secure websocket origin are set in env before boot

If a prerequisite fails, stop immediately. Output the failing prerequisite and provide step-by-step remediation before proceeding.

Convenience root commands remain available:

```bash
pnpm install
pnpm compose:up
pnpm compose:down
pnpm infra:up
pnpm infra:down
pnpm dev
pnpm build
pnpm lint
pnpm format
pnpm format:check
pnpm test
pnpm typecheck
pnpm docker:build
pnpm verify:platform:prereqs
pnpm verify:platform:infra
pnpm verify:recovery:prereqs
pnpm backup:create
pnpm backup:verify
pnpm backup:restore
pnpm backup:restore:drill
pnpm db:migrate:up
pnpm db:migrate:status
pnpm db:reset
pnpm db:seed
```

## Backup And Recovery

This slice now includes the MVP backup/recovery baseline:

- Postgres-first backup artifacts using `pg_dump -Fc`
- conditional self-hosted asset archives for `minio` and `local` storage
- manifest plus `SHA256SUMS` integrity verification
- a destructive clean-room restore drill for a disposable local Compose target

Runbooks:

- [`ops/backup-restore-recovery.md`](/Users/ik/repos/openmirage/ops/backup-restore-recovery.md:1)
- [`ops/staging-vps.md`](/Users/ik/repos/openmirage/ops/staging-vps.md:1)
- [`ops/backup-restore-drill-evidence.md`](/Users/ik/repos/openmirage/ops/backup-restore-drill-evidence.md:1)

Required prerequisite instruction for this slice:

> Before modifying any code, identify any prerequisites to your work that you cannot accomplish (ex: software installs on the local machine). Check those prerequisites (pass or fail). If any fail, do not proceed. Output the failures and provide procedural, step-by-step instructions on how to complete/fulfill the failing prerequisites.

Typical local recovery flow:

```bash
pnpm verify:recovery:prereqs
export BACKUP_ROOT=/tmp/openmirage-backups
pnpm backup:create
export BACKUP_ARTIFACT_DIR=/tmp/openmirage-backups/openmirage-backup-<timestamp>
pnpm backup:verify
pnpm verify:recovery:prereqs restore-drill
export OPENMIRAGE_RECOVERY_ALLOW_DESTRUCTIVE=true
pnpm backup:restore:drill
```

Stop local infrastructure when you are done:

```bash
docker compose down --remove-orphans
```

Run services independently when you want to verify one slice surface at a time:

```bash
pnpm --filter @openmirage/api dev
pnpm --filter @openmirage/collab dev
pnpm --filter @openmirage/worker dev
pnpm --filter @openmirage/web dev
```

Key endpoints:

- web shell through Caddy: `http://localhost/`
- api health through Caddy: `http://localhost/healthz`
- api readiness through Caddy: `http://localhost/readyz`
- api metrics through Caddy: `http://localhost/metrics`
- api auth entrypoint through Caddy: `http://localhost/auth/entry`
- api auth session through Caddy: `http://localhost/auth/session`
- collab health through Caddy: `http://localhost/collab/healthz`
- collab metrics through Caddy: `http://localhost/collab/metrics`
- collab websocket through Caddy: `ws://localhost/collab`
- worker health through Caddy: `http://localhost/worker/healthz`
- worker readiness through Caddy: `http://localhost/worker/readyz`
- worker metrics through Caddy: `http://localhost/worker/metrics`
- worker status through Caddy: `http://localhost/worker/status`
- storage smoke list through Caddy: `http://localhost/internal/storage/smoke`
- postgres operator port: `localhost:5432`
- MinIO API operator port: `http://localhost:9000`
- MinIO console operator port: `http://localhost:9001`

## Tooling Conventions

- Workspace `tsconfig.json` files inherit from `@openmirage/config-typescript`, not bespoke root target configs.
- Cross-workspace imports must use workspace package names such as `@openmirage/types`.
- Relative imports are allowed only within a single workspace.
- Repo formatting is controlled by the root Prettier config and `pnpm format`.

## Environment Files

Each app includes an `.env.example` with the variables needed for this slice. The examples are aligned to the Docker Compose topology for the canonical boot path. Node services still load `.env` automatically if present, and host-run `pnpm dev` remains available as a convenience path.

The Compose stack is now explicitly Caddy-first. Browser-facing URLs must use the public Caddy origin rather than container hostnames or internal ports.
Use [.env.staging.example](/Users/ik/repos/openmirage/.env.staging.example) as the baseline for staging env values.

Auth/session envs in `apps/api/.env.example`:

- `APP_BASE_URL=http://localhost`
- `SESSION_COOKIE_NAME=openmirage_session`
- `SESSION_COOKIE_PATH=/`
- `SESSION_COOKIE_SAME_SITE=lax`
- `SESSION_COOKIE_SECURE=false` for local HTTP, `true` behind HTTPS in staging
- `AUTH_MAGIC_LINK_TTL_MINUTES=15`
- `AUTH_SESSION_TTL_DAYS=30`
- `DEV_AUTH_EXPOSE_MAGIC_LINK=true` to include the dev magic link in the request response
- `SMOKE_TEST_SHARED_SECRET=openmirage-smoke-secret` for the secret-gated collab smoke bootstrap/cleanup routes used by local and staging verification

The storage-bearing services share the same storage env contract:

- `STORAGE_PROVIDER=minio|s3-compatible|local`
- `STORAGE_BUCKET=openmirage-assets`
- `STORAGE_LOCAL_ROOT=.openmirage/storage`
- `STORAGE_S3_ENDPOINT=http://minio:9000`
- `STORAGE_S3_REGION=us-east-1`
- `STORAGE_S3_ACCESS_KEY_ID=openmirage`
- `STORAGE_S3_SECRET_ACCESS_KEY=openmirage123`
- `STORAGE_S3_FORCE_PATH_STYLE=true`
- `STORAGE_PUBLIC_BASE_URL=` optional public base URL for direct object resolution when the browser should fetch from a public object origin

For local development, the default `minio` settings match `docker-compose.yml`. For staging, switch to `STORAGE_PROVIDER=s3-compatible` and point the same variables at the target S3-compatible backend. No application code changes should be required.
If staging or self-hosted deployments use an internal-only MinIO endpoint such as `http://minio:9000`, keep browser-facing editor assets on the API content route and leave `STORAGE_PUBLIC_BASE_URL` unset unless the object origin is intentionally public and reachable from the browser.

Compose-facing proxy envs for this slice:

- `CADDY_SITE_ADDRESS=http://localhost` for local HTTP, or `staging.example.com` for staging TLS
- `APP_BASE_URL=https://staging.example.com` in staging so magic links and redirects use the public origin
- `OPENMIRAGE_PUBLIC_BASE_URL=https://staging.example.com` for browser HTTP calls
- `OPENMIRAGE_PUBLIC_COLLAB_HTTP_URL=https://staging.example.com/collab` for browser health/debug references
- `OPENMIRAGE_PUBLIC_COLLAB_WS_URL=wss://staging.example.com/collab` for browser websocket traffic
- `OPENMIRAGE_PUBLIC_WORKER_HTTP_URL=https://staging.example.com/worker` if worker health/status remain exposed through Caddy
- `COLLAB_WS_PATH=/collab`
- `AUTH_PATH=/auth`
- `SESSION_COOKIE_SECURE=true` in staging

Local defaults are already baked into `docker-compose.yml`. Staging should reuse the same images and base Compose file with env overrides plus the staging port override file:

```bash
pnpm verify:platform:prereqs
docker compose -f docker-compose.yml -f docker-compose.staging.yml up --build --wait
```

The staging override adds `443:443` for Caddy. The same route model remains in use for local and staging.

## Proxy Routing

Caddy is the only browser-facing entrypoint in this slice.

- `/` proxies to `web`
- `/auth*`, `/healthz`, `/readyz`, `/metrics`, `/internal*`, and `/__diagnostics*` proxy to `api`
- `/collab` and `/collab/*` proxy to `collab`, including websocket upgrades
- `/worker/healthz`, `/worker/readyz`, `/worker/metrics`, and `/worker/status` proxy to `worker`

If a browser flow only works when you bypass Caddy and hit a service container directly, treat that as a failure for this slice.

## Storage Smoke Check

Start the full stack:

```bash
pnpm verify:platform:prereqs
docker compose up --build --wait
```

Then verify the storage slice through the API:

```bash
curl http://localhost/internal/storage/smoke
curl -X POST http://localhost/internal/storage/smoke \
  -H 'content-type: application/json' \
  -d '{"key":"smoke/hello.txt","contentType":"text/plain","bodyBase64":"aGVsbG8="}'
curl http://localhost/internal/storage/smoke
curl -X DELETE 'http://localhost/internal/storage/smoke?key=smoke/hello.txt'
```

Expected result:

- `docker compose up --build --wait` brings up Caddy, web, api, collab, worker, PostgreSQL, MinIO, migration bootstrap, and bucket bootstrap
- API `/healthz` reports liveness plus configured dependency details
- API `/readyz` verifies live Postgres reachability and storage readiness
- `POST` uploads the object and returns a download URL
- `GET` lists the uploaded object
- `DELETE` removes it without any provider-specific API code path

## Auth Smoke Check

Start the full stack:

```bash
pnpm verify:platform:prereqs
docker compose up --build --wait
```

Request a dev magic link:

```bash
curl -X POST http://localhost/auth/magic-link/request \
  -H 'content-type: application/json' \
  -d '{"email":"dev@openmirage.local"}'
```

Expected result:

- the API logs a structured `magic link requested` event
- the JSON response includes `delivery: "log"`
- in development, the response also includes `magicLinkUrl`
- the returned `magicLinkUrl` uses the public Caddy origin rather than an internal hostname

Consume the returned `magicLinkUrl` and store the session cookie:

```bash
curl -i -c /tmp/openmirage-auth-cookiejar.txt '<magicLinkUrl>'
```

Validate, refresh, and revoke the session:

```bash
curl -b /tmp/openmirage-auth-cookiejar.txt http://localhost/auth/session
curl -X POST -b /tmp/openmirage-auth-cookiejar.txt -c /tmp/openmirage-auth-cookiejar.txt \
  http://localhost/auth/session/refresh
curl -X POST -b /tmp/openmirage-auth-cookiejar.txt -c /tmp/openmirage-auth-cookiejar.txt \
  http://localhost/auth/logout
curl -i -b /tmp/openmirage-auth-cookiejar.txt http://localhost/auth/session
```

Expected result:

- `/auth/session` returns the current user, active session, and workspace memberships
- `/auth/session/refresh` returns `200` and re-issues the session cookie
- `/auth/logout` clears the session cookie and revokes the server-side session
- the final `/auth/session` call returns `401`
- local cookies do not include `Secure`; staging cookies do include `Secure`

Verify collab rejects unauthenticated access and accepts an authenticated session:

```bash
node --input-type=module -e "import WebSocket from 'ws';const ws=new WebSocket('ws://127.0.0.1/collab?documentName=runtime-check&workspaceId=<workspaceId>');ws.on('unexpected-response',(_req,res)=>{console.log(res.statusCode);process.exit(0);});ws.on('open',()=>{console.log('unexpected-open');process.exit(1);});"
node --input-type=module -e "import WebSocket from 'ws';const ws=new WebSocket('ws://127.0.0.1/collab?documentName=runtime-check&workspaceId=<workspaceId>',{headers:{Cookie:'openmirage_session=<sessionToken>'}});ws.on('open',()=>{console.log('open');ws.close();});ws.on('close',()=>process.exit(0));"
```

Expected result:

- the unauthenticated websocket probe receives `401`
- the authenticated websocket probe reaches `open`

## Staging Runtime Notes

This slice does not automate VPS provisioning or DNS changes, but it does assume the same images can be deployed behind Caddy on the staging VPS. The dedicated staging runbook lives at [ops/staging-vps.md](/Users/ik/repos/openmirage/ops/staging-vps.md).

Before running a staging deploy, check these operator prerequisites and stop if any fail:

1. Confirm the staging DNS name points at the VPS.
2. Confirm inbound ports `80` and `443` reach Caddy on the VPS.
3. Confirm `CADDY_SITE_ADDRESS`, `APP_BASE_URL`, `OPENMIRAGE_PUBLIC_BASE_URL`, and `OPENMIRAGE_PUBLIC_COLLAB_WS_URL` are set to the public staging origin.
4. Confirm `SESSION_COOKIE_SECURE=true`.
5. Confirm the chosen storage credentials and bucket are available.

If staging fails, inspect these first:

- `docker compose logs caddy`
- `docker compose logs api`
- `docker compose logs collab`
- generated magic-link origin and cookie flags
- websocket upgrade behavior at `/collab`

## CI And Staging Deploy

Step `9` adds the canonical GitHub Actions validation, image packaging, and staging deploy path for this monorepo. The deploy model stays intentionally boring: GitHub Actions builds the same checked-in Dockerfiles used locally, publishes immutable GHCR tags, and performs one protected manual staging deploy over SSH to a single VPS that runs Docker Compose.

The prerequisite gate for this slice is mandatory before code changes or deploy attempts. Check these first and stop immediately if any fail:

1. GitHub Actions is enabled for the repo.
2. GHCR publish permission is available for the workflow identity.
3. The `staging` GitHub Environment exists and is protected as intended.
4. CI can reach the staging VPS over SSH.
5. Docker and `docker compose` are installed on the VPS.
6. Required GitHub secrets, variables, and VPS env files are present.

Workflow inventory:

- `.github/workflows/ci.yml`: runs on pull requests to `main` and pushes to `main`; performs static validation, Docker build validation, migration safety, and GHCR image publishing on `main`
- `.github/workflows/staging-deploy.yml`: manual `workflow_dispatch` deploy from `main`, protected by the GitHub `staging` Environment approval gate, with an optional immutable `image_tag` input for redeploys or rollbacks

Static validation contract:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

Docker build validation contract:

- builds `api`, `api-tools`, `web`, `collab`, and `worker` directly from the checked-in Dockerfiles

Migration safety contract:

- runs against an ephemeral PostgreSQL service in GitHub Actions
- applies migrations with `pnpm db:migrate:up`
- verifies no drift with `pnpm db:migrate:status`

GHCR image contract:

- `ghcr.io/<owner-lowercase>/openmirage-api:<git-sha>`
- `ghcr.io/<owner-lowercase>/openmirage-api-tools:<git-sha>`
- `ghcr.io/<owner-lowercase>/openmirage-web:<git-sha>`
- `ghcr.io/<owner-lowercase>/openmirage-collab:<git-sha>`
- `ghcr.io/<owner-lowercase>/openmirage-worker:<git-sha>`
- the same images are also tagged `:main` on protected-branch pushes

Compose image override contract:

- local Compose continues to use the default `:local` image tags
- staging deploys inject immutable GHCR image references through:
  - `OPENMIRAGE_API_IMAGE`
  - `OPENMIRAGE_API_TOOLS_IMAGE`
  - `OPENMIRAGE_WEB_IMAGE`
  - `OPENMIRAGE_COLLAB_IMAGE`
  - `OPENMIRAGE_WORKER_IMAGE`

Required GitHub `staging` Environment secrets:

- `VPS_HOST`
- `VPS_PORT`
- `VPS_USER`
- `VPS_SSH_PRIVATE_KEY`
- `VPS_KNOWN_HOSTS`
- `VPS_DEPLOY_DIR`
- `GHCR_USERNAME`
- `GHCR_TOKEN`

Required GitHub `staging` Environment variables:

- `STAGING_PUBLIC_BASE_URL`: public HTTPS origin used for post-deploy smoke checks, for example `https://staging.example.com`

Required GitHub `production` Environment secrets:

- `VPS_HOST`
- `VPS_PORT`
- `VPS_USER`
- `VPS_SSH_PRIVATE_KEY`
- `VPS_KNOWN_HOSTS`
- `VPS_DEPLOY_DIR`
- `GHCR_USERNAME`
- `GHCR_TOKEN`

Required GitHub `production` Environment variables:

- `PRODUCTION_PUBLIC_BASE_URL`: public HTTPS origin used for post-deploy smoke checks, for example `https://app.example.com`

Required VPS staging files:

- `$VPS_DEPLOY_DIR/.env.staging`
- `$VPS_DEPLOY_DIR/docker-compose.yml`
- `$VPS_DEPLOY_DIR/docker-compose.staging.yml`
- `$VPS_DEPLOY_DIR/docker/Caddyfile`

The deploy workflow keeps the checked-in deployment assets current on the VPS by copying the repo versions on each run. The environment-specific `.env.staging` file remains operator-managed on the server.

The detailed VPS layout, first-boot preparation, immutable tag redeploy flow, rollback expectations, and post-deploy verification sequence are documented in [ops/staging-vps.md](/Users/ik/repos/openmirage/ops/staging-vps.md).

The manual production deploy workflow uses the same image, Compose, migration, and smoke-check sequence, but reads `.env.production` and is protected by the GitHub `production` Environment.

## Platform Prerequisite Verification

The canonical prerequisite check for the infrastructure-backed slices is:

```bash
pnpm verify:platform:prereqs
```

This command verifies:

- `pnpm` is available
- Docker and `docker compose` are available
- the Docker daemon is reachable
- ports `80`, `5432`, `9000`, and `9001` are free
- the Compose `postgres`, `minio`, and `minio-init` services can start
- the Compose-backed `postgres` container reaches a healthy state

If any prerequisite fails, the command stops immediately and prints corrective steps. No fallback non-Docker verification path is considered canonical for this slice.

## Docker-Backed Infra Verification

The canonical verification command for the full local stack is:

```bash
pnpm verify:platform:infra
```

This command:

- runs the prerequisite verification first
- starts the full Compose stack with image builds enabled
- verifies the homepage through Caddy
- verifies API health/readiness through Caddy
- exercises the storage smoke upload/list/delete flow through Caddy
- verifies collab health through Caddy
- verifies worker readiness and heartbeat through Caddy
- verifies the magic-link auth flow through Caddy
- verifies an authenticated websocket upgrade through Caddy
- verifies API, collab, and worker metrics through Caddy
- verifies `docker compose logs` exposes the expected platform activity
- verifies the diagnostics error route when `OPENMIRAGE_VERIFY_ERROR_ROUTE=true`
- verifies Postgres and MinIO on their published operator ports
- tears down the Compose stack when finished

This remains the base local smoke verifier used by the phase-closing acceptance command.

## Platform Acceptance

The canonical phase-closing acceptance command is:

```bash
pnpm verify:platform:acceptance
```

This command:

- prints the mandatory prerequisite policy before doing any work
- audits the current step 9 and step 13 acceptance assets
- runs the prerequisite gate
- runs the full local Caddy-routed smoke path with the diagnostics error route enabled
- checks for operator-managed staging and backup/restore evidence
- emits one final `pass`, `fail`, or `blocked` decision

For a full phase close, create `ops/platform-acceptance-evidence.json` from the example contract in [ops/platform-acceptance-evidence.example.json](/Users/ik/repos/openmirage/ops/platform-acceptance-evidence.example.json), then run:

```bash
OPENMIRAGE_ACCEPTANCE_EVIDENCE_FILE=ops/platform-acceptance-evidence.json \
pnpm verify:platform:acceptance
```

The operator runbook lives in [ops/platform-acceptance.md](/Users/ik/repos/openmirage/ops/platform-acceptance.md).

The staging evidence file must include explicit proof for the remaining operator-only closure items:

- fresh-VPS rehearsal proof:
  - `freshVpsPreparedFromRunbook=true`
  - `freshVpsVerifiedAt`
  - `freshVpsTarget`
- error-reporting proof:
  - `errorReportingSinkVerified=true`
  - `errorReportingVerifiedAt`
  - `errorReportingReference`

Without those fields, `pnpm verify:platform:acceptance` will report staging acceptance as `blocked` even if the existing deploy and smoke checks already passed.

Backend observability envs:

- `APP_VERSION`: release/version string included in logs and metrics
- `ENABLE_TEST_ERROR_ROUTES`: enables `GET /__diagnostics/error` for forced error verification
- `SENTRY_DSN`: enables Sentry only when set and `OPENMIRAGE_ENV` is `staging` or `production`
- `SENTRY_ENVIRONMENT`: optional override for Sentry environment tagging
- `SENTRY_RELEASE`: optional override for Sentry release tagging

For Docker Compose, these values are env-overridable for `api`, `collab`, and `worker`, so the acceptance flow can verify the gated diagnostics route locally and the error-reporting path in staging without editing `docker-compose.yml`.

Local defaults keep Sentry off. To verify the reporting path in a staging-like environment, set:

```bash
OPENMIRAGE_ENV=staging
ENABLE_TEST_ERROR_ROUTES=true
SENTRY_DSN=...
```

Then call one backend diagnostics route through Caddy, for example:

```bash
curl -i http://localhost/__diagnostics/error
```

Expected outcomes:

- the service logs a structured error with request/correlation context
- `/metrics` reflects the request activity
- the error appears in the configured Sentry project when enabled

## First-Boot Failure Handling

If `docker compose up --build --wait` fails:

1. Run `docker compose ps` and identify the service that is unhealthy, exited, or still restarting.
2. Inspect the failing service with `docker compose logs <service>`.
3. If the failure is in `db-migrate` or `db-seed`, fix the migration/bootstrap issue first and rerun the full stack command.
4. If the failure is in `api`, `collab`, `worker`, or `web`, confirm the env wiring still points at Compose service names instead of `localhost` for internal dependencies.
5. If the failure is an image pull or build problem, confirm Docker daemon access, registry reachability, and the referenced base image tags.
6. Re-run `pnpm verify:platform:prereqs` after fixing machine-level issues before retrying the stack boot.

## Success Criteria For This Slice

- a new machine can pass the prerequisite gate and boot the full runtime slice with one Docker Compose command
- Caddy is the single local browser entrypoint
- the web shell confirms API, collab, and worker reachability through Caddy
- logs identify service, environment, version, and request/correlation IDs clearly enough for local debugging
- `/metrics` is queryable on `api`, `collab`, and `worker`
- one forced backend test error can be routed to Sentry when explicitly enabled
- `readyz` indicates live dependency readiness for `api` and `worker`
