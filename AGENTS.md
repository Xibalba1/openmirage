# AGENTS.md

## Repository expectations

- Keep changes aligned with the MVP only. Do not expand product scope or add Figma-parity features unless the task explicitly requires it.
- Before changing code, read the most relevant file in `plan/mvp/` and treat those docs as the source of truth for product boundaries and system shape.
- Prefer small, modular changes that preserve the documented service boundaries: `web`, `api`, `collab`, `worker`, Postgres, and pluggable blob storage.
- If docs conflict, follow this order unless the task says otherwise: `1-thesis-and-mvp-boundary` -> `2-domain-model` -> `3-architecture-overview` -> the relevant `4-technical-design-*` document.

## MVP docs reference map

- `plan/mvp/1-thesis-and-mvp-boundary.md`: Read for scope checks, non-goals, and “should we build this now?” decisions.
- `plan/mvp/2-domain-model.md`: Read for schema, entity, auth/session, ownership, sharing, and file/page/workspace relationships.
- `plan/mvp/3-architecture-overview.md`: Read for repo/service boundaries, runtime responsibilities, and cross-service integration decisions.
- `plan/mvp/4-technical-design-deployment-model.md`: Read for Docker/Compose, Caddy, VPS, backups, restore, secrets, logging, and metrics work.
- `plan/mvp/4-technical-design-persistence-model.md`: Read for Postgres vs Yjs vs blob-storage boundaries and migration implications.
- `plan/mvp/4-technical-design-collaboration-model.md`: Read for websocket auth, page-scoped collaboration, presence, and Hocuspocus/Yjs behavior.
- `plan/mvp/4-technical-design-editor-model.md`: Read for scene-graph, page model, editor commands, and node-level behavior.
- `plan/mvp/4-technical-design-rendering-model.md`: Read for canvas/rendering, viewport behavior, hit testing, and browser-owned rendering concerns.

## Working style

- When implementing scaffolding or infrastructure, optimize for a boring, self-hostable single-VPS deployment.
- When uncertain, choose the simpler path that keeps local development, staging deploys, and recovery procedures easy to understand.
