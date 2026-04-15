# Empty Product, Working Platform Evaluation

Evaluated against [plan/other/empty-product-working-platform-plan.md](/Users/ik/repos/openmirage/plan/other/empty-product-working-platform-plan.md:1) on 2026-04-14.

## Overall Verdict

`blocked on evidence`

The repo-managed platform work is substantially in place and the canonical local acceptance path currently passes:

- `pnpm verify:platform:prereqs`: pass
- `pnpm lint`: pass
- `pnpm typecheck`: pass
- `pnpm test`: pass
- `pnpm verify:platform:acceptance`: `BLOCKED`

The plan is not fully complete because the acceptance contract in [ops/platform-acceptance-evidence.json](/Users/ik/repos/openmirage/ops/platform-acceptance-evidence.json:1) still has empty staging and backup/restore fields. Under the repo's own phase-closure rules, that means the phase is blocked rather than complete.

## Step Evaluation Matrix

| Step | Requirement | Success Conditions | Repo Artifacts | Proof Source | Status | What Is Still Needed |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Establish monorepo and task graph | Clean install works; `build`/`lint`/`typecheck` resolve workspaces; boundaries documented | [package.json](/Users/ik/repos/openmirage/package.json:1), [pnpm-workspace.yaml](/Users/ik/repos/openmirage/pnpm-workspace.yaml:1), [turbo.json](/Users/ik/repos/openmirage/turbo.json:1), [README.md](/Users/ik/repos/openmirage/README.md:1) | `pnpm lint`, `pnpm typecheck`, workspace manifests, README layout/command docs | Complete | Nothing repo-managed is missing for this step |
| 2 | Shared TS, lint, formatting, editor tooling | Shared config inheritance; lint/typecheck pass; one formatting command | [tsconfig.base.json](/Users/ik/repos/openmirage/tsconfig.base.json:1), [tsconfig.node.json](/Users/ik/repos/openmirage/tsconfig.node.json:1), [tsconfig.browser.json](/Users/ik/repos/openmirage/tsconfig.browser.json:1), [eslint.config.mjs](/Users/ik/repos/openmirage/eslint.config.mjs:1), [prettier.config.mjs](/Users/ik/repos/openmirage/prettier.config.mjs:1), workspace `tsconfig.json` files | Shared config inheritance in all workspaces; `pnpm lint`; `pnpm typecheck`; `pnpm format` script | Complete | Nothing repo-managed is missing for this step |
| 3 | Scaffold runtime services with health contracts | Services boot independently; frontend confirms API/collab reachability; logs identify service/environment/context | `apps/web`, `apps/api`, `apps/collab`, `apps/worker`, `packages/config-env`, `packages/observability` | [apps/web/src/App.tsx](/Users/ik/repos/openmirage/apps/web/src/App.tsx:1), service entrypoints, `pnpm verify:platform:acceptance` local pass | Complete | Nothing repo-managed is missing for this step |
| 4 | Database baseline and migration workflow | Migrations work from blank DB; schema matches docs; fresh stack bootstraps known state | [packages/db/migrations/001_initial_schema.cjs](/Users/ik/repos/openmirage/packages/db/migrations/001_initial_schema.cjs:1), [packages/db/package.json](/Users/ik/repos/openmirage/packages/db/package.json:1), [packages/db/src/seed.ts](/Users/ik/repos/openmirage/packages/db/src/seed.ts:1), CI migration job | Domain tables and metadata boundaries in migration; seed/bootstrap helper; [`.github/workflows/ci.yml`](/Users/ik/repos/openmirage/.github/workflows/ci.yml:1) migration-safety job; local acceptance pass | Complete | Nothing repo-managed is missing for this step |
| 5 | Auth and session foundation | Magic link request path works; session lifecycle works; collab rejects unauthenticated access | `packages/auth`, `packages/db/src/auth.ts`, [apps/api/src/index.ts](/Users/ik/repos/openmirage/apps/api/src/index.ts:1), [apps/collab/src/index.ts](/Users/ik/repos/openmirage/apps/collab/src/index.ts:1) | Auth/session helpers and API routes; collab cookie/session auth boundary; local acceptance pass validates magic-link flow and websocket auth | Complete | Nothing repo-managed is missing for this step |
| 6 | Storage abstraction and local object storage | Bucket bootstrap works; API upload/list/delete smoke passes; provider can switch by config | [packages/storage/src/index.ts](/Users/ik/repos/openmirage/packages/storage/src/index.ts:1), [packages/config-env/src/index.ts](/Users/ik/repos/openmirage/packages/config-env/src/index.ts:1), [docker-compose.yml](/Users/ik/repos/openmirage/docker-compose.yml:1) MinIO services | Storage adapters for `minio`, `s3-compatible`, and `local`; API smoke routes; storage tests; local acceptance pass | Complete | Nothing repo-managed is missing for this step |
| 7 | Dockerfiles and Compose for one-command local boot | New machine can boot full stack with one command; Caddy is single entrypoint; expected ports/hosts work | service Dockerfiles, [docker-compose.yml](/Users/ik/repos/openmirage/docker-compose.yml:1), [README.md](/Users/ik/repos/openmirage/README.md:1) | Compose topology includes web/api/collab/worker/Postgres/MinIO/Caddy plus migrate/seed jobs; canonical commands documented; local acceptance pass | Complete | Nothing repo-managed is missing for this step |
| 8 | Caddy and staging-facing runtime wiring | Local routing works only through Caddy; staging routes and cookie behavior match proxy reality | [docker/Caddyfile](/Users/ik/repos/openmirage/docker/Caddyfile:1), [docker-compose.yml](/Users/ik/repos/openmirage/docker-compose.yml:1), [.env.staging.example](/Users/ik/repos/openmirage/.env.staging.example:1), [ops/staging-vps.md](/Users/ik/repos/openmirage/ops/staging-vps.md:1) | Local acceptance pass proves Caddy-routed local behavior; staging route and cookie expectations are documented and checked by workflow/verifier | Partial | Real staging verification has not been recorded in the acceptance evidence contract |
| 9 | CI for validation and deploy packaging | PR/mainline static validation; same images built for local/staging; staging deploy is pipeline action | [`.github/workflows/ci.yml`](/Users/ik/repos/openmirage/.github/workflows/ci.yml:1), [`.github/workflows/staging-deploy.yml`](/Users/ik/repos/openmirage/.github/workflows/staging-deploy.yml:1) | CI runs lint/typecheck/test, Docker build validation, migration safety, and image publish; staging deploy workflow reuses immutable GHCR images | Complete | Nothing repo-managed is missing for this step |
| 10 | Staging deployment procedure for VPS | Fresh VPS can be provisioned from docs; repeatable updates; post-deploy checks verify connectivity | [ops/staging-vps.md](/Users/ik/repos/openmirage/ops/staging-vps.md:1), [`.github/workflows/staging-deploy.yml`](/Users/ik/repos/openmirage/.github/workflows/staging-deploy.yml:1), [scripts/verify-staging-deploy.mjs](/Users/ik/repos/openmirage/scripts/verify-staging-deploy.mjs:1) | Runbook and deploy workflow are present and coherent; staging verifier exists | Blocked | Populate staging fields in [ops/platform-acceptance-evidence.json](/Users/ik/repos/openmirage/ops/platform-acceptance-evidence.json:1) from a real workflow run |
| 11 | Logging, metrics, and error-reporting basics | Logs readable via Compose; metrics queryable; forced test error visible in configured sink | [packages/observability/src/index.ts](/Users/ik/repos/openmirage/packages/observability/src/index.ts:1), service entrypoints, [ops/platform-acceptance.md](/Users/ik/repos/openmirage/ops/platform-acceptance.md:1) | Local acceptance pass covers logs, metrics, and gated diagnostics error route; Sentry bootstrap is env-gated in code | Partial | The repo proves instrumentation and gated error route locally, but no recorded evidence shows a real configured error-reporting sink observed the forced test error |
| 12 | Backup, restore, and recovery runbooks | Backup artifact exists; restore done once into clean target; recovery runbook is reproducible | [ops/backup-restore-recovery.md](/Users/ik/repos/openmirage/ops/backup-restore-recovery.md:1), [scripts/backup-recovery.mjs](/Users/ik/repos/openmirage/scripts/backup-recovery.mjs:1), [ops/backup-restore-drill-evidence.md](/Users/ik/repos/openmirage/ops/backup-restore-drill-evidence.md:1) | Runbook and automation exist; markdown drill evidence records a successful 2026-04-14 local staging-equivalent restore drill | Partial | Copy the recorded backup/restore evidence into [ops/platform-acceptance-evidence.json](/Users/ik/repos/openmirage/ops/platform-acceptance-evidence.json:1); ideally also record a true staging artifact location if that is the intended closure bar |
| 13 | Close phase with acceptance pass | Full local and staging checklist passes; remaining gaps are product work only | [ops/platform-acceptance.md](/Users/ik/repos/openmirage/ops/platform-acceptance.md:1), [scripts/verify-platform-acceptance.mjs](/Users/ik/repos/openmirage/scripts/verify-platform-acceptance.mjs:1), [ops/platform-acceptance-evidence.json](/Users/ik/repos/openmirage/ops/platform-acceptance-evidence.json:1) | `pnpm verify:platform:acceptance` currently returns `BLOCKED`: local acceptance passes, staging and backup/restore evidence are incomplete | Blocked | Fill the evidence contract and rerun `pnpm verify:platform:acceptance` until it returns `PASS` |

## Gap Summary

### Missing Implementation

- None found that currently block the local platform slice. The repo-managed local acceptance path passes end to end.

### Missing Verification

- Step 8: staging-facing proxy/cookie behavior is implemented and workflow-checked, but there is no recorded real staging verification in the acceptance evidence contract.
- Step 11: error-reporting bootstrap exists, but there is no captured proof that a forced test error appeared in a configured external sink.

### Missing Operator Evidence

- [ops/platform-acceptance-evidence.json](/Users/ik/repos/openmirage/ops/platform-acceptance-evidence.json:1) has empty staging fields:
  - `workflowRunUrl`
  - `gitSha`
  - `publicBaseUrl`
  - `verifiedAt`
  - `sameArtifactsAsCi`
  - `websocketUpgradeVerified`
  - `secureCookiesVerified`
  - `observabilityVerified`
- The same file has empty backup/restore fields:
  - `artifactLocation`
  - `backupCreatedAt`
  - `restoreVerifiedAt`
  - `restoreTarget`
  - `postRestoreSmokeVerified`
- Because those fields are empty, the canonical acceptance command correctly returns `BLOCKED` instead of `PASS`.

### Documentation / Runbook Gaps

- The markdown restore-drill evidence in [ops/backup-restore-drill-evidence.md](/Users/ik/repos/openmirage/ops/backup-restore-drill-evidence.md:1) is not reflected in the machine-checked acceptance contract, so the repo cannot self-report phase closure.
- If the intended closure criterion for step 12 is specifically a staging-generated artifact rather than a staging-equivalent local artifact, that should be stated more explicitly in the evidence file once captured.

