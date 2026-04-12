# OpenMirage Domain Model

## **Document status**

Draft Date: Apr 10, 2026

Draft Version: v1

## **Purpose**

This document defines the first-pass domain model for OpenMirage. It covers:

* the product domain,  
* the editor/document domain,  
* collaboration and persistence boundaries,  
* and schema guidance for MVP implementation.

Its purpose is to establish a shared model before detailed schema design and implementation begin.

---

## **1\. Scope and modeling principles**

OpenMirage requires two related but distinct domain models:

1. the **product domain**, which describes users, workspaces, permissions, projects, files, sharing, comments, assets, and exports,  
2. the **editor domain**, which describes pages, nodes, layout hierarchy, styling, and collaborative editing state.

These domains are intentionally separated because they have different lifecycles, persistence patterns, and scaling concerns.

### **Modeling principles**

1. **Separate product data from editor data**  
   Product-domain entities such as memberships, share links, comments, and export jobs should not be conflated with scene-graph state.  
2. **Use pages as the collaborative unit**  
   A file may contain multiple pages, but collaboration should be modeled at the page level.  
3. **Keep presence ephemeral**  
   Cursor position, active selection, and live presence belong to ephemeral realtime state and should not be persisted as document content.  
4. **Keep the editor model simple in MVP**  
   The MVP scene graph supports frames, groups, shapes, text, and images. Components and instances are intentionally excluded from MVP core.  
5. **Preserve future extensibility**  
   The MVP should not implement shared styles or advanced component systems, but the domain model should leave room for them later.

---

## **2\. Top-level domain overview**

At a high level, OpenMirage is modeled as:

**Workspace → Projects → Files → Pages → Nodes**

With supporting entities for:

* memberships and permissions,  
* comments,  
* share links,  
* assets,  
* and exports.

This structure is the canonical product hierarchy for MVP.

---

## **3\. Product domain**

## **3.1 Workspace**

### **Definition**

A **Workspace** is the top-level tenant and collaboration boundary for MVP.

### **Responsibility**

A workspace groups:

* members,  
* projects,  
* workspace-level assets,  
* and all associated collaboration and access control within that tenant.

### **Notes**

The MVP does not introduce a separate organization layer above workspace. Workspace is the top-level container.

### **Key properties**

* `id`  
* `name`  
* `slug` or unique handle  
* `created_at`  
* `updated_at`  
* `deleted_at` (for soft delete if needed later)

---

## **3.2 User**

### **Definition**

A **User** is an authenticated person who can belong to one or more workspaces.

### **Responsibility**

Users:

* authenticate,  
* join workspaces,  
* create and edit files according to role,  
* participate in live collaboration,  
* leave comments,  
* and create exports.

### **Key properties**

* `id`  
* `email`  
* `display_name`  
* `avatar_url` (optional)  
* `created_at`  
* `updated_at`

---

## **3.3 Membership**

### **Definition**

A **Membership** connects a user to a workspace and defines their role.

### **Roles in MVP**

* `owner`  
* `editor`  
* `viewer`

### **Responsibility**

Membership controls access to workspace resources.

### **Key properties**

* `id`  
* `workspace_id`  
* `user_id`  
* `role`  
* `invited_by_user_id` (optional)  
* `created_at`  
* `updated_at`

### **Notes**

The MVP does not require separate admin or commenter roles.

---

## **3.4 Session / AuthToken**

### **Definition**

A **Session / AuthToken** is the authentication-domain artifact that links a user to an active application session or a one-time login flow.

### **Responsibility**

Session and auth-token records support:

* authenticated access to the application,  
* session validation across requests,  
* one-time login or magic-link flows,  
* and revocation or expiry of authentication artifacts.

### **MVP auth/session model**

The MVP should reserve space for:

* a durable session record or equivalent session artifact,  
* a one-time login or magic-link token artifact,  
* expiration semantics,  
* revocation or invalidation semantics,  
* and a direct relation to `user_id`.

### **Notes**

This is platform-domain data supporting authentication and access control. It is not editor content and it is not part of collaborative page state.

---

## **3.5 Project**

### **Definition**

A **Project** is a grouping container within a workspace.

### **Responsibility**

Projects provide organizational structure for files. They are not collaborative documents themselves.

### **Key properties**

* `id`  
* `workspace_id`  
* `name`  
* `description` (optional)  
* `created_at`  
* `updated_at`  
* `deleted_at`

### **Lifecycle**

Projects should be soft deletable in MVP.

---

## **3.6 File**

### **Definition**

A **File** is the primary collaborative design document.

### **Responsibility**

A file contains one or more pages and serves as the main unit of authoring, sharing, and collaboration from the user’s perspective.

### **Notes**

A file is not limited to a single page. Multi-page support is required in MVP.

