# Empty Product, Working Platform Acceptance

This runbook closes the platform phase without expanding product scope. It stays within the MVP boundaries in [`plan/mvp/1-thesis-and-mvp-boundary.md`](/Users/ik/repos/openmirage/plan/mvp/1-thesis-and-mvp-boundary.md), [`plan/mvp/3-architecture-overview.md`](/Users/ik/repos/openmirage/plan/mvp/3-architecture-overview.md), [`plan/mvp/4-technical-design-deployment-model.md`](/Users/ik/repos/openmirage/plan/mvp/4-technical-design-deployment-model.md), [`plan/mvp/4-technical-design-persistence-model.md`](/Users/ik/repos/openmirage/plan/mvp/4-technical-design-persistence-model.md), [`plan/mvp/4-technical-design-collaboration-model.md`](/Users/ik/repos/openmirage/plan/mvp/4-technical-design-collaboration-model.md), and [`plan/mvp/2-domain-model.md`](/Users/ik/repos/openmirage/plan/mvp/2-domain-model.md).

## Guardrails

Will do:

- reuse the existing step 9 local/staging verification assets as the baseline
- add one canonical acceptance command for local verification
- treat staging verification and backup/restore proof as operator-managed evidence
- keep verification inside the documented `web`, `api`, `collab`, `worker`, Postgres, blob storage, and Caddy seams

Won't do:

- no product routes, editor features, or Figma-parity work
- no replacement of Docker Compose, Caddy, GHCR, or the single-VPS deploy model
- no second staging pipeline when [`.github/workflows/staging-deploy.yml`](/Users/ik/repos/openmirage/.github/workflows/staging-deploy.yml) already provides the canonical path
- no DNS, TLS, or VPS provisioning automation in this slice

## Mandatory Prerequisite Rule

> before modifying any code, identify any prerequisites to your work that you cannot accomplish (ex: software installs on the local machine). check those prerequisites (pass or fail), if any fail, do not proceed. output the failures and provide procedural, step-by-step instructions on how to complete/fulfill the failing prerequisites

Use [`scripts/verify-platform-prereqs.mjs`](/Users/ik/repos/openmirage/scripts/verify-platform-prereqs.mjs) as the canonical gate. If it fails, stop immediately and fix the reported prerequisite before doing anything else.

## Asset Audit

- `reuse as-is`: [`.github/workflows/ci.yml`](/Users/ik/repos/openmirage/.github/workflows/ci.yml)
- `reuse as-is`: [`.github/workflows/staging-deploy.yml`](/Users/ik/repos/openmirage/.github/workflows/staging-deploy.yml)
- `reuse as-is`: [`scripts/verify-platform-prereqs.mjs`](/Users/ik/repos/openmirage/scripts/verify-platform-prereqs.mjs)
- `reuse as-is`: [`scripts/verify-platform-infra.mjs`](/Users/ik/repos/openmirage/scripts/verify-platform-infra.mjs)
- `reuse with doc updates`: [`README.md`](/Users/ik/repos/openmirage/README.md)
- `gap closed in step 13`: this runbook and the external evidence contract in [`ops/platform-acceptance-evidence.example.json`](/Users/ik/repos/openmirage/ops/platform-acceptance-evidence.example.json)

## Canonical Commands

Local acceptance:

```bash
pnpm verify:platform:acceptance
```

Full phase closure after operator evidence exists:

```bash
OPENMIRAGE_ACCEPTANCE_EVIDENCE_FILE=ops/platform-acceptance-evidence.json \
pnpm verify:platform:acceptance
```

The acceptance command always:

- prints the mandatory prerequisite rule
- audits the step 9 assets
- runs the prerequisite gate
- runs the full local Caddy-routed smoke path
- verifies metrics, logs, and the gated diagnostics error route
- checks whether staging and backup/restore evidence have been recorded
- emits a single `pass`, `fail`, or `blocked` checklist

## Local Acceptance Checklist

The local acceptance command must pass all of these without hand-editing the environment mid-run:

1. prerequisite gate passes
2. Compose boots the full stack with one command
3. homepage loads through Caddy
4. `/healthz`, `/readyz`, `/metrics`, `/collab/healthz`, `/collab/metrics`, `/worker/readyz`, `/worker/metrics`, and `/worker/status` respond as documented
5. magic-link request and consume work through the public Caddy origin
6. authenticated session validation works
7. unauthenticated collab websocket access is rejected with `401`
8. authenticated collab websocket access upgrades successfully
9. storage smoke upload, list, and delete work through the API abstraction
10. `docker compose logs` show API, collab, and worker request/activity records
11. the diagnostics error route returns `500` only when `ENABLE_TEST_ERROR_ROUTES=true`

