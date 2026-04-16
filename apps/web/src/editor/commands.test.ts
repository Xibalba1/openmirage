import assert from "node:assert/strict";
import test from "node:test";
import { type GroupNode, type PageDocumentDto } from "@openmirage/types";
import { applyEditorCommand, getNodeBounds } from "./commands";

function createDocument(): PageDocumentDto {
  return {
    nodes: {
      frame: {
        background: {
          color: { alpha: 1, hex: "#ffffff" }
        },
        childIds: ["rect", "text"],
        clipsContent: false,
        cornerRadius: 16,
        createdAt: "2026-04-15T00:00:00.000Z",
        height: 300,
        id: "frame",
        locked: false,
        name: "Frame",
        opacity: 1,
        pageId: "page-1",
        parentId: null,
        rotation: 0,
        stroke: null,
        type: "frame",
        updatedAt: "2026-04-15T00:00:00.000Z",
        visible: true,
        width: 400,
        x: 40,
        y: 60,
        zIndex: 0
      },
      group: {
        childIds: ["ellipse"],
        createdAt: "2026-04-15T00:00:00.000Z",
        height: 100,
        id: "group",
        locked: false,
        name: "Group",
        opacity: 1,
        pageId: "page-1",
        parentId: null,
        rotation: 0,
        type: "group",
        updatedAt: "2026-04-15T00:00:00.000Z",
        visible: true,
        width: 120,
        x: 520,
        y: 80,
        zIndex: 1
      },
      ellipse: {
        createdAt: "2026-04-15T00:00:00.000Z",
        fill: {
          color: { alpha: 1, hex: "#5fabc0" }
        },
        height: 80,
        id: "ellipse",
        locked: false,
        name: "Ellipse",
        opacity: 1,
        pageId: "page-1",
        parentId: "group",
        rotation: 0,
        shadow: null,
        stroke: null,
        type: "ellipse",
        updatedAt: "2026-04-15T00:00:00.000Z",
        visible: true,
        width: 80,
        x: 20,
        y: 10,
        zIndex: 0
      },
      line: {
        createdAt: "2026-04-15T00:00:00.000Z",
        height: 4,
        id: "line",
        locked: false,
        name: "Line",
        opacity: 1,
        pageId: "page-1",
        parentId: null,
        rotation: 0,
        stroke: {
          color: { alpha: 1, hex: "#111111" },
          width: 4
        },
        type: "line",
        updatedAt: "2026-04-15T00:00:00.000Z",
        visible: true,
        width: 120,
        x: 700,
        x2: 820,
        y: 120,
        y2: 120,
        zIndex: 2
      },
      rect: {
        cornerRadius: 12,
        createdAt: "2026-04-15T00:00:00.000Z",
        fill: {
          color: { alpha: 1, hex: "#f5a24a" }
        },
        height: 100,
        id: "rect",
        locked: false,
        name: "Rectangle",
        opacity: 1,
        pageId: "page-1",
        parentId: "frame",
        rotation: 0,
        shadow: null,
        stroke: null,
        type: "rectangle",
        updatedAt: "2026-04-15T00:00:00.000Z",
        visible: true,
        width: 140,
        x: 20,
        y: 20,
        zIndex: 0
      },
      text: {
        content: "Hello",
        createdAt: "2026-04-15T00:00:00.000Z",
        height: 36,
        id: "text",
        locked: false,
        name: "Text",
        opacity: 1,
        pageId: "page-1",
        parentId: "frame",
        rotation: 0,
        typography: {
          color: { alpha: 1, hex: "#132c35" },
          fontFamily: "IBM Plex Sans",
          fontSize: 20,
          fontWeight: 500,
          lineHeight: 28,
          textAlign: "left"
        },
        type: "text",
        updatedAt: "2026-04-15T00:00:00.000Z",
        visible: true,
        width: 180,
        x: 180,
        y: 40,
        zIndex: 1
      }
    },
    pageId: "page-1",
    rootNodeIds: ["frame", "group", "line"]
  };
}

test("create-node inserts a child into the requested container and normalizes sibling order", () => {
  const next = applyEditorCommand(createDocument(), {
    index: 1,
    node: {
      cornerRadius: 8,
      createdAt: "2026-04-15T01:00:00.000Z",
      fill: {
        color: { alpha: 1, hex: "#222222" }
      },
      height: 40,
      id: "rect-2",
      locked: false,
      name: "Rectangle 2",
      opacity: 1,
      pageId: "page-1",
      parentId: "frame",
      rotation: 0,
      shadow: null,
      stroke: null,
      type: "rectangle",
      updatedAt: "2026-04-15T01:00:00.000Z",
      visible: true,
      width: 60,
      x: 80,
      y: 80,
      zIndex: 99
    },
    pageId: "page-1",
    parentId: "frame",
    type: "create-node"
  });

  const frame = next.nodes.frame;

  if (!frame || frame.type !== "frame") {
    throw new Error("expected frame");
  }

  assert.deepEqual(frame.childIds, [
    "rect",
    "rect-2",
    "text"
  ]);
  assert.equal(next.nodes["rect-2"]?.parentId, "frame");
  assert.equal(next.nodes["rect-2"]?.zIndex, 1);
  assert.equal(next.nodes.text?.zIndex, 2);
});

