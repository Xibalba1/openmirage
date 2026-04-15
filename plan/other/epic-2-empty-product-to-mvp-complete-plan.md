# Epic: Empty Product to MVP Complete

## Summary

The platform epic is complete: the repo already has the monorepo, service shells, auth/session baseline, metadata schema, storage abstraction, Docker/Compose deploy path, CI, and backup/recovery runbooks. The remaining gap is almost entirely product work: authenticated app flows, metadata APIs, page-scoped collaborative persistence, the browser-owned editor and renderer, comments/sharing, assets, inspect/handoff, and worker-backed exports.

This Epic is organized into 10 Sprints. Each Sprint leaves the repo in a usable, testable state and preserves the MVP boundaries from `plan/mvp`: browser-owned editor/rendering, API-owned product metadata/auth/comments/share/export jobs, collab-owned page synchronization and presence, blob storage for binaries, and a boring single-VPS deployment model.

## Public Interfaces And Contracts To Add

- Frontend routes:
  - authenticated workspace/project/file browser
  - file/page editor route
  - side panels for inspect, comments, sharing, and export
- Shared domain/editor contracts:
  - workspace, project, file, page, asset, comment, share-link, export-job DTOs
  - scene-graph node types for `frame`, `group`, `rectangle`, `ellipse`, `line`, `text`, `image`
  - command payloads and selection/presence payloads used by the browser and collab layers
- API surfaces:
  - CRUD/list endpoints for projects, files, pages
  - comment list/create/resolve endpoints
  - asset upload + metadata endpoints
  - share-link create/revoke/read-only resolution endpoints
  - export job create/status/download endpoints
- Collab contract:
  - page-scoped document identity
  - connection-time auth based on file/page/workspace membership
  - persistent Yjs-backed page state plus ephemeral awareness
- Worker contract:
  - bounded job types for export, thumbnail, and cleanup work

## Sprint Plan

1. **Sprint 1: MVP contracts and authenticated app shell**  
   Delivery: `Codex`  
   Add shared product/editor TypeScript contracts, replace the platform-status landing page with an authenticated app shell, and wire session-aware routing so the repo has a stable foundation for all product work. Done when a signed-in user lands in the app shell instead of the empty platform page.
   Success conditions:
   - Shared TypeScript contracts exist for workspace, project, file, page, asset, comment, share-link, export-job, scene-graph node, command, and presence payloads, and `pnpm typecheck` exits with code `0`.
   - An unauthenticated browser session is redirected to or shown the auth entry flow instead of the product shell.
   - After successful sign-in, the browser lands in the authenticated app shell and no longer renders the platform-status landing page.

2. **Sprint 2: Metadata APIs and file/page navigation**  
   Delivery: `Codex`  
   Implement API endpoints and minimal UI for workspace-scoped project, file, and page listing/creation/rename/open flows using the existing relational schema. Done when a user can navigate `workspace -> project -> file -> page` and create/open a multi-page file without touching the database manually.
   Success conditions:
   - API endpoints for workspace-scoped project, file, and page list/create/rename/open flows exist and return the expected success or authorization failure HTTP statuses.
   - In the browser, an authenticated user can navigate `workspace -> project -> file -> page` using product UI only, without direct database access.
   - A user can create a file with more than one page, reload the app, and reopen the same file with the created pages still present in the correct order.

3. **Sprint 3: Page-scoped collab persistence and authorization**  
   Delivery: `Codex`  
   Upgrade `collab` from in-memory demo behavior to real page-backed collaboration: page document lookup, connection-time access checks by page/file/workspace, persisted Yjs state, and awareness transport. Use a collab-owned persistence adapter with update-log plus snapshot compaction, implemented in the simplest single-VPS-friendly way. Done when page content survives service restarts and unauthorized page opens are rejected.
   Success conditions:
   - Opening a page creates or loads one page-scoped collaborative document identified by that page and no unrelated page content is loaded into the session.
   - Editing page content, restarting the collab service, and reopening the page restores the same content from durable persistence.
   - A websocket connection attempt for a page without valid membership is rejected, while an authorized attempt succeeds.

