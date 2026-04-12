# OpenMirage Technical Design: Collaboration Model

### **1\. Scope**

The **page** is the collaboration unit. A file may contain many pages, but each page maps to one collaborative document and one live collaboration session. This keeps the synchronization boundary small and clean, and avoids mixing product-domain data with editor content.

### **2\. Collaborative state vs. presence-only state**

**Collaborative state** is the persistent editor state for a page. For MVP, it includes:

* the page node tree,  
* node properties,  
* parent/child relationships,  
* ordering,  
* and lightweight page-local editor metadata where needed.

This is the authoritative source of live page content.

**Presence-only state** is realtime session state that should not become document content. It includes:

* cursor position,  
* active selection,  
* participant awareness,  
* and similar temporary interaction signals.

Presence is transported through the collaboration layer’s awareness mechanism and must not generate routine database writes.

### **3\. What is persisted**

There are three separate persistence categories:

**Collaborative persistence**  
The collaboration system persists page content: node hierarchy, node properties, ordering, and page-local editor state. This is the durable representation of the editable page.

**Application persistence**  
Postgres stores product-domain data: users, workspaces, memberships, projects, files, page index/metadata, comments, share links, asset metadata, and export jobs. Comments remain relational app data, not part of the scene graph.

**Blob persistence**  
Binary objects such as uploaded images, thumbnails, and exports live in blob storage. The page document stores references to those assets, not the binary data itself.

Presence state is **not persisted** as canonical document content.

### **4\. Page loading flow**

Page loading should work as follows:

1. The browser loads file and page metadata from the HTTP API.  
2. When the user opens a page, the browser connects to the collaboration service for that page.  
3. The collaboration service verifies access at connection time.  
4. The collaboration service loads the persisted collaborative page state and begins live synchronization.  
5. The browser hydrates the editor from that page document and separately starts presence/awareness for cursors and selections.  
6. Comments, share state, asset metadata, and other app-domain data are fetched from the API, not from the collaborative document.

### **5\. Design rule**

The core rule is strict separation:

* **page content** is collaborative and persisted,  
* **presence** is collaborative but ephemeral,  
* **app workflows** are relational,  
* **binary assets** are blobs.

That boundary is the key simplification for MVP and should remain intact unless scale or product requirements force a change.