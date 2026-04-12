# OpenMirage

OpenMirage is a browser-based, self-hostable collaborative UI design workspace for startup product teams. This repository currently implements the runtime service scaffolding slice: bootable `web`, `api`, `collab`, and `worker` shells with shared env, health, and logging contracts.

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
- api auth entrypoint: `http://localhost:4000/auth/entry`
- collab health: `http://localhost:4100/healthz`
- collab websocket mount: `ws://localhost:4100/collab`
- worker health: `http://localhost:4200/healthz`
- worker status: `http://localhost:4200/status`

## Tooling Conventions

- Workspace `tsconfig.json` files inherit from `@openmirage/config-typescript`, not bespoke root target configs.
- Cross-workspace imports must use workspace package names such as `@openmirage/types`.
- Relative imports are allowed only within a single workspace.
- Repo formatting is controlled by the root Prettier config and `pnpm format`.

## Environment Files

Each app includes an `.env.example` with the variables needed for this slice. Node services will load `.env` automatically if present. The web shell uses Vite `VITE_*` public variables.

## Success Criteria For This Slice

- each runtime service boots independently in dev mode
- `pnpm dev` starts the full runtime slice from the repo root
- the web shell confirms API and collab reachability
- logs identify service and environment clearly enough for local debugging