test("move-node and resize-node update rectangle and line geometry", () => {
  const moved = applyEditorCommand(createDocument(), {
    pageId: "page-1",
    type: "move-node",
    updates: [
      {
        height: 100,
        nodeId: "rect",
        width: 140,
        x: 50,
        y: 60
      },
      {
        height: 4,
        nodeId: "line",
        width: 120,
        x: 720,
        x2: 840,
        y: 140,
        y2: 140
      }
    ]
  });
  const resized = applyEditorCommand(moved, {
    nodeId: "rect",
    pageId: "page-1",
    type: "resize-node",
    updates: [
      {
        height: 180,
        nodeId: "rect",
        width: 200,
        x: 30,
        y: 30
      }
    ]
  });

  const line = resized.nodes.line;

  if (!line || line.type !== "line") {
    throw new Error("expected line");
  }

  assert.equal(resized.nodes.rect?.x, 30);
  assert.equal(resized.nodes.rect?.height, 180);
  assert.equal(line.x2, 840);
  assert.equal(line.width, 120);
});

test("reorder-node updates root ordering and sibling z-indexes", () => {
  const next = applyEditorCommand(createDocument(), {
    index: 0,
    nodeId: "line",
    pageId: "page-1",
    parentId: null,
    type: "reorder-node"
  });

  assert.deepEqual(next.rootNodeIds, ["line", "frame", "group"]);
  assert.equal(next.nodes.line?.zIndex, 0);
  assert.equal(next.nodes.frame?.zIndex, 1);
});

test("group-nodes and ungroup-node preserve absolute positions", () => {
  const original = createDocument();
  const rectBounds = getNodeBounds(original, "rect");
  const textBounds = getNodeBounds(original, "text");
  const groupCommand = {
    group: {
      childIds: [],
      createdAt: "2026-04-15T02:00:00.000Z",
      height: 1,
      id: "group-2",
      locked: false,
      name: "Selection Group",
      opacity: 1,
      pageId: "page-1",
      parentId: "frame",
      rotation: 0,
      type: "group",
      updatedAt: "2026-04-15T02:00:00.000Z",
      visible: true,
      width: 1,
      x: 0,
      y: 0,
      zIndex: 0
    } satisfies GroupNode,
    index: null,
    nodeIds: ["rect", "text"],
    pageId: "page-1",
    type: "group-nodes" as const
  };
  const grouped = applyEditorCommand(original, groupCommand);
  const ungrouped = applyEditorCommand(grouped, {
    nodeId: "group-2",
    pageId: "page-1",
    type: "ungroup-node"
  });

  assert.deepEqual(getNodeBounds(grouped, "rect"), rectBounds);
  assert.deepEqual(getNodeBounds(grouped, "text"), textBounds);
  assert.deepEqual(getNodeBounds(ungrouped, "rect"), rectBounds);
  assert.deepEqual(getNodeBounds(ungrouped, "text"), textBounds);
  assert.equal(ungrouped.nodes["group-2"], undefined);
});

test("delete-node removes container subtrees recursively", () => {
  const next = applyEditorCommand(createDocument(), {
    nodeIds: ["group"],
    pageId: "page-1",
    type: "delete-node"
  });

  assert.equal(next.nodes.group, undefined);
  assert.equal(next.nodes.ellipse, undefined);
  assert.deepEqual(next.rootNodeIds, ["frame", "line"]);
});

test("locked ancestors block structural edits but allow lock and visibility toggles", () => {
  const document = createDocument();
  const frame = document.nodes.frame;

  if (!frame || frame.type !== "frame") {
    throw new Error("expected frame");
  }

  frame.locked = true;
  const blockedMove = applyEditorCommand(document, {
    pageId: "page-1",
    type: "move-node",
    updates: [
      {
        height: 100,
        nodeId: "rect",
        width: 140,
        x: 80,
        y: 90
      }
    ]
  });
  const unlocked = applyEditorCommand(document, {
    nodeId: "frame",
    pageId: "page-1",
    patch: {
      locked: false
    },
    type: "update-node"
  });
  const hidden = applyEditorCommand(unlocked, {
    nodeId: "rect",
    pageId: "page-1",
    patch: {
      visible: false
    },
    type: "update-node"
  });

  assert.equal(blockedMove.nodes.rect?.x, 20);
  assert.equal(unlocked.nodes.frame?.locked, false);
  assert.equal(hidden.nodes.rect?.visible, false);
});