## Closure Checklist

To legitimately mark the platform plan complete:

1. Run a real staging deploy through [`.github/workflows/staging-deploy.yml`](/Users/ik/repos/openmirage/.github/workflows/staging-deploy.yml:1).
2. Record the workflow URL, deployed SHA, staging URL, websocket verification, secure-cookie verification, and observability verification in [ops/platform-acceptance-evidence.json](/Users/ik/repos/openmirage/ops/platform-acceptance-evidence.json:1).
3. Record backup/restore evidence in that same JSON file using the already completed restore drill data from [ops/backup-restore-drill-evidence.md](/Users/ik/repos/openmirage/ops/backup-restore-drill-evidence.md:1), or rerun the drill if fresher evidence is required.
4. If step 11 is intended to require external error-sink proof, verify one forced test error with `SENTRY_DSN` configured and set `observabilityVerified` based on that real check.
5. Rerun `pnpm verify:platform:acceptance` and require a final `PASS`.

## Commands Run For This Evaluation

- `pnpm verify:platform:prereqs`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm verify:platform:acceptance`

Acceptance result during this evaluation:

- prerequisite gate: `PASS`
- local acceptance: `PASS`
- staging acceptance: `BLOCKED`
- backup/restore acceptance: `BLOCKED`
- final decision: `BLOCKED`
