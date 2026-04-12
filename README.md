# OpenMirage

OpenMirage is a browser-based, self-hostable collaborative UI design workspace for startup product teams. This repository currently implements the runtime service scaffolding slice: bootable `web`, `api`, `collab`, and `worker` shells with shared env, health, and logging contracts.

## Current Slice

This slice establishes the initial runtime contract for the platform services while keeping the product itself empty.

Included now:

- independently bootable `web`, `api`, `collab`, and `worker` dev services
- shared env parsing and validation in `@openmirage/config-env`
- structured service logging, metrics, and error-reporting bootstrap in `@openmirage/observability`
- API health and readiness endpoints
- collab health endpoint plus websocket mount path
- worker heartbeat and HTTP status surface
- a React/Vite landing shell that probes API and collab reachability
- Prometheus-compatible `/metrics` endpoints for `api`, `collab`, and `worker`
- env-gated forced test error routes and Sentry integration for backend services

Not included yet:

- editor, canvas, files/pages/projects, comments, or other product routes
- real magic-link delivery, session persistence, or database-backed auth flows
- collab document persistence or page authorization
- worker jobs, exports, or cleanup processing
- Docker Compose, Caddy routing, staging deployment, backup/restore verification

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
pnpm dev
pnpm build
pnpm lint
pnpm format
pnpm format:check
pnpm test
pnpm typecheck
pnpm docker:build
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
- api metrics: `http://localhost:4000/metrics`
- api auth entrypoint: `http://localhost:4000/auth/entry`
- collab health: `http://localhost:4100/healthz`
- collab metrics: `http://localhost:4100/metrics`
- collab websocket mount: `ws://localhost:4100/collab`
- worker health: `http://localhost:4200/healthz`
- worker metrics: `http://localhost:4200/metrics`
- worker status: `http://localhost:4200/status`

## Tooling Conventions

- Workspace `tsconfig.json` files inherit from `@openmirage/config-typescript`, not bespoke root target configs.
- Cross-workspace imports must use workspace package names such as `@openmirage/types`.
- Relative imports are allowed only within a single workspace.
- Repo formatting is controlled by the root Prettier config and `pnpm format`.

## Environment Files

Each app includes an `.env.example` with the variables needed for this slice. Node services will load `.env` automatically if present. The web shell uses Vite `VITE_*` public variables.

Backend observability envs:

- `APP_VERSION`: release/version string included in logs and metrics
- `ENABLE_TEST_ERROR_ROUTES`: enables `GET /__diagnostics/error` for forced error verification
- `SENTRY_DSN`: enables Sentry only when set and `OPENMIRAGE_ENV` is `staging` or `production`
- `SENTRY_ENVIRONMENT`: optional override for Sentry environment tagging
- `SENTRY_RELEASE`: optional override for Sentry release tagging

Local defaults keep Sentry off. To verify the reporting path in a staging-like environment, set:

```bash
OPENMIRAGE_ENV=staging
ENABLE_TEST_ERROR_ROUTES=true
SENTRY_DSN=...
```

Then call one backend diagnostics route, for example:

```bash
curl -i http://localhost:4000/__diagnostics/error
```

Expected outcomes:

- the service logs a structured error with request/correlation context
- `/metrics` reflects the request activity
- the error appears in the configured Sentry project when enabled

## Success Criteria For This Slice

- each runtime service boots independently in dev mode
- `pnpm dev` starts the full runtime slice from the repo root
- the web shell confirms API and collab reachability
- logs identify service, environment, version, and request/correlation IDs clearly enough for local debugging
- `/metrics` is queryable on `api`, `collab`, and `worker`
- one forced backend test error can be routed to Sentry when explicitly enabled
