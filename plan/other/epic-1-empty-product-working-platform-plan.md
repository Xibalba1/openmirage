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
  - From a clean checkout, `pnpm install` exits with code `0` without manual manifest edits.
  - `pnpm build`, `pnpm lint`, and `pnpm typecheck` each exit with code `0` at the repo root.
  - The root `README.md` explicitly lists every top-level app and shared package category expected for this phase.

### 2. Add shared TypeScript, linting, formatting, and editor tooling

- Create shared TS configs for browser apps, Node services, and internal libraries.
- Standardize ESLint, Prettier, ignore files, and optional commit hooks/check scripts.
- Add import/path conventions and a strict-enough TS baseline to prevent early drift without blocking scaffolding.
- Success conditions:
  - Every workspace `tsconfig.json` extends a shared config package rather than defining a standalone compiler baseline.
  - `pnpm lint` and `pnpm typecheck` both exit with code `0` on the empty scaffolding.
  - One repo-level formatting command exists, is documented, and `pnpm format:check` exits with code `0` immediately after `pnpm format`.

### 3. Scaffold the runtime services with health contracts

- Stand up empty but bootable service shells for web, API, collab, and worker.
- Implement basic health/readiness endpoints and a shared env/config package.
- Wire the frontend shell to talk to the API and expose environment-driven service URLs.
- Keep product routes empty; only include a landing shell, auth entrypoint, and service-status plumbing.
- Success conditions:
  - `pnpm --filter @openmirage/web dev`, `pnpm --filter @openmirage/api dev`, `pnpm --filter @openmirage/collab dev`, and `pnpm --filter @openmirage/worker dev` each start successfully on their own.
  - The web shell renders in a browser and displays successful reachability checks for the API and collab services using configured runtime URLs.
  - API, collab, and worker logs each include the service name and environment on startup and on at least one handled request or event.

### 4. Define the database baseline and migration workflow

- Create the relational schema foundation for users, workspaces, memberships, projects, files, pages, sessions/auth artifacts, assets, comments, share links, and export jobs.
- Keep page content out of Postgres; only include page metadata/index tables per the docs.
- Choose one migration tool and standardize commands for create/apply/status/reset.
- Add a minimal seed/bootstrap path that creates one workspace and one test user flow for local verification.
- Success conditions:
  - Against a blank Postgres instance, `pnpm db:migrate:up` exits with code `0` without manual SQL execution.
  - The applied schema contains tables for users, workspaces, memberships, projects, files, pages, sessions, magic-link artifacts, assets, comments, share links, and export jobs, and contains no relational node-content tables for page scene graph data.
  - After `pnpm db:reset` and `pnpm db:seed`, the documented bootstrap workspace, project, file, page, and test-user records exist and can be queried successfully.

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
  - In local development, posting to the magic-link request endpoint returns a valid dev delivery artifact or logged-link fallback for a known test user.
  - Session create, validate, refresh, and logout flows each return the expected HTTP status and cookie behavior both through Caddy and by calling the API service directly.
  - A collab websocket upgrade attempt without a valid session cookie is rejected with `401`, and an authenticated attempt for an allowed workspace succeeds.

### 6. Add the storage abstraction and local object storage

- Implement a storage package with a provider interface and an initial S3-compatible adapter.
- Run MinIO in local Compose and configure staging for an S3-compatible backend.
- Support a local filesystem fallback only behind the same interface, not as a separate code path scattered across services.
- Add asset bucket/bootstrap helpers and health checks.
- Success conditions:
  - With the local stack running, the configured bucket is created automatically and the storage health check reports `ok: true`.
  - The API storage smoke path can upload an object, list it, and delete it successfully in one run using the shared storage abstraction.
  - Switching between `minio`, `s3-compatible`, and `local` storage providers requires env changes only and no application code changes.

### 7. Add Dockerfiles and Compose for local one-command boot

- Create production-oriented Dockerfiles for each service with consistent base images, build caching, and runtime env injection.
- Create a local `docker-compose` stack for web, API, collab, worker, Postgres, MinIO, and Caddy.
- Make one documented command the default local bootstrap path, including dependency install, service startup, migrations, and seed/bootstrap where appropriate.
- Success conditions:
  - On a machine that satisfies the documented prerequisites, the documented one-command bootstrap path completes successfully from the repo root.
  - Browser and HTTP access to the stack works through Caddy, and bypassing Caddy is not required for any documented local verification flow.
  - Web, API, collab websocket, worker, Postgres, and MinIO are each reachable on their documented local hostnames or ports after the stack boots.

### 8. Add Caddy and staging-facing runtime wiring

