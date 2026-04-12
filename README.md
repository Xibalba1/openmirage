# OpenMirage

OpenMirage is a browser-based, self-hostable collaborative UI design workspace for startup product teams. This repository currently implements the runtime service scaffolding slice plus the first storage slice: bootable `web`, `api`, `collab`, and `worker` shells with shared env, health, logging, and pluggable blob storage contracts.

## Current Slice

This slice establishes the initial runtime contract for the platform services while keeping the product itself empty.

Included now:

- independently bootable `web`, `api`, `collab`, and `worker` dev services
- shared env parsing and validation in `@openmirage/config-env`
- structured service logging in `@openmirage/observability`
- API health and readiness endpoints
- collab health endpoint plus websocket mount path
- worker heartbeat and HTTP status surface
- a React/Vite landing shell that probes API and collab reachability
- a provider-backed storage abstraction with `minio`, generic `s3-compatible`, and `local` adapters
- local Docker Compose services for PostgreSQL and MinIO with automatic bucket bootstrap
- API storage smoke endpoints for upload, list, and delete verification through the abstraction

Not included yet:

- editor, canvas, files/pages/projects, comments, or other product routes
- real magic-link delivery, session persistence, or database-backed auth flows
- collab document persistence or page authorization
- worker jobs, exports, or cleanup processing
- Caddy routing, staging deployment, backup/restore verification

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
- `packages/db`: database contract placeholders
- `packages/storage`: blob storage abstraction placeholders
- `packages/observability`: logging and health helper placeholders
- `packages/config-*`: shared TypeScript, ESLint, Prettier, env, and test baselines

## Canonical Commands

All root commands run through Turborepo and are the primary entrypoints for this repository.

```bash
pnpm install
pnpm infra:up
pnpm dev
pnpm build
pnpm lint
pnpm format
pnpm format:check
pnpm test
pnpm typecheck
pnpm docker:build
```

Stop local infrastructure when you are done:

```bash
pnpm infra:down
```

Run services independently when you want to verify one slice surface at a time:

```bash
pnpm --filter @openmirage/api dev
pnpm --filter @openmirage/collab dev
pnpm --filter @openmirage/worker dev
pnpm --filter @openmirage/web dev
```

Key endpoints:

- web: `http://localhost:3000`
- api health: `http://localhost:4000/healthz`
- api readiness: `http://localhost:4000/readyz`
- api auth entrypoint: `http://localhost:4000/auth/entry`
- collab health: `http://localhost:4100/healthz`
- collab websocket mount: `ws://localhost:4100/collab`
- worker health: `http://localhost:4200/healthz`
- worker status: `http://localhost:4200/status`
- storage smoke list: `http://localhost:4000/internal/storage/smoke`

## Tooling Conventions

- Workspace `tsconfig.json` files inherit from `@openmirage/config-typescript`, not bespoke root target configs.
- Cross-workspace imports must use workspace package names such as `@openmirage/types`.
- Relative imports are allowed only within a single workspace.
- Repo formatting is controlled by the root Prettier config and `pnpm format`.

## Environment Files

Each app includes an `.env.example` with the variables needed for this slice. Node services will load `.env` automatically if present. The web shell uses Vite `VITE_*` public variables.

The storage-bearing services share the same storage env contract:

- `STORAGE_PROVIDER=minio|s3-compatible|local`
- `STORAGE_BUCKET=openmirage-assets`
- `STORAGE_LOCAL_ROOT=.openmirage/storage`
- `STORAGE_S3_ENDPOINT=http://127.0.0.1:9000`
- `STORAGE_S3_REGION=us-east-1`
- `STORAGE_S3_ACCESS_KEY_ID=openmirage`
- `STORAGE_S3_SECRET_ACCESS_KEY=openmirage123`
- `STORAGE_S3_FORCE_PATH_STYLE=true`
- `STORAGE_PUBLIC_BASE_URL=` optional public base URL for direct object resolution

For local development, the default `minio` settings match `docker-compose.yml`. For staging, switch to `STORAGE_PROVIDER=s3-compatible` and point the same variables at the target S3-compatible backend. No application code changes should be required.

## Storage Smoke Check

Start infrastructure and services:

```bash
pnpm infra:up
pnpm dev
```

Then verify the storage slice through the API:

```bash
curl http://localhost:4000/internal/storage/smoke
curl -X POST http://localhost:4000/internal/storage/smoke \
  -H 'content-type: application/json' \
  -d '{"key":"smoke/hello.txt","contentType":"text/plain","bodyBase64":"aGVsbG8="}'
curl http://localhost:4000/internal/storage/smoke
curl -X DELETE 'http://localhost:4000/internal/storage/smoke?key=smoke/hello.txt'
```

Expected result:

- `pnpm infra:up` brings up PostgreSQL, MinIO, and bucket bootstrap
- API `/healthz` and `/readyz` report the configured storage provider and bucket
- `POST` uploads the object and returns a download URL
- `GET` lists the uploaded object
- `DELETE` removes it without any provider-specific API code path

## Success Criteria For This Slice

- each runtime service boots independently in dev mode
- `pnpm dev` starts the full runtime slice from the repo root
- the web shell confirms API and collab reachability
- logs identify service and environment clearly enough for local debugging
