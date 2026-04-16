import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";
import { createEditorSession, writePageDocument } from "./session";

function createDocument() {
  return {
    nodes: {
      rect: {
        cornerRadius: 8,
        createdAt: "2026-04-15T00:00:00.000Z",
        fill: {
          color: { alpha: 1, hex: "#f5a24a" }
        },
        height: 80,
        id: "rect",
        locked: false,
        name: "Rectangle",
        opacity: 1,
        pageId: "page-1",
        parentId: null,
        rotation: 0,
        shadow: null,
        stroke: null,
        type: "rectangle" as const,
        updatedAt: "2026-04-15T00:00:00.000Z",
        visible: true,
        width: 120,
        x: 20,
        y: 30,
        zIndex: 0
      }
    },
    pageId: "page-1",
    rootNodeIds: ["rect"]
  };
}

test("editor session commit, undo, and redo track one local command at a time", () => {
  const doc = new Y.Doc();
  writePageDocument(doc, createDocument());
  const session = createEditorSession({ doc, pageId: "page-1" });

  try {
    assert.equal(session.getSnapshot().canUndo, false);
    assert.equal(
      session.commit({
        pageId: "page-1",
        type: "move-node",
        updates: [
          {
            height: 80,
            nodeId: "rect",
            width: 120,
            x: 80,
            y: 90
          }
        ]
      }),
      true
    );
    assert.equal(session.getSnapshot().document.nodes.rect?.x, 80);
    assert.equal(session.getSnapshot().canUndo, true);
    assert.equal(session.undo(), true);
    assert.equal(session.getSnapshot().document.nodes.rect?.x, 20);
    assert.equal(session.getSnapshot().canRedo, true);
    assert.equal(session.redo(), true);
    assert.equal(session.getSnapshot().document.nodes.rect?.x, 80);
  } finally {
    session.destroy();
  }
});

test("remote document updates refresh the snapshot without adding local history", () => {
  const doc = new Y.Doc();
  writePageDocument(doc, createDocument());
  const session = createEditorSession({ doc, pageId: "page-1" });

  try {
    session.commit({
      pageId: "page-1",
      type: "move-node",
      updates: [
        {
          height: 80,
          nodeId: "rect",
          width: 120,
          x: 60,
          y: 70
        }
      ]
    });
    writePageDocument(doc, {
      ...createDocument(),
      nodes: {
        rect: {
          ...createDocument().nodes.rect,
          x: 140,
          y: 150
        }
      }
    });

    assert.equal(session.getSnapshot().document.nodes.rect?.x, 140);
    assert.equal(session.getSnapshot().canUndo, true);
    assert.equal(session.getSnapshot().canRedo, false);
  } finally {
    session.destroy();
  }
});
