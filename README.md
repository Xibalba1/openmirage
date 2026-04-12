# OpenMirage

OpenMirage is a browser-based, self-hostable collaborative UI design workspace for startup product teams. This repository currently implements the Step 2 platform slice: the monorepo layout, shared config baselines, and repo-wide developer tooling.

## Current Slice

This slice establishes the repository contract and shared developer-tooling contract only.

Included now:

- `pnpm` workspaces and Turborepo orchestration
- architecture-aligned apps and shared packages
- shared TypeScript, env, lint, test, and formatting baseline packages
- repo-wide ESLint, Prettier, and editor defaults
- placeholder source/build contracts for every workspace

Not included yet:

- real Fastify, Hocuspocus, worker, database, auth, storage, Docker, Caddy, or deployment behavior
- product features, editor runtime, or domain workflows

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

## Tooling Conventions

- Workspace `tsconfig.json` files inherit from `@openmirage/config-typescript`, not bespoke root target configs.
- Cross-workspace imports must use workspace package names such as `@openmirage/types`.
- Relative imports are allowed only within a single workspace.
- Repo formatting is controlled by the root Prettier config and `pnpm format`.

## Success Criteria For This Slice

- a clean checkout installs as a workspace successfully
- Turbo resolves every declared app and package
- root commands are centralized and documented
- the repo remains product-empty but is ready for the next platform slice
