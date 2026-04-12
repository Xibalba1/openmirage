# OpenMirage Technical Design: Rendering Model

### **1\. Scope**

For MVP, rendering is **browser-owned**. The browser is responsible for editor interaction, canvas rendering, selection behavior, tools, and local UI state. Each open page is hydrated from page-scoped collaborative state into an in-memory scene graph, then rendered on a **canvas-based editor surface**.

### **2\. Canvas rendering pipeline**

The rendering pipeline should be:

1. load page collaborative state,  
2. build in-memory scene graph,  
3. flatten visible nodes into paint order,  
4. apply viewport transform,  
5. paint nodes,  
6. paint editor overlays last.

The scene graph is tree-based, so transforms, containment, visibility, ordering, and export traversal follow naturally from parent-child structure. Frames and groups render their children; leaf nodes render their own geometry or content. Styles remain inline on nodes in MVP.

### **3\. Hit testing**

Hit testing should use the same scene graph and paint order as rendering. On pointer input, traverse from topmost painted node downward, skipping hidden or locked nodes, and return the first matching hit. Container nodes should support both container selection and drill-in behavior. This keeps selection behavior aligned with the tree model and MVP rules for visibility, locking, grouping, and frames.

### **4\. Overlays**

Overlays should render separately from document content. They include:

* selection bounds and resize handles,  
* hover outlines,  
* marquee selection,  
* alignment or spacing guides if added,  
* remote cursors and remote selections.

These are editor/presence concerns, not canonical page content. Presence data such as cursors and active selections should remain ephemeral and should not be persisted with the page document.

### **5\. Text editing**

MVP text is **plain text blocks with basic font controls**; rich text and mixed styling are out of scope. The recommended implementation is canvas rendering for normal display, with a temporary DOM text editor overlay during active text edit. On commit, the edited value is written back to the text node and the canvas resumes normal rendering. This keeps text editing usable without expanding the document model beyond MVP scope.

### **6\. Zoom and pan**

Zoom and pan should be implemented as a **viewport transform** applied uniformly at render and hit-test time, rather than by mutating node geometry. Node coordinates remain in page space; the camera controls how that space is viewed. This matches the architecture’s browser-first separation between persistent page content and ephemeral interaction/view state, and satisfies the MVP requirement for zoom and pan without complicating the scene graph.

The design rule is simple: **scene graph for content, canvas for drawing, overlays for interaction, viewport transform for navigation**.

