# Empty Product, Working Platform Plan

Last updated: 2026-04-12

## Summary

Build the platform in modular slices so each slice leaves the repo in a usable state and can be verified independently. The implementation baseline is `pnpm` workspaces with Turborepo, Fastify for the API, Hocuspocus for collaboration, PostgreSQL for relational data, MinIO locally with S3-compatible storage in staging, Caddy as the edge proxy, Docker Compose for local and VPS runtime, and magic-link auth with server-side sessions.

The phase is complete when:

- a new developer can boot the full stack locally with one command,
- the same artifacts deploy to the staging VPS through a documented CI path,
- Postgres backup and restore have been run once and verified,
- the app is still product-empty but all platform services, wiring, and observability foundations work.

## Public Interfaces and Baselines

- Monorepo apps/packages:
  - `apps/web`: React + Vite frontend shell
  - `apps/api`: Fastify HTTP API
  - `apps/collab`: Hocuspocus realtime service
  - `apps/worker`: bounded background worker shell
  - `packages/config-*`: shared TypeScript, ESLint, Prettier, env, and test config
  - `packages/db`: schema, migrations, seed/dev bootstrap helpers
  - `packages/auth`: session, token, and auth helpers
  - `packages/storage`: blob storage abstraction with MinIO/S3 and local fallback interface
  - `packages/observability`: logging, metrics, error-reporting bootstrap
  - `packages/types`: shared domain and service contracts needed before product code
- Shared config contracts:
  - one root TypeScript baseline with per-target extensions for browser, Node, and library packages
  - one env-loading pattern with validation and per-service `.env.example`
  - one workspace task model for `dev`, `build`, `test`, `lint`, `typecheck`, `docker:build`
- Initial runtime contracts:
  - API health/readiness endpoints
  - collab health endpoint plus websocket mount path
  - worker heartbeat/status signal
  - Caddy routes for web, API, and websocket upgrade handling
  - storage adapter interface exposing upload, download URL resolution, delete, and health check

## Step-by-Step Plan

### 1. Establish the monorepo and task graph

- Create the `pnpm` workspace layout and Turborepo pipeline with app/package boundaries that match the architecture docs.
- Add root scripts so `pnpm dev` and `pnpm build` operate through Turbo and remain the primary entrypoints.
- Define a minimal package ownership rule:
  - apps depend on shared packages
  - shared packages cannot depend on apps
  - infra config is centralized, not duplicated per app
- Success conditions:
  - workspace install succeeds from a clean checkout
  - `pnpm build`, `pnpm lint`, and `pnpm typecheck` resolve every workspace package
  - app/package boundaries are documented in the root README

### 2. Add shared TypeScript, linting, formatting, and editor tooling

- Create shared TS configs for browser apps, Node services, and internal libraries.
- Standardize ESLint, Prettier, ignore files, and optional commit hooks/check scripts.
- Add import/path conventions and a strict-enough TS baseline to prevent early drift without blocking scaffolding.
- Success conditions:
  - all packages inherit from shared config rather than bespoke local config
  - lint/typecheck pass on the empty scaffolding
  - one formatting command rewrites the whole repo consistently

### 3. Scaffold the runtime services with health contracts

- Stand up empty but bootable service shells for web, API, collab, and worker.
- Implement basic health/readiness endpoints and a shared env/config package.
- Wire the frontend shell to talk to the API and expose environment-driven service URLs.
- Keep product routes empty; only include a landing shell, auth entrypoint, and service-status plumbing.
- Success conditions:
  - each service starts independently in dev mode
  - the frontend can load and confirm API/collab reachability
  - logs clearly identify the service, environment, and request or event context

### 4. Define the database baseline and migration workflow

- Create the relational schema foundation for users, workspaces, memberships, projects, files, pages, sessions/auth artifacts, assets, comments, share links, and export jobs.
- Keep page content out of Postgres; only include page metadata/index tables per the docs.
- Choose one migration tool and standardize commands for create/apply/status/reset.
- Add a minimal seed/bootstrap path that creates one workspace and one test user flow for local verification.
- Success conditions:
  - migrations run from a blank Postgres instance without manual SQL
  - schema reflects the documented product-domain boundaries
  - a fresh local stack can bootstrap to a known initial state

### 5. Build the auth and session foundation

- Implement magic-link auth as the initial entry path.
- Use server-managed sessions and cookies suitable for both local Compose and Caddy-fronted staging.
- Include the minimum auth domain needed now:
  - user identity
  - session lifecycle
  - workspace membership lookup
  - route protection primitives for API and collab connection checks
- Defer invites and full share-link UX; only add the underlying session and membership enforcement needed to support future product work.
- Success conditions:
  - a user can request a magic link in local dev using a dev mail capture path or logged-link fallback
  - session creation, refresh/validation, and logout work through Caddy and direct dev mode
  - collab connection authorization can reject unauthenticated access

### 6. Add the storage abstraction and local object storage

- Implement a storage package with a provider interface and an initial S3-compatible adapter.
- Run MinIO in local Compose and configure staging for an S3-compatible backend.
- Support a local filesystem fallback only behind the same interface, not as a separate code path scattered across services.
- Add asset bucket/bootstrap helpers and health checks.
- Success conditions:
  - local stack can create and reach the configured bucket automatically
  - API can perform a basic upload/list/delete smoke path through the abstraction
  - staging config can switch providers without application code changes