4. **Sprint 4: Scene graph, canvas renderer, and page hydration**  
   Delivery: `Codex`  
   Build the browser-owned editor core: in-memory scene graph, page hydration from collab state, canvas rendering pipeline, viewport transform, and hit testing aligned with paint order. Done when a stored page renders on a canvas and supports pan/zoom without mutating node geometry.
   Success conditions:
   - A stored page document hydrates into an in-memory scene graph and renders visible nodes onto the editor canvas after page open.
   - Pan and zoom change the viewport presentation without changing persisted node coordinates or geometry values.
   - Hit testing selects the topmost visible, unlocked rendered node at a pointer location consistent with paint order.

5. **Sprint 5: Editing commands and core node manipulation**  
   Delivery: `Codex`  
   Add the command layer and MVP editing primitives: create nodes, select, move, resize, reorder, group/ungroup, delete, lock/hide handling, and local undo/redo. Include all MVP node types with plain-text editing via DOM overlay for active text edit. Done when one local user can author a mid-fidelity page with sensible undo/redo behavior.
   Success conditions:
   - A local user can create and edit each MVP node type: `frame`, `group`, `rectangle`, `ellipse`, `line`, `text`, and `image` where applicable to current asset support.
   - Create, move, resize, reorder, group, ungroup, delete, lock, and hide interactions all commit through the command layer and produce the expected page-state changes.
   - Undo and redo restore and reapply one-command-at-a-time edits correctly for drag, resize, paste or create, and text edit flows.

6. **Sprint 6: Multiplayer presence and comments**  
   Delivery: `Codex`  
   Add remote cursors, remote selections, participant awareness, and basic relational comments anchored to file/page/node targets with create/list/resolve UI. Keep selections and cursors ephemeral in awareness only. Done when two users can co-edit one page, see each other, and leave/resolve comments without comments entering the page document.
   Success conditions:
   - Two authenticated users connected to the same page can see each other’s live cursor or participant presence and remote selections in real time.
   - Presence-only state does not persist into the stored page document after both users disconnect and reconnect.
   - A comment can be created, listed, and resolved against a file, page, or node target, and the comment data is stored outside the page document.

7. **Sprint 7: Assets and image placement**  
   Delivery: `Codex`  
   Add asset upload/metadata flows, image-node insertion, asset resolution in the editor, and basic lifecycle handling for file/workspace-scoped assets. Done when uploaded images can be placed on a page as `image` nodes that reference asset records instead of embedding binary data.
   Success conditions:
   - An authenticated user can upload an image asset through the app or API and receive a persisted asset metadata record plus reachable blob-storage object.
   - An uploaded image can be inserted into a page as an `image` node and renders correctly after page reload.
   - The stored page document contains an asset reference for the image node rather than embedded binary image data.

8. **Sprint 8: Inspect and lightweight handoff**  
   Delivery: `Codex`  
   Add the basic inspect panel: dimensions, spacing, color, typography, and selected-node metadata; add read-only share links for lightweight review/handoff. Keep this intentionally narrow and product-UI-focused, not a full dev-mode clone. Done when an engineer can inspect a shared design and retrieve basic implementation values without edit access.
   Success conditions:
   - Selecting supported nodes shows dimensions, spacing, color, typography, and selected-node metadata in the inspect panel when those values apply.
   - A read-only share link can be created and opened in a browser session without edit permissions.
   - A read-only user can inspect shared design values but cannot perform document-mutating actions through the UI or API.

9. **Sprint 9: Exports, thumbnails, and worker jobs**  
   Delivery: `Codex`  
   Turn `worker` into a real bounded background processor for export jobs, page/file thumbnails, and cleanup tasks. Implement API job creation/status, blob-backed output artifacts, and basic download UX. Done when a user can request a page/file export and receive a completed artifact without blocking the API or collab paths.
   Success conditions:
   - Creating an export job through the app or API records a job, the worker processes it asynchronously, and job status moves from queued to a terminal state.
   - A successful export produces a blob-backed output artifact that can be downloaded through the documented UX or API path.
   - While an export job is running, API health/readiness and an active collab session remain responsive.