- Create a Caddy config for local and staging that handles:
  - TLS in staging
  - API reverse proxying
  - websocket upgrades for Hocuspocus
  - static frontend serving or frontend proxying, depending on chosen container layout
- Normalize forwarded headers, secure cookies, and origin handling so auth/session behavior matches staging reality early.
- Success conditions:
  - Local verification of `/`, `/healthz`, `/readyz`, `/metrics`, `/collab/healthz`, and websocket upgrade at `/collab` succeeds through Caddy.
  - In staging, the public domain routes web, API, and collab websocket traffic to the correct services without path rewriting bugs.
  - Session cookies set behind the reverse proxy remain valid across magic-link consume, session read, refresh, and logout flows.

### 9. Add CI for validation and deploy packaging

- Build CI in layers:
  - install/cache
  - lint/typecheck/test
  - Docker image build
  - migration safety checks
  - staging deploy trigger on the protected branch/environment
- Keep CI lean; it should prove reproducibility of the monorepo and deployment artifacts, not add heavy platform machinery.
- Success conditions:
  - Every pull request or mainline change triggers a CI workflow that runs the documented static validation commands and fails the run on any non-zero exit code.
  - CI builds the same checked-in Docker images used by local Compose and staging deploys.
  - Staging deployment is initiated by one documented workflow using environment-scoped secrets, with no required manual image build step on the VPS.

### 10. Define staging deployment procedure for the VPS

- Standardize the VPS layout:
  - Compose project directory
  - env/secrets location
  - persistent volumes for Postgres and local state
  - release/update flow
- Prefer immutable image deploys with Compose pull/up rather than building ad hoc on the server.
- Include migration execution, rollback expectations, and post-deploy verification steps.
- Success conditions:
  - Following the written procedure on a fresh VPS produces a running staging stack without relying on undocumented manual steps.
  - A second staging deploy using the same procedure completes successfully without changing the procedure itself.
  - Post-deploy verification confirms successful connectivity for web, API, collab, database, and storage using the documented checks.

### 11. Add logging, metrics, and error-reporting basics

- Standardize structured logs across API, collab, and worker with correlation/request IDs where applicable.
- Expose lightweight metrics endpoints or Prometheus-compatible counters for basic service health, request rates, websocket connection counts, queue/job counts, and migration/app version info.
- Add one error-reporting path suitable for MVP operations, with clear environment gating.
- Do not add heavyweight observability infrastructure beyond what helps an operator debug the VPS deployment.
- Success conditions:
  - API, collab, and worker logs are readable via `docker compose logs` and include structured fields for service identity and request or event context.
  - Health and metrics endpoints for the main services return successful responses locally and in staging.
  - Triggering one forced test error in an environment with error reporting enabled produces a visible event in the configured error-reporting sink.

### 12. Add backup, restore, and recovery runbooks

- Implement Postgres backup automation first, because that is the primary recovery requirement in the docs.
- Define backup scope for:
  - Postgres dumps or base backups
  - MinIO/local asset data if self-hosted
  - deployment config needed to recreate the stack
- Write and execute a one-time restore drill into a disposable environment.
- Record the exact commands, expected artifacts, and verification checks.
- Success conditions:
  - At least one backup artifact set exists and contains the documented manifest, checksum data, Postgres backup, and any required self-hosted asset/config artifacts.
  - A restore drill into a clean target environment completes successfully and the documented post-restore app checks pass.
  - The recovery runbook contains enough exact commands and prerequisites for an operator to reprovision the stack without consulting shell history.

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
  - Every checklist item above passes in both local and staging verification without mid-run env edits or ad hoc manual fixes.
  - Any remaining open issues are explicitly classified as product-scope gaps rather than platform or deployment blockers.
  - The acceptance evidence and runbooks are complete enough that the next Epic can begin product implementation without additional platform foundation work.

## Step Dependencies and Parallelization

Treat each numbered step above as atomic.

- These steps must be done one at a time:
  - `1 -> 2 -> 3`
  - `10 -> 12 -> 13`
- After `3` is complete, these steps can proceed in parallel:
  - `4`
  - `6`
  - `11`
- After `4` is complete, `5` can proceed.
- After `3`, `4`, and `6` are complete, `7` can proceed.
- After `5` and `7` are complete, `8` can proceed.
- After `7` is complete, `9` can proceed.
- After `8` and `9` are complete, `10` can proceed.

In compact form, the dependency graph is:

- `1 -> 2 -> 3`
- `3 -> 4`
- `3 -> 6`
- `3 -> 11`
- `4 -> 5`
- `3 + 4 + 6 -> 7`
- `5 + 7 -> 8`
- `7 -> 9`
- `8 + 9 -> 10`
- `10 -> 12`
- `12 -> 13`

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
