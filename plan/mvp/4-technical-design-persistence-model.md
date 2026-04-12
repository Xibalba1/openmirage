# OpenMirage Technical Design: Persistence Model

### **1\. Scope**

Persistence is split across three stores:

* **collaborative page state** for editable page content,  
* **Postgres** for product-domain metadata,  
* **blob storage** for binary assets and derived files.

This separation is a core MVP boundary. The page document is not decomposed into relational node tables, and Postgres is not the source of truth for live page content.

### **2\. Collaborative persistence (Yjs)**

Each **page** should persist as one Yjs-backed collaborative document. That document stores:

* the node tree,  
* node properties,  
* ordering,  
* and lightweight page-local editor state.

For MVP, the storage model should be **page-scoped Yjs state**, not normalized relational rows per node. The source docs do not lock in the exact Yjs persistence layout, so the recommended approach is simple: persist Yjs updates through the collaboration service and periodically compact them into a snapshot for faster reloads. In other words, the durable page state is “Yjs document for this page,” with snapshotting as an implementation detail.

Presence data such as cursors and active selections should travel through awareness only and should not be persisted as document history.

### **3\. What lives in Postgres**

Postgres stores **product-domain and workflow metadata**, including:

* users,  
* workspaces,  
* memberships,  
* projects,  
* files,  
* page index / page metadata,  
* comments,  
* share links,  
* asset metadata,  
* and export jobs.

Postgres is authoritative for permissions, ownership, sharing, comments, and app workflows. It should know that a file has pages, and basic metadata about those pages, but not the full scene graph contents of those pages.

### **4\. Asset references**

Binary files do not live in the page document or in Postgres. They live in **blob storage**. Postgres stores the corresponding asset record: `id`, workspace/file scope, kind, filename, mime type, size, storage key, and optional dimensions. An `image` node in the collaborative page state should therefore store an **asset reference** plus node-local presentation properties such as fit, crop, and opacity.

The practical reference chain is:

**Yjs page doc → asset id/reference → Postgres asset metadata → blob storage object**

That keeps the scene graph small, keeps binary storage replaceable, and lets asset lifecycle be managed independently from node edits.

### **5\. Load path**

On page open:

1. the API returns file/page metadata from Postgres,  
2. the collaboration service loads the page’s Yjs state,  
3. the browser hydrates the scene graph from that state,  
4. any referenced assets are resolved through asset metadata and blob URLs,  
5. presence starts separately as ephemeral awareness.

This preserves the intended MVP boundary: **Yjs for page content, Postgres for metadata, blob storage for binaries**.