# OpenMirage Product Thesis and MVP Boundary

## **Document status**

Draft Date: Apr 10, 2026

Draft Version: v1

## **Purpose**

This document defines the product thesis, target user, core job-to-be-done, MVP scope, and explicit non-goals for OpenMirage. Its purpose is to create alignment before technical design and implementation begin.

---

## **1\. Product definition**

**OpenMirage** is a browser-based, self-hostable collaborative UI design workspace for startup product teams.

It is intended to sit between rough ideation tools and heavyweight design suites. The product should enable teams to move from early concepts to real UI screens quickly, collaborate in real time, and hand designs to engineers with enough structure to support implementation.

OpenMirage is not intended to be a full-featured replacement for every workflow served by Figma. The product is intentionally narrower in scope and optimized for speed, simplicity, collaboration, and self-hostability.

---

## **2\. Product thesis**

### **Thesis statement**

OpenMirage helps small startup product teams go from collaborative wireframes to buildable UI screens faster than Figma and with more structure than whiteboards, in a tool they can self-host and use freely.

### **Supporting thesis**

OpenMirage exists to solve two linked problems:

1. **Workflow problem**  
   Teams often use rough ideation tools such as Excalidraw or Miro for early exploration, but those tools do not transition cleanly into real UI design. They then move into Figma, which is powerful but often heavier and more complex than needed for early-to-mid-stage product design.  
2. **Ownership and accessibility problem**  
   Technical startup teams benefit from tools they can run themselves, understand operationally, and adopt without significant cost. Open source and self-hosting are therefore part of the product strategy, not just licensing decisions.

### **Product promise**

OpenMirage should provide:

* more structure than a whiteboard,  
* less overhead than Figma,  
* real-time collaboration by default,  
* sufficient fidelity for real product UI,  
* and lightweight developer handoff.

---

## **3\. Target user and wedge**

### **Primary target user**

Small startup product teams.

### **Team profile**

* Typical team size: **3–8 people**  
* Typical participants: **designer, product manager, engineer**  
* Current tools: **Figma for serious design; Excalidraw and/or Miro for rough ideation**

### **Initial wedge**

The first product wedge is not large design organizations, enterprise design systems, agencies, or brand teams. The first wedge is startup product teams that need to collaborate on real UI quickly without adopting the full complexity of a heavyweight design suite.

### **Why this wedge**

This user segment has:

* an immediate collaboration need,  
* a real need to bridge rough ideation and actual product UI,  
* a higher likelihood of valuing self-hosting and open source,  
* and a lower requirement for enterprise administration, workflow depth, and ecosystem breadth.

---

## **4\. Core job-to-be-done**

### **Primary job-to-be-done**

Teams use OpenMirage to collaboratively create real UI screens and wireframes, then hand them to engineers with enough structure to build.

### **First-session proof of value**

The first meaningful value should be visible in the first collaborative session:

1. create a screen quickly,  
2. invite another person,  
3. collaborate live in the same canvas,  
4. produce something structured enough to continue toward implementation.

### **Problem being solved**

The product is explicitly addressing the following user frustration:

Rough ideation tools do not transition cleanly into real UI, and Figma is too heavy for early product design.

This statement should guide product decisions and prevent drift toward either a pure whiteboard or full Figma parity.

---

## **5\. Product positioning**

### **Positioning statement**

OpenMirage is a faster, simpler, self-hostable collaborative UI design workspace for startup product teams. It gives teams more structure than whiteboards and less overhead than Figma, while remaining good enough for real UI design and developer handoff.

### **Category framing**

OpenMirage may be described externally as an open-source Figma-like tool, but internally that framing should be used cautiously. The product strategy is not feature parity with Figma. The strategy is a narrower and more defensible position:

* collaborative product UI design,  
* early-to-mid-stage workflow fit,  
* lightweight handoff,  
* self-hostable deployment,  
* and operational simplicity.

### **Competitive answer to “Why not Figma?”**

Because OpenMirage is lighter, faster, easier to own, and better suited to early product design collaboration without forcing teams into the full complexity of Figma.

---

## **6\. Strategic intent**

### **Primary strategic objective**

Create a technically credible, genuinely useful, open-source product that startup teams can adopt for free.

### **Secondary strategic objective**

Build reputation and goodwill by shipping a serious collaborative design tool that demonstrates strong technical execution.

### **Important implication**

Open source and self-hosting are **core reasons to adopt**, not incidental attributes. This means the product should:

* be deployable with modest infrastructure,  
* avoid unnecessary managed-service dependency,  
* remain operationally understandable to technical teams,  
* and preserve a path for community use and contribution.

---

## **7\. MVP scope**