### 7. Add Dockerfiles and Compose for local one-command boot

- Create production-oriented Dockerfiles for each service with consistent base images, build caching, and runtime env injection.
- Create a local `docker-compose` stack for web, API, collab, worker, Postgres, MinIO, and Caddy.
- Make one documented command the default local bootstrap path, including dependency install, service startup, migrations, and seed/bootstrap where appropriate.
- Success conditions:
  - a new machine can boot the full stack with one command from the repo root
  - Caddy is the single local entrypoint
  - API, collab websocket, Postgres, and MinIO are reachable through the expected hostnames/ports

### 8. Add Caddy and staging-facing runtime wiring

- Create a Caddy config for local and staging that handles:
  - TLS in staging
  - API reverse proxying
  - websocket upgrades for Hocuspocus
  - static frontend serving or frontend proxying, depending on chosen container layout
- Normalize forwarded headers, secure cookies, and origin handling so auth/session behavior matches staging reality early.
- Success conditions:
  - local routing works through Caddy only
  - staging domain routes web, API, and websocket traffic correctly
  - cookie/session behavior is stable behind the reverse proxy

### 9. Add CI for validation and deploy packaging

- Build CI in layers:
  - install/cache
  - lint/typecheck/test
  - Docker image build
  - migration safety checks
  - staging deploy trigger on the protected branch/environment
- Keep CI lean; it should prove reproducibility of the monorepo and deployment artifacts, not add heavy platform machinery.
- Success conditions:
  - every PR or mainline change runs static validation
  - CI can build the same images used locally and in staging
  - staging deploy is one pipeline action with environment-specific secrets, not a manual snowflake process

### 10. Define staging deployment procedure for the VPS

- Standardize the VPS layout:
  - Compose project directory
  - env/secrets location
  - persistent volumes for Postgres and local state
  - release/update flow
- Prefer immutable image deploys with Compose pull/up rather than building ad hoc on the server.
- Include migration execution, rollback expectations, and post-deploy verification steps.
- Success conditions:
  - a fresh VPS can be provisioned from the written procedure
  - staging update is repeatable and does not require undocumented shell history
  - post-deploy checks confirm web, API, collab, database, and storage connectivity

### 11. Add logging, metrics, and error-reporting basics

- Standardize structured logs across API, collab, and worker with correlation/request IDs where applicable.
- Expose lightweight metrics endpoints or Prometheus-compatible counters for basic service health, request rates, websocket connection counts, queue/job counts, and migration/app version info.
- Add one error-reporting path suitable for MVP operations, with clear environment gating.
- Do not add heavyweight observability infrastructure beyond what helps an operator debug the VPS deployment.
- Success conditions:
  - service logs are readable through `docker compose logs`
  - metrics and health endpoints can be queried locally and in staging
  - one forced test error is visible in the configured error-reporting sink

### 12. Add backup, restore, and recovery runbooks

- Implement Postgres backup automation first, because that is the primary recovery requirement in the docs.
- Define backup scope for:
  - Postgres dumps or base backups
  - MinIO/local asset data if self-hosted
  - deployment config needed to recreate the stack
- Write and execute a one-time restore drill into a disposable environment.
- Record the exact commands, expected artifacts, and verification checks.
- Success conditions:
  - at least one successful backup artifact exists from staging or a staging-equivalent environment
  - restore has been performed once into a clean target and basic app checks passed afterward
  - the recovery runbook is complete enough to reprovision a failed VPS

### 13. Close the phase with an “empty product, working platform” acceptance pass

- Run an end-to-end smoke checklist against local and staging:
  - one-command local boot
  - migration/bootstrap succeeds
  - magic-link login works
  - authenticated API health and protected route checks work
  - collab service authorizes and upgrades websocket connections
  - asset storage smoke path works
  - worker starts and reports healthy
  - logs, metrics, and error reporting are visible
  - backup artifact exists and restore has been validated once
- Success conditions:
  - every checklist item passes without hand-editing the environment mid-run
  - remaining gaps are product features, not platform blockers
  - the repo is ready for feature implementation on top of stable platform seams

## Test Plan

- Static checks:
  - workspace install, lint, format check, typecheck, build
- Service smoke tests:
  - health/readiness for web, API, collab, worker, Postgres, MinIO
  - websocket upgrade test through Caddy
  - migration apply/reset/bootstrap test
- Auth tests:
  - magic-link request/consume flow
  - session cookie validation behind proxy
  - unauthorized access rejection for protected API and collab routes
- Storage tests:
  - bucket bootstrap, upload, fetch URL resolution, delete
- Deployment tests:
  - CI image build
  - staging Compose deploy from built images
  - post-deploy smoke verification
- Recovery tests:
  - Postgres backup creation
  - restore into clean environment
  - application boots successfully against restored data

## Assumptions and Defaults

- Monorepo baseline is `pnpm` + Turborepo.
- Auth baseline is magic-link login with server-side sessions and cookie auth.
- Local object storage uses MinIO; staging uses an S3-compatible provider through the same abstraction.
- Docker Compose remains the local and staging orchestration model for this phase.
- Observability stays intentionally lightweight: structured logs, basic metrics, and one error-reporting path, without a full monitoring stack.
- The worker is scaffolded now as a bounded process shell even if export features remain mostly empty, because deployment, isolation, and recovery depend on that boundary existing early.