### **Key properties**

* `id`  
* `project_id`  
* `workspace_id` (optional denormalization if useful)  
* `name`  
* `description` (optional)  
* `created_by_user_id`  
* `created_at`  
* `updated_at`  
* `deleted_at`

### **Relationships**

A file:

* belongs to a project,  
* contains many pages,  
* may have many comments,  
* may have many share links,  
* may have many exports,  
* may have many file-local assets.

### **Lifecycle**

Files should be soft deletable in MVP.

---

## **3.7 Page**

### **Definition**

A **Page** is a logical canvas within a file.

### **Responsibility**

Pages provide structure within a file and act as the natural boundary for editor content and realtime collaboration.

### **Notes**

While the UI may present a page as a canvas, the underlying model remains `file → page → node`.

### **Key properties**

* `id`  
* `file_id`  
* `name`  
* `order_index`  
* `width` (optional page/canvas metadata)  
* `height` (optional page/canvas metadata)  
* `background` (optional)  
* `created_at`  
* `updated_at`

### **Collaboration note**

For MVP, each page should map cleanly to one collaborative page document or page-scoped collaborative state.

---

## **3.8 Comment**

### **Definition**

A **Comment** is app-domain review data associated with a file and optionally anchored to a page and/or node.

### **Responsibility**

Comments support lightweight review and collaboration context.

### **Comment model for MVP**

The MVP requires:

* page-level comments,  
* optional node-anchored comments.

### **Key properties**

* `id`  
* `file_id`  
* `page_id` (optional but recommended)  
* `node_id` (optional)  
* `author_user_id`  
* `body`  
* `created_at`  
* `updated_at`  
* `resolved_at` (optional if lightweight resolution is added)  
* `deleted_at` (optional if soft-delete or tombstone behavior is desired)

### **Notes**

Comments live in Postgres, not in the collaborative editor document.

---

## **3.9 ShareLink**

### **Definition**

A **ShareLink** grants read-only access to a file without requiring full workspace membership.

### **Responsibility**

Share links support lightweight external viewing.

### **MVP sharing model**

The MVP supports:

* member invites,  
* read-only share links.

The MVP does not support public editable links.

### **Key properties**

* `id`  
* `file_id`  
* `token` or secure identifier  
* `created_by_user_id`  
* `expires_at` (optional)  
* `revoked_at` (optional)  
* `created_at`

---

## **3.10 Asset**

### **Definition**

An **Asset** is metadata for a binary resource used in a file or workspace.

### **Responsibility**

Assets describe uploaded media stored externally in object storage.

### **MVP asset model**

Assets may be:

* **workspace-level**, reusable across files,  
* **file-local**, scoped to one file.

### **Key properties**

* `id`  
* `workspace_id`  
* `file_id` (nullable for workspace-global assets)  
* `uploaded_by_user_id`  
* `kind` (for example: image, font, export, thumbnail)  
* `filename`  
* `mime_type`  
* `byte_size`  
* `storage_key`  
* `width` (optional)  
* `height` (optional)  
* `created_at`  
* `updated_at`  
* `deleted_at`

### **Storage note**

Binary content is stored in R2. Only asset metadata and references are stored in Postgres.

### **Lifecycle**

Assets should be soft deletable in MVP.

---

## **3.11 ExportJob**

### **Definition**

An **ExportJob** represents a requested export or render artifact generation task.

### **Responsibility**

Exports support output workflows such as image export or derived design artifacts.

### **Key properties**

* `id`  
* `file_id`  
* `page_id` (optional depending on export scope)  
* `requested_by_user_id`  
* `format`  
* `status`  
* `output_asset_id` (optional)  
* `error_message` (optional)  
* `created_at`  
* `updated_at`

### **Notes**

Export jobs are app-domain data and should live in Postgres.

---

## **4\. Product domain relationships**

The MVP product-domain relationships are:

* one **Workspace** has many **Memberships**  
* one **Workspace** has many **Projects**  
* one **Workspace** has many **Assets**  
* one **User** has many **Memberships**  
* one **User** may have many **Sessions/AuthTokens**  
* one **Project** belongs to one **Workspace**  
* one **Project** has many **Files**  
* one **File** belongs to one **Project**  
* one **File** has many **Pages**  
* one **File** has many **Comments**  
* one **File** has many **ShareLinks**  
* one **File** has many **ExportJobs**  
* one **Comment** may belong to one **Page** and may optionally reference one **Node**  
* one **Asset** may belong to a **Workspace** and may optionally be scoped to one **File**

---

## **5\. Editor domain**

The editor domain models the design content itself.

## **5.1 Document structure**

The canonical structure is:

**File → Pages → Nodes**

A file contains multiple pages. A page contains a scene graph of nodes.

