# Epic: MVP Tighten and Polish

## Summary

The MVP feature set is in place. The remaining gap is not new capability but product tightness: the app still feels like a sequence of implementation milestones rather than one coherent product. Epic 3 should compress the path from login to canvas, give the canvas more default prominence, preserve hierarchy clarity without forcing full-screen drill-down, remove sprint-era copy and weak states, and clean up obvious repo residue.

This Epic is organized into 5 Sprints. Each Sprint should leave the repo in a usable, testable state and stay inside the MVP boundaries from `plan/mvp`: no new product features, no new infrastructure, no domain-model changes, and no broad monorepo refactor.

## Public Interfaces And Contracts To Update

- Frontend entry flow:
  - `/app` becomes the primary authenticated launchpad
  - the launchpad is scoped to one active workspace at a time
  - the active workspace is remembered in browser-local state, not a server-backed preference
- Frontend navigation model:
  - preserve the canonical hierarchy `workspace -> project -> file -> page`
  - present that hierarchy in one dense launchpad instead of requiring separate full-screen route stops
  - keep existing workspace/project/file routes valid as secondary routes and deep-link surfaces
- Launchpad interaction contract:
  - file cards expose `Open` as the primary action
  - file cards expose `Browse pages` as the secondary action for inline page expansion
  - create actions stay contextual to the currently visible hierarchy level
- Editor shell contract:
  - default editor layout is canvas-first
  - left-side navigation becomes one collapsible overlay rail for pages, layers, and comments
  - right-side utilities become one collapsible overlay panel with shared modes for `Inspect`, `Share`, and `Export`
  - opened panels overlay the canvas rather than permanently shrinking it
- Product-state contract:
  - loading, empty, and error states should speak in product language
  - sprint-era and implementation-phase copy should be removed
- Backend/API contract:
  - no intentional domain-model change
  - no planned new persistence model
  - prefer existing workspace/project/file/file-open APIs unless a small aggregation endpoint becomes clearly necessary during implementation

## Sprint Plan

### Sprint 1: Launchpad baseline and route primacy

Replace the current post-login multi-screen drill-down as the primary entry experience with an active-workspace launchpad baseline. Keep the existing intermediate routes intact, but demote them to fallback and deep-link surfaces. Add browser-local active-workspace memory so returning users land in the right workspace dashboard without auto-opening a canvas.

Success conditions:
- Authenticated users land on the new `/app` launchpad instead of the current drill-down flow.
- The app restores the last active workspace from browser-local state.
- Existing workspace, project, and file routes remain valid and navigable.
- No server-backed preference or domain-model work is introduced for active-workspace memory.
- All code written or changed in the Sprint has automated test coverage, and Sprint-complete coverage for changed code is 100%.

### Sprint 2: Compressed hierarchy and direct-open dashboard

Build the dense, text-first launchpad inside the active workspace. Group files under projects, support contextual create actions, and let a user jump to editing in one click through the file card primary action. Keep page-level browsing available inline through file-card expansion so hierarchy clarity remains intact.

Success conditions:
- The launchpad shows one active workspace with grouped project and file browsing on a single screen.
- File cards expose `Open` and `Browse pages`.
- `Open` takes the user directly to the file’s default page/editor route in one click.
- `Browse pages` expands inline and supports direct page navigation.
- Project, file, and page creation remain available through lightweight contextual UI rather than heavy always-visible forms.
- All code written or changed in the Sprint has automated test coverage, and Sprint-complete coverage for changed code is 100%.

### Sprint 3: Canvas-first editor shell

Refactor the editor layout so the canvas is the default focal point. Replace the fixed three-column shell with overlay panels: one left navigation rail for pages, layers, and comments, and one right utility panel for inspect/share/export modes. Move rename/create affordances out of permanent shell chrome into lighter contextual controls.

Success conditions:
- The default editor layout provides materially more canvas area than the current three-column shell.
- Pages, layers, and comments live in one collapsible left overlay rail.
- Inspect, share, and export live in one collapsible right overlay panel with shared modes.
- Opened panels overlay the canvas instead of permanently resizing the layout.
- Core editor capabilities remain unchanged; this Sprint is shell/layout polish only.
- All code written or changed in the Sprint has automated test coverage, and Sprint-complete coverage for changed code is 100%.

### Sprint 4: Product copy and state polish

Remove sprint-era and scaffolding-era language across auth, launchpad, editor, and shared states. Tighten empty, loading, and error states so the product reads consistently as one MVP instead of a staged buildout. Use this Sprint to finish the smaller navigation-orientation details that make the compressed launchpad and canvas-first shell understandable.

