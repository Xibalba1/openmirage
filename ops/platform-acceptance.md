# Platform Verification Runbook

## Purpose

Use this runbook to verify that the repository, local runtime, staging deployment, and recovery evidence are all in a healthy state for the current MVP.

This document is the operator-facing reference for `pnpm verify:platform:acceptance`. It keeps verification aligned with the documented service boundaries:

- `web`
- `api`
- `collab`
- `worker`
- Postgres
- blob storage
- Caddy

## Commands

Run the full local verification flow:

```bash
pnpm verify:platform:acceptance
```

Run the same flow with recorded staging and recovery evidence:

```bash
OPENMIRAGE_ACCEPTANCE_EVIDENCE_FILE=ops/platform-acceptance-evidence.json \
pnpm verify:platform:acceptance
```

The default evidence path is `ops/platform-acceptance-evidence.json`. Use [`ops/platform-acceptance-evidence.example.json`](./platform-acceptance-evidence.example.json) as the schema reference.

## What The Verification Command Checks

`pnpm verify:platform:acceptance` performs these checks in order:

1. Verifies the expected validation assets exist in the repo.
2. Runs the prerequisite verifier.
3. Runs the local infrastructure verifier.
4. Runs the browser smoke test.
5. Validates the staging evidence file, if present.
6. Validates the backup and restore evidence, if present.
7. Prints a final checklist with `pass`, `fail`, or `blocked` results.

## Local Verification Checklist

The local verification flow is expected to prove all of the following:

1. `pnpm verify:platform:prereqs` passes.
2. `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
3. The full Docker Compose stack boots successfully and routes browser traffic through Caddy.
4. `/healthz`, `/readyz`, `/metrics`, `/collab/healthz`, `/collab/metrics`, `/worker/readyz`, `/worker/metrics`, and `/worker/status` respond as expected.
5. Magic-link request, consume, session validation, refresh, and revoke work through the Caddy-facing origin.
6. Unauthenticated collaboration access is rejected and authenticated collaboration upgrades successfully.
7. Storage smoke upload, list, and delete operations succeed through the API abstraction.
8. Compose logs show activity from API, collaboration, and worker services.
9. The diagnostics error route returns `500` only when `ENABLE_TEST_ERROR_ROUTES=true`.
10. The browser smoke covers:
    - sign-in and entry into the authenticated app shell
    - opening or creating a multi-page file
    - page persistence after reload
    - representative frame, shape, text, and image editing
    - inspect data visibility
    - live two-user collaboration signals
    - comment creation and resolution
    - read-only share links
    - page PNG and file PDF exports

## Staging Verification

Staging verification uses the checked-in GitHub Actions deployment path in [`.github/workflows/staging-deploy.yml`](../.github/workflows/staging-deploy.yml).

Record the following as part of a staging verification run:

1. The workflow run URL.
2. The deployed commit SHA.
3. The public staging base URL.
4. Confirmation that the public origin and websocket routes are working.
5. Confirmation that secure cookies are set on the public HTTPS origin.
6. Confirmation that the full MVP smoke was completed.
7. Confirmation that a two-user collaboration pass was completed.
8. Confirmation that logs, metrics, and error reporting were checked.
9. Confirmation that the staging runbook worked on a fresh or disposable VPS without undocumented steps.

The minimum staging routes to verify remain:

- `/`
- `/healthz`
- `/readyz`
- `/metrics`
- `/collab/healthz`
- `/collab/metrics`
- `/worker/readyz`
- `/worker/metrics`
- `/worker/status`
- `/collab` for authenticated page-scoped collaboration

## Error Reporting Verification

When `SENTRY_DSN` is configured for staging, record one explicit error-reporting verification run:

1. Temporarily set `ENABLE_TEST_ERROR_ROUTES=true` in the staging environment.
2. Run the standard staging deploy workflow.
3. Trigger the public diagnostics route:

```bash
curl -i https://<staging-host>/__diagnostics/error
```

4. Confirm the route returns `500`.
5. Confirm the corresponding event appears in the configured error-reporting sink.
6. Record the verification time and a stable reference such as an event URL or event ID.
7. Restore `ENABLE_TEST_ERROR_ROUTES=false` and redeploy staging.

## Backup And Restore Evidence

Platform verification is not complete without one recorded restore proof.

The evidence file should include:

- backup artifact location
- backup creation time
- restore verification time
- restore target environment
- confirmation that post-restore smoke checks passed

Use [`ops/backup-restore-recovery.md`](./backup-restore-recovery.md) for the recovery procedure.

## Result States

- `fail`: a repo-managed verification step failed
- `blocked`: local checks passed, but staging or recovery evidence is missing or incomplete
- `pass`: local checks, staging evidence, and recovery evidence are all complete