This is the primary editor content model for MVP.

---

## **5.2 Scene graph model**

### **Definition**

The editor content for each page is represented as a **tree-based scene graph**.

### **Why tree-based**

A tree-based model simplifies:

* parent-child containment,  
* group and frame behavior,  
* transforms,  
* visibility,  
* locking,  
* ordering,  
* and export traversal.

### **Rules**

* Nodes may have parent-child relationships where allowed by node type.  
* Frames and groups can contain child nodes.  
* Leaf nodes such as rectangles or text typically do not contain children.  
* Ordering may be represented through ordered child position or another equivalent stable ordering method.

---

## **5.3 MVP node types**

The MVP core scene graph includes the following node types:

* `frame`  
* `group`  
* `rectangle`  
* `ellipse`  
* `line`  
* `text`  
* `image`

The following are explicitly **not** part of MVP core:

* `component`  
* `component_instance`

The domain model should leave room for them in the future, but the core MVP scene graph should not depend on them.

---

## **5.4 Base node model**

All nodes share a common base structure with per-type extensions.

### **Common base fields**

* `id`  
* `type`  
* `page_id`  
* `parent_id`  
* `name`  
* `x`  
* `y`  
* `width`  
* `height`  
* `rotation`  
* `visible`  
* `locked`  
* `opacity`  
* ordering field such as `z_index` or ordered child position  
* `created_at`  
* `updated_at`

### **Notes**

The implementation may choose whether some of these fields are persisted directly in relational metadata or live inside collaborative document state. The domain model only defines their conceptual presence.

---

## **5.5 Node-specific properties**

Each node type extends the base node with type-specific properties.

### **FrameNode**

A frame represents a bounded container for UI composition.

Likely properties:

* layout or clipping metadata if needed later,  
* background or fill,  
* stroke,  
* corner radius,  
* child ordering.

### **GroupNode**

A group is a logical container for manipulation and organization.

Likely properties:

* child ordering,  
* transform inheritance.

### **RectangleNode**

A basic rectangular shape.

Likely properties:

* fill,  
* stroke,  
* corner radius,  
* shadow.

### **EllipseNode**

An ellipse or circle shape.

Likely properties:

* fill,  
* stroke,  
* shadow.

### **LineNode**

A linear primitive.

Likely properties:

* stroke,  
* stroke width,  
* endpoints or equivalent geometry representation.

### **TextNode**

A text block with basic font controls.

Likely properties:

* text content,  
* font family,  
* font size,  
* font weight,  
* line height,  
* text color,  
* alignment.

### **ImageNode**

A placed image.

Likely properties:

* asset reference,  
* fit mode,  
* crop metadata if supported,  
* opacity.

---

## **5.6 Styling model**

### **MVP styling approach**

In MVP, styles should be **stored primarily inline on nodes**.

### **Reasoning**

This keeps the editor model simpler and avoids introducing shared-style lifecycle complexity too early.

### **Future extensibility**

The model should reserve space for shared styles later. This means:

* avoid schema choices that make all styling permanently node-exclusive,  
* keep room for future style references or style objects,  
* but do not force shared-style behavior into MVP.

### **Styling categories likely needed in MVP**

* fill  
* stroke  
* radius  
* shadow  
* typography  
* alignment  
* opacity

---

## **5.7 Text model**

### **MVP text model**

Text in MVP is modeled as **plain text blocks with basic font controls**.

### **In scope**

* plain text content,  
* basic typography controls,  
* basic alignment.

### **Out of scope for MVP**

* rich text spans,  
* mixed styling within a single text node,  
* advanced text layout.

---

## **5.8 Selection and presence model**

### **Definition**

Selection and user presence are **ephemeral collaboration state**.

### **Includes**

* active selections,  
* cursor positions,  
* presence status,  
* local tool focus or active participant indicator if needed.

### **Persistence rule**

Selection, cursors, and presence should not be stored as persistent document content.

---

## **6\. Collaboration boundaries**

OpenMirage requires explicit separation of three kinds of state.

## **6.1 Collaborative document state**

This is the persistent collaborative state synchronized through the realtime collaboration layer.

### **Includes**

* page node tree,  
* node properties,  
* ordering,  
* page-local editor content,  
* lightweight page-local metadata if necessary.

### **Excludes**

* live presence,  
* transient selection state,  
* full comment system,  
* workspace/project/file metadata.

### **Recommendation**

Use collaborative page-scoped state as the core synchronization unit.

---

## **6.2 Ephemeral realtime state**

This is short-lived collaboration state that supports live interaction but is not persisted as document content.

### **Includes**

* cursor locations,  
* active selections,  
* participant awareness,  
* temporary session information.

### **Persistence rule**

This state should be transmitted through the realtime system but not stored as document history or durable file content.

---

## **6.3 App/database state**

This is ordinary application-domain state stored in Postgres.

### **Includes**

* users,  
* workspaces,  
* memberships,  
* projects,  
* files,  
* page metadata/index,  
* comments,  
* share links,  
* assets metadata,  
* export jobs.

This state is authoritative for permissions, relationships, and application workflows.

---

## **7\. Persistence model**

## **7.1 PostgreSQL**

Postgres is the system of record for product-domain data.

### **Postgres stores**

* workspaces,  
* memberships,  
* projects,  
* files,  
* pages index and metadata,  
* comments,  
* share links,  
* assets metadata,  
* export jobs.

### **Notes**

Comments remain relational app data, not embedded editor content.

---

## **7.2 Object storage (R2)**

R2 stores large binary objects.

### **R2 stores**

* uploaded images,  
* fonts if supported,  
* thumbnails,  
* exported artifacts,  
* other blob assets.

### **Postgres references**

Only metadata and object references such as `storage_key` should live in Postgres.

---

## **7.3 Collaborative persistence**

The collaborative editor state should persist editor content and page-local state through the chosen collaboration system.

### **Recommended scope**

Persist:

* page content,  
* node hierarchy,  
* node properties,  
* ordering,  
* lightweight page-level editor metadata if needed.

Do not persist:

* presence,  
* cursor state,  
* comment threads as part of the drawing state.

---

## **8\. Deletion and lifecycle rules**

## **8.1 Soft delete**

The MVP uses **soft delete** for workspace-facing objects such as:

* projects,  
* files,  
* assets.

This allows recovery of major user-facing entities without introducing full version history.

## **8.2 Hard delete**

Within the editor document itself, hard deletion of nodes is acceptable for MVP.

### **Rationale**

Version recovery is explicitly out of scope for MVP. The system does not need a fully user-exposed recovery or branching model at this stage.

---

## **9\. Recommended first-pass schema guidance**

This section is not a full physical schema. It is a translation layer from domain model to likely schema direction.

## **9.1 Product tables likely needed**

* `users`  
* `workspaces`  
* `memberships`  
* `projects`  
* `files`  
* `pages`  
* `comments`  
* `share_links`  
* `assets`  
* `export_jobs`

## **9.2 Important foreign-key relationships**

* `memberships.workspace_id -> workspaces.id`  
* `memberships.user_id -> users.id`  
* `projects.workspace_id -> workspaces.id`  
* `files.project_id -> projects.id`  
* `pages.file_id -> files.id`  
* `comments.file_id -> files.id`  
* `comments.page_id -> pages.id` (nullable)  
* `assets.workspace_id -> workspaces.id`  
* `assets.file_id -> files.id` (nullable)  
* `share_links.file_id -> files.id`  
* `export_jobs.file_id -> files.id`  
* `export_jobs.page_id -> pages.id` (nullable)

## **9.3 Node persistence guidance**

The editor node graph should not be naively decomposed into many relational tables unless there is a compelling reason. For MVP, the scene graph is better treated as collaborative structured document state rather than as a heavily normalized relational model.

This means:

* relational metadata should describe files and pages,  
* collaborative persistence should store the page content and node tree,  
* comments and other app-level workflows should remain outside the scene graph.

---

## **10\. Explicit exclusions from the domain model**

The following concepts are intentionally excluded from MVP core modeling:

* enterprise organizations above workspace,  
* component systems and instances,  
* advanced shared style systems,  
* branching/version history domain entities,  
* plugin-domain entities,  
* enterprise access-control variants beyond owner/editor/viewer,  
* public editable links,  
* advanced review workflows and status-heavy approval systems.

These may be introduced later, but the MVP model should not assume them.

---

## **11\. Open questions for follow-on design**

The following questions remain to be specified in later documents:

* the exact shape of page-local collaborative document state,  
* whether pages need additional viewport or guide metadata,  
* the exact comment anchoring behavior when a referenced node is deleted,  
* whether asset reuse across files needs UI support in MVP or only schema support,  
* the minimum export formats and whether they require additional domain entities,  
* and whether a minimal reusable-component construct should be introduced immediately after MVP.

---

## **12\. Summary**

OpenMirage’s domain model is intentionally split between a **product domain** and an **editor domain**.

The product domain is centered on:  
**Workspace → Projects → Files**  
with relational support for memberships, comments, assets, sharing, and exports.

The editor domain is centered on:  
**File → Pages → Nodes**  
with a tree-based scene graph and a constrained set of MVP node types.

Collaborative editor content should be synchronized and persisted separately from product-domain app data. Presence remains ephemeral. Comments remain relational. Large binaries remain in R2. This separation is the core modeling decision that should guide MVP architecture and schema implementation.