Success conditions:
- Auth, launchpad, and editor screens contain no sprint-era or implementation-phase copy.
- Loading, empty, and error states are concise, product-facing, and consistent across the app.
- Breadcrumbs and compact orientation cues are present where needed without reintroducing navigation tax.
- The product reads as one coherent experience rather than stacked milestone screens.
- All code written or changed in the Sprint has automated test coverage, and Sprint-complete coverage for changed code is 100%.

### Sprint 5: Targeted cleanup and Epic acceptance

Perform the narrow cleanup pass and close the Epic with verification. Remove obvious vestigial files, stale scaffolding, stray artifacts, and low-signal residue that no longer reflects the current product state. Keep this intentionally narrow and avoid broad repo restructuring.

Success conditions:
- Agreed vestigial files, directories, artifacts, and stale scaffolding are removed.
- Cleanup does not introduce a broad monorepo/package/script refactor.
- Dashboard, editor-shell, route fallback, and copy/state flows pass the Epic verification path.
- Remaining work after this Sprint is deliberate follow-on polish, not unresolved Epic ambiguity.
- All code written or changed in the Sprint has automated test coverage, and Sprint-complete coverage for changed code is 100%.

## Dependencies And Parallelization

- Must stay sequential:
  - `1 -> 2`
  - `2 -> 3`
  - `4 -> 5`
- After `2`, these can proceed in parallel:
  - `3`
  - `4`
- `5` depends on `3` and `4`.

In compact form:

- `1 -> 2`
- `2 -> 3`
- `2 -> 4`
- `3 + 4 -> 5`

## Test Plan And Acceptance

- Static validation on every Sprint:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm build`
  - targeted unit/integration/browser tests for changed surfaces
  - coverage measurement proving 100% automated test coverage for all code written or changed in that Sprint
- Launchpad verification:
  - authenticated user lands on launchpad after login
  - last active workspace is restored from browser-local memory
  - workspace switching updates the active workspace
  - grouped project/file browsing renders correctly on one screen
  - file `Open` goes directly to the default page route
  - file `Browse pages` expands inline and supports direct page jumps
  - contextual create actions remain functional
- Routing verification:
  - existing workspace/project/file/page deep links still resolve correctly
  - intermediate routes remain usable as fallback/secondary navigation
- Editor-shell verification:
  - default editor layout increases visible canvas area
  - left overlay rail correctly hosts pages, layers, and comments
  - right overlay panel correctly switches between inspect/share/export modes
  - overlay behavior does not permanently shrink the canvas
  - rename/create affordances remain available through lighter contextual UI
- Product-state verification:
  - auth, launchpad, and editor contain no sprint-era copy
  - loading, empty, and error states are present and coherent
  - breadcrumbs and orientation cues remain understandable after layout compression
- Cleanup verification:
  - agreed residue is removed
  - repo scripts, builds, and verification flows still pass after cleanup
- Final Epic acceptance:
  - a signed-in user can reach a canvas in one click from the launchpad
  - the hierarchy remains understandable without multi-screen drill-down
  - the editor reads as canvas-first rather than panel-first
  - the repo no longer contains the obvious product/scaffolding residue targeted by this Epic

## Codex vs Operator And Access Enablement

- `Codex` should be able to complete essentially all repo-tracked work in this Epic with normal workspace write access and the existing local verification path.
- `Operator` is useful only for subjective product review and final scope judgment if desired; no special infrastructure, staging-only dependency, or environment-owned work is required by default for Epic 3.

To let `Codex` complete the Epic directly, provide:
- normal workspace write access
- existing local app boot and test path
- approval for any local browser verification path already used in the repo if interactive checks are needed

If those are not expanded, the plan still works: Codex can complete the implementation and local verification, and the operator can perform any final visual/product review manually.

## Assumptions And Defaults

- Keep the MVP feature set and architecture as-is; this Epic is polish, not capability expansion.
- Use Sprint terminology; this full plan is the Epic.
- Preserve the canonical hierarchy `workspace -> project -> file -> page`.
- Keep the dashboard dense and text-first; no thumbnail-led browsing in this Epic.
- Do not auto-resume directly into the last canvas by default.
- Keep active-workspace memory browser-local rather than server-backed.
- Keep comments in the left overlay rail with page/layer navigation.
- Keep inspect/share/export in the shared right overlay panel.
- Keep existing intermediate routes rather than broadly redesigning routing.
- Restrict cleanup to obvious residue and stale scaffolding; do not expand into a broad repo convention overhaul unless required to finish the targeted cleanup safely.
