# OpenMirage Technical Design: Editor Model

### **1\. Scope**

For MVP, the editor is **browser-owned** and **page-scoped**. A file contains multiple pages; each page maps to one collaborative document. The browser owns rendering, tools, interaction state, selection behavior, and local undo/redo. Persistent page content lives in the collaboration layer; comments, permissions, asset metadata, and other app data live outside the editor model.

### **2\. Scene graph**

Each page is a **tree-based scene graph**. This is the canonical structure:

**File → Page → Nodes**

The MVP node types are: `frame`, `group`, `rectangle`, `ellipse`, `line`, `text`, and `image`. Frames and groups can contain children. Other nodes are leaves. Each node has a stable `id`, `type`, `parentId`, geometry, visibility, lock state, opacity, and child order or equivalent z-order representation. Styles are stored inline on nodes in MVP. Images reference assets; they do not embed binary data. This tree model keeps containment, ordering, transforms, and export traversal simple.

### **3\. Selection**

Selection is **ephemeral state**, not document content. It should travel through collaboration awareness/presence, alongside cursors and participant presence, but should not be persisted. Local editor state should track at least: `selectedIds`, `primarySelectionId`, hover target, and any active drag or resize handle. Remote selections are shown as overlays only.

Selection behavior for MVP should be simple:

* click selects the topmost visible, unlocked node,  
* shift-click adds or removes from selection,  
* marquee selects multiple nodes,  
* double-click drills into a group or frame,  
* locked or hidden nodes cannot be directly selected.

### **4\. Commands**

All edits should go through a **command layer**. A command is the semantic unit of change, such as:

* create node,  
* delete node,  
* move or resize node,  
* update node properties,  
* reparent node,  
* reorder node,  
* group or ungroup nodes.

Commands should compile down to a small set of scene-graph mutations and be applied as a single transaction. Pointer movement during drag should remain local preview state until commit, then produce one command. This keeps collaboration traffic smaller and makes undo/redo behave at the level users expect. The command layer is also the right place to enforce basic invariants, such as valid parent-child relationships and no edits to locked nodes.

### **5\. Undo / redo**

Undo and redo should be **local history over collaborative page state**. Only commands initiated by the local user are pushed onto that user’s undo stack. Remote collaborators’ changes are applied live but are not added to the local stack. Each command stores enough inverse information to undo itself as one transaction and redo itself the same way. In practice:

* one drag \= one undo step,  
* one resize \= one undo step,  
* one paste \= one undo step,  
* text edits should be coalesced into sensible chunks.

This matches the architecture goal of keeping collaboration state separate from ephemeral interaction state while preserving a simple browser-first editor model.