## Staging Acceptance Path

Use the existing GitHub Actions deployment path. Do not create a second deploy pipeline.

1. Push the desired commit to `main` so CI publishes immutable GHCR images.
2. Run the protected `Staging Deploy` workflow from [`.github/workflows/staging-deploy.yml`](/Users/ik/repos/openmirage/.github/workflows/staging-deploy.yml).
3. Confirm the workflow smoke checks pass against the public staging origin.
4. Confirm staging still uses the same route model as local:
   - `/`
   - `/healthz`
   - `/readyz`
   - `/collab/healthz`
   - `/worker/readyz`
   - authenticated page-scoped collab handshake and sync at `/collab`
5. Verify auth/session behavior on the public HTTPS origin:
   - magic-link origin uses the public host
   - session cookies are `Secure`
   - a signed-in user can create a verification project/file/page and reach `Collab: connected`
6. Run the Sprint 6 manual collaboration smoke on staging with two editor-capable users:
   - both users open the same page and see each other in the presence strip
   - cursor movement and node selection appear remotely in real time
   - rectangle, frame, and text creation/mutation appear remotely without refresh
   - file, page, and node comments survive refresh and resolving a comment does not alter page content
   - after both users disconnect and reopen, page content and comments persist but stale cursor/selection state does not
7. Verify observability on staging:
   - logs are visible through `docker compose logs`
   - `/metrics` is reachable for API, collab, and worker
   - the forced diagnostics route is only enabled when intentionally gated
   - error reporting is visible in the configured sink when `SENTRY_DSN` is set
8. Verify fresh-VPS repeatability:
   - start from a clean or disposable VPS with only base VM provisioning completed
   - follow [`ops/staging-vps.md`](/Users/ik/repos/openmirage/ops/staging-vps.md:1) exactly to install Docker and Compose, create `$VPS_DEPLOY_DIR`, create `.env.staging`, validate SSH, DNS, and public ports, and run the canonical `Staging Deploy` workflow
   - confirm the run required no undocumented shell history, manual repo changes, or ad hoc deploy steps
9. Record the workflow run URL, commit SHA, staging URL, verification booleans, fresh-VPS proof fields, and error-reporting proof fields in `ops/platform-acceptance-evidence.json`.

Staging proof is incomplete unless the evidence file records all of these as concrete proof:

- `freshVpsPreparedFromRunbook=true`
- `freshVpsVerifiedAt`
- `freshVpsTarget`
- `errorReportingSinkVerified=true`
- `errorReportingVerifiedAt`
- `errorReportingReference`

## Staging Error-Reporting Verification

Record the explicit step 11 proof during a staging verification run:

1. Confirm `SENTRY_DSN` is configured in the staging `.env.staging` file.
2. Intentionally enable `ENABLE_TEST_ERROR_ROUTES=true` for the verification deploy only.
3. Run the canonical `Staging Deploy` workflow so the env change is applied through the checked-in deploy path.
4. Trigger the forced diagnostics route through the public origin:
   ```bash
   curl -i https://<public staging host>/__diagnostics/error
   ```
5. Confirm the route returns `500` and the corresponding event appears in the configured error-reporting sink.
6. Record the verification timestamp plus a stable event reference such as an event URL, issue URL, or event ID in `ops/platform-acceptance-evidence.json`.
7. Restore `ENABLE_TEST_ERROR_ROUTES=false` and rerun the canonical deploy path so the diagnostics route returns to its normal disabled state.

## Backup / Restore Evidence

Backup and restore are hard acceptance requirements.

1. Create or locate one Postgres backup artifact from staging or a staging-equivalent environment.
2. Restore it into a clean target environment.
3. Re-run the minimum smoke checks needed to prove the restored stack is healthy.
4. Record the artifact location, backup timestamp, restore timestamp, restore target, and post-restore smoke result in `ops/platform-acceptance-evidence.json`.

If the evidence file is missing or incomplete, the acceptance command must report `blocked`.

## Pass / Fail Rule

The platform phase closes only when every checklist item is `pass`.

- `fail`: a repo-managed verification step failed
- `blocked`: local verification passed, but staging proof or backup/restore proof is still missing
- `pass`: local verification, staging verification, and backup/restore evidence are all complete

Remaining gaps after a `pass` must be product work, not platform blockers.
