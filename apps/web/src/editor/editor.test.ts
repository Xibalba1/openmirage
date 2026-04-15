import assert from "node:assert/strict";
import test from "node:test";
import { type PageDocumentDto, type PageDto } from "@openmirage/types";
import { hitTestPaintRecords } from "./hit-test";
import { createPaintRecords, flattenSceneInPaintOrder, hydratePageDocument } from "./scene";
import { pagePointToScreenPoint, screenPointToPagePoint, zoomViewportAtPoint } from "./viewport";

const page: PageDto = {
  background: "#ffffff",
  createdAt: "2026-04-15T00:00:00.000Z",
  fileId: "file-1",
  height: 800,
  id: "page-1",
  name: "Editor Page",
  orderIndex: 0,
  updatedAt: "2026-04-15T00:00:00.000Z",
  width: 1200
};

function createDocument(): PageDocumentDto {
  return {
    nodes: {
      "frame-1": {
        background: {
          color: { alpha: 1, hex: "#ffffff" }
        },
        childIds: ["rect-1", "ellipse-1"],
        clipsContent: false,
        cornerRadius: 24,
        createdAt: "2026-04-15T00:00:00.000Z",
        height: 300,
        id: "frame-1",
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
      "rect-1": {
        cornerRadius: 16,
        createdAt: "2026-04-15T00:00:00.000Z",
        fill: {
          color: { alpha: 1, hex: "#f5a24a" }
        },
        height: 100,
        id: "rect-1",
        locked: false,
        name: "Rectangle",
        opacity: 1,
        pageId: "page-1",
        parentId: "frame-1",
        rotation: 0,
        shadow: null,
        stroke: null,
        type: "rectangle",
        updatedAt: "2026-04-15T00:00:00.000Z",
        visible: true,
        width: 140,
        x: 24,
        y: 24,
        zIndex: 0
      },
      "ellipse-1": {
        createdAt: "2026-04-15T00:00:00.000Z",
        fill: {
          color: { alpha: 1, hex: "#5fabc0" }
        },
        height: 110,
        id: "ellipse-1",
        locked: false,
        name: "Ellipse",
        opacity: 1,
        pageId: "page-1",
        parentId: "frame-1",
        rotation: 0,
        shadow: null,
        stroke: null,
        type: "ellipse",
        updatedAt: "2026-04-15T00:00:00.000Z",
        visible: true,
        width: 110,
        x: 80,
        y: 40,
        zIndex: 1
      },
      "foreign-1": {
        cornerRadius: 0,
        createdAt: "2026-04-15T00:00:00.000Z",
        fill: null,
        height: 20,
        id: "foreign-1",
        locked: false,
        name: "Foreign",
        opacity: 1,
        pageId: "page-2",
        parentId: null,
        rotation: 0,
        shadow: null,
        stroke: null,
        type: "rectangle",
        updatedAt: "2026-04-15T00:00:00.000Z",
        visible: true,
        width: 20,
        x: 0,
        y: 0,
        zIndex: 0
      }
    },
    pageId: "page-1",
    rootNodeIds: ["frame-1", "missing-root"]
  };
}

test("hydratePageDocument normalizes nodes for the current page and repairs roots", () => {
  const scene = hydratePageDocument(page, createDocument());

  assert.deepEqual(scene.rootNodeIds, ["frame-1"]);
  assert.equal(scene.nodesById["foreign-1"], undefined);
  assert.equal(scene.nodesById["frame-1"]?.type, "frame");
  if (scene.nodesById["frame-1"]?.type !== "frame") {
    throw new Error("expected frame-1 to remain a frame");
  }
  assert.deepEqual(scene.nodesById["frame-1"].childIds, ["rect-1", "ellipse-1"]);
});

test("flattenSceneInPaintOrder keeps deterministic paint order", () => {
  const records = flattenSceneInPaintOrder(hydratePageDocument(page, createDocument()));

  assert.deepEqual(records.map((record) => record.node.id), [
    "frame-1",
    "rect-1",
    "ellipse-1"
  ]);
});

test("viewport transforms round-trip without mutating scene geometry", () => {
  const scene = hydratePageDocument(page, createDocument());
  const originalX = scene.nodesById["rect-1"]?.x;
  const viewport = zoomViewportAtPoint(
    { panX: 80, panY: 60, zoom: 1 },
    2,
    { x: 200, y: 160 }
  );
  const screen = pagePointToScreenPoint({ x: 50, y: 75 }, viewport);
  const pagePoint = screenPointToPagePoint(screen, viewport);

  assert.equal(scene.nodesById["rect-1"]?.x, originalX);
  assert.deepEqual(pagePoint, { x: 50, y: 75 });
});

test("hitTestPaintRecords returns the topmost visible unlocked node", () => {
  const scene = hydratePageDocument(page, createDocument());
  const records = createPaintRecords(scene);
  const hit = hitTestPaintRecords(records, { x: 155, y: 135 }, 1);

  assert.equal(hit?.node.id, "ellipse-1");
});

test("hitTestPaintRecords skips locked and hidden nodes and still works after zoom", () => {
  const document = createDocument();
  const ellipseNode = document.nodes["ellipse-1"];

  if (!ellipseNode || ellipseNode.type !== "ellipse") {
    throw new Error("expected ellipse node in fixture");
  }

  document.nodes["ellipse-1"] = {
    ...ellipseNode,
    locked: true,
    visible: false
  };
  const scene = hydratePageDocument(page, document);
  const records = createPaintRecords(scene);
  const hit = hitTestPaintRecords(records, { x: 90, y: 100 }, 2);

  assert.equal(hit?.node.id, "rect-1");
});
