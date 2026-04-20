# OpenMirage

## What OpenMirage Is

OpenMirage is a browser-based, self-hostable collaborative UI design workspace for startup product teams.

The project is intentionally narrower than a full design suite. The goal is to provide more structure than a whiteboard, less overhead than heavyweight design tools, realtime collaboration, and enough inspect/export support for lightweight developer handoff.

## Current Status

OpenMirage currently ships as a TypeScript monorepo with four deployable services:

- `web`: the React/Vite browser client
- `api`: the Fastify application API
- `collab`: the realtime collaboration service
- `worker`: background export and derived-artifact processing

The repo includes:

- local Docker Compose support with Caddy, Postgres, and MinIO
- magic-link authentication and server-backed sessions
- workspace, project, file, and page flows
- page-scoped realtime collaboration
- comments, share links, asset upload, and export jobs
- staging and production deployment workflows for a single-VPS setup

OpenMirage is still in active MVP development. It is not aiming for full Figma parity.

## Features Available Today

- Mid-fidelity editor primitives for frames, shapes, text, and images
- Multi-page files with browser-owned editing and inspect data
- Page-scoped collaborative editing and participant awareness
- Comments stored outside the collaborative document
- Read-only share links
- Asset upload and delivery through a pluggable storage layer
- Background export jobs for downloadable artifacts
- Health, readiness, metrics, and smoke-verification tooling

Notable non-goals for the current MVP:

- advanced prototyping and animations
- plugin ecosystem
- enterprise administration and SSO
- branching workflows
- full Figma-parity feature coverage

## Getting Started

### Requirements

- Node.js `20.15.0` or newer
- `pnpm` `9.15.0` or newer
- Docker with `docker compose`

If `pnpm` is not installed globally, enable it with `corepack enable`.

### Quick Start

```bash
pnpm install
pnpm compose:up
```

Then open [http://localhost](http://localhost).

To stop the local stack:

```bash
pnpm compose:down
```

### Useful Commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm typecheck
pnpm test:browser
pnpm verify:platform:infra
pnpm verify:platform:acceptance
```

Environment examples live alongside each app in `.env.example` files. For staging, start from [`/.env.staging.example`](./.env.staging.example).

## Repository Layout

- `apps/web`: browser client, editor UI, and frontend tests
- `apps/api`: auth, metadata, comments, sharing, asset, and export APIs
- `apps/collab`: websocket-based page collaboration and presence
- `apps/worker`: export and background processing
- `packages/auth`: shared auth and session helpers
- `packages/db`: Postgres schema, migrations, and seed/reset helpers
- `packages/storage`: storage abstraction for `minio`, `s3-compatible`, and `local`
- `packages/observability`: logging, metrics, health, and error-reporting helpers
- `packages/types`: shared domain and service contracts

## Architecture

OpenMirage follows a small-service MVP architecture designed for self-hosting on a single VPS:

- The browser owns editor interaction, rendering, and local UI state.
- The API owns authentication, sessions, metadata, comments, share links, asset metadata, and export job creation.
- The collaboration service owns page-scoped realtime synchronization and presence transport.
- Postgres stores relational application data such as workspaces, files, pages, comments, sessions, share links, and export jobs.
- Blob storage stores binary assets and export artifacts through a provider-backed abstraction.
- The worker handles bounded background jobs such as exports and derived artifacts.
- Caddy is the browser-facing entrypoint for local and VPS deployments.

## Documentation

- [Platform verification runbook](./ops/platform-acceptance.md)
- [Domain and VPS operator runbook](./ops/domain-operator-runbook.md)
- [Staging VPS deployment runbook](./ops/staging-vps.md)
- [Backup, restore, and recovery runbook](./ops/backup-restore-recovery.md)
- [MVP thesis and boundary](./plan/mvp/1-thesis-and-mvp-boundary.md)
- [Architecture overview](./plan/mvp/3-architecture-overview.md)