10. **Sprint 10: Hardening, staging closure, and Epic acceptance**  
    Delivery: `Codex + Operator`  
    Close gaps across auth flows, deploy config, observability, sample data, test coverage, and runbooks; formally establish real app-level automated test infrastructure for `apps/api` and `apps/web`; then run the full MVP acceptance pass locally and in staging. Done when the app satisfies the `plan/mvp` docs end-to-end and remaining work is polish or explicit non-goals.
    Success conditions:
    - The documented static validation suite and targeted MVP tests all pass at the repo root.
    - `apps/api` and `apps/web` use real automated test harnesses rather than placeholder package test commands, with app-level coverage for the highest-value MVP API and browser flows wired into the normal repo verification path.
    - The full MVP smoke flow passes locally: sign in, create/open a file, edit multiple pages, collaborate, comment, inspect, share, upload an asset, and complete an export.
    - The same MVP smoke flow is verified in staging with operator-owned environment steps completed, and any remaining open items are explicitly documented as polish or out-of-scope non-goals rather than MVP blockers.

## Dependencies And Parallelization

- Must stay sequential:
  - `1 -> 2 -> 3`
  - `4 -> 5`
  - `9 -> 10`
- After `3`, `4` can begin.
- After `5`, these can proceed in parallel:
  - `6`
  - `7`
  - `8`
- `9` depends on `7` and `8`.
- `10` depends on `6`, `8`, and `9`.

In compact form:

- `1 -> 2 -> 3 -> 4 -> 5`
- `5 -> 6`
- `5 -> 7`
- `5 -> 8`
- `7 + 8 -> 9`
- `6 + 8 + 9 -> 10`

## Test Plan And Acceptance

- Static validation on every Sprint:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm build`
  - targeted unit/integration tests for changed packages
- Product verification to add across the Epic:
  - auth redirect and session persistence
  - workspace/project/file/page CRUD and membership enforcement
  - page persistence across reload/restart
  - single-user editing for every MVP node type
  - local undo/redo semantics
  - multi-user presence and concurrent edit behavior
  - comment create/list/resolve flows
  - asset upload/place/delete smoke coverage
  - inspect values for spacing, size, color, and typography
  - share-link read-only access
  - export job enqueue/process/download
- Final Epic acceptance:
  - one-command local boot still works
  - authenticated user can create a file, edit multiple pages, collaborate live, comment, inspect, share, upload assets, and export
  - staging deploy uses the same artifacts and passes the same smoke checks plus operator-run restore confidence

## Codex vs Operator And Access Enablement

- `Codex` can complete nearly all repo-tracked work in Sprints `1-9` if it has normal workspace write access plus the existing Docker/local verification path.
- `Operator` is required in Sprint `10` for environment-owned actions unless those permissions are explicitly handed to Codex.

To let `Codex` complete more of the Epic directly, provide:

- staging access:
  - `VPS_HOST`, `VPS_USER`, `VPS_DEPLOY_DIR`, optional `VPS_SSH_KEY_PATH`
  - approval for `ssh` and `scp` command prefixes used for deploy verification
- staging secrets:
  - `.env.staging` values for app origin, session security, storage backend, and any email provider
- blob/email dependencies:
  - either keep staging on MinIO and logged magic links, or provide R2/S3 and SMTP sandbox credentials if real delivery is required
- browser-level verification:
  - either operator manual QA for multi-user/editor interactions, or explicit approval for any browser automation path we adopt later

If those are not granted, the plan still works: Codex completes the code and local verification, and the operator executes the staging-only steps with the supplied runbooks.

## Assumptions And Defaults

- Keep the platform and deployment model already in the repo; this Epic builds on it rather than reworking it.
- Use Sprint terminology everywhere; this full plan is the Epic.
- Preserve MVP scope only: no prototyping system, no plugins, no advanced auto layout parity, no component/variant system, no enterprise admin.
- Keep Yjs page content page-scoped and non-relational; Postgres remains authoritative for metadata/workflows, not node tables.
- Use the simplest operationally boring implementation that satisfies the docs, even when a more sophisticated design is possible.