The MVP should include only what is necessary to fulfill the core product thesis.

### **7.1 Core editing capabilities**

The MVP must support creation and editing of mid-fidelity UI screens through:

* frames,  
* basic shapes,  
* text,  
* selection,  
* move and resize interactions,  
* z-order / layering,  
* zoom and pan,  
* undo and redo.

These capabilities are the minimum required for producing structured UI rather than rough sketches alone.

### **7.2 Realtime collaboration**

The MVP must support:

* live co-editing,  
* multiplayer presence,  
* live cursor and/or participant awareness,  
* basic conflict-safe collaboration behavior,  
* comments.

Realtime collaboration is central to the product thesis and is not an optional enhancement.

### **7.3 Developer handoff**

The MVP must support lightweight handoff through:

* a basic inspect panel,  
* dimensions and spacing visibility,  
* color values,  
* typography values,  
* asset export,  
* basic export of designs.

The goal is not full engineering workflow integration. The goal is to provide enough structured information for an engineer to begin implementation without ambiguity.

### **7.4 Fidelity target**

The MVP should support **mid-fidelity product UI**.

It should be possible to create plausible, structured application screens. The target is above lo-fi wireframes but below full visual design parity with mature professional design suites.

---

## **8\. Supporting MVP capabilities**

The following capabilities were not selected as the primary top-line MVP requirements, but are recommended because they materially improve product coherence:

* image placement,  
* grouping,  
* alignment and distribution,  
* share or read-only links.

These features should be considered supporting scope if they can be delivered without distorting the MVP.

---

## **9\. Explicit non-goals for MVP**

The following are out of scope for the MVP:

* advanced prototyping and animations,  
* plugin ecosystem,  
* branching and advanced version-management UI,  
* enterprise admin and SSO,  
* advanced auto layout parity with Figma,  
* full design token pipelines,  
* code generation,  
* native desktop application,  
* strong offline-first guarantees beyond basic resilience,  
* enterprise governance and compliance workflows,  
* polished visual design parity with Figma,  
* marketing and brand-design workflows.

### **Additional recommended non-goal**

Full component-system sophistication should also be treated as out of scope for the MVP. A minimal reusable structure may be added later if it fits cleanly within the editor model, but a rich components-and-variants system is likely to create disproportionate complexity too early.

---

## **10\. Product boundaries**

### **What OpenMirage is**

* a collaborative UI design workspace,  
* optimized for product teams,  
* intended for browser-based use,  
* self-hostable,  
* suitable for early-to-mid-stage product design,  
* and capable of lightweight developer handoff.

### **What OpenMirage is not**

* a general-purpose whiteboard,  
* a full enterprise design platform,  
* a marketing or brand design tool,  
* a complete Figma replacement for all use cases,  
* or an engineering automation platform.

---

## **11\. Success criteria for the MVP**

The MVP should be considered successful if a small startup product team can:

1. create a real product UI screen quickly,  
2. collaborate on it live with another team member,  
3. use comments to provide lightweight review context,  
4. and hand the result to an engineer with enough inspect/export support to begin implementation.

A stronger success criterion is not immediate replacement of Figma across all workflows. A realistic early success condition is that teams can use OpenMirage for early product design and collaborative screen definition without feeling forced to switch to Figma immediately.

---

## **12\. Product decision principles**

The following principles should guide MVP decisions:

1. **Prefer simplicity over breadth**  
   Avoid feature expansion that weakens speed, clarity, or operational simplicity.  
2. **Preserve the bridge between ideation and real UI**  
   The tool must not collapse into either a pure whiteboard or a heavyweight design suite.  
3. **Treat realtime collaboration as foundational**  
   Collaboration is part of the product’s identity, not a secondary enhancement.  
4. **Support self-hosting in practice, not just in theory**  
   Deployment and operations should be credible for technical teams.  
5. **Optimize for repeated team use, not just technical impressiveness**  
   The product must be genuinely useful, not merely a strong demo.

---

## **13\. Open questions to resolve next**

The following questions remain open and should be resolved before detailed implementation planning:

* whether minimal reusable components belong in MVP or immediately after MVP,  
* what exact comment model is needed for MVP,  
* the minimum viable inspect panel surface,  
* the minimum export formats required,  
* and the exact boundary between editor state, collaborative state, and persistent metadata.

---

## **14\. Summary**

OpenMirage is a self-hostable collaborative UI design workspace for startup product teams. Its purpose is to help teams move from rough concepts to buildable UI screens faster than Figma and with more structure than whiteboards. The MVP should focus on mid-fidelity UI editing, live collaboration, comments, and lightweight developer handoff, while explicitly avoiding parity-driven scope expansion.