import assert from "node:assert/strict";
import test from "node:test";
import { type PageDocumentDto } from "@openmirage/types";
import { deriveInspectDetails } from "./inspect";

function createDocument(): PageDocumentDto {
  return {
    nodes: {
      frame: {
        background: {
          color: { alpha: 1, hex: "#ffffff" }
        },
        childIds: ["rect", "text", "image"],
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
      image: {
        assetId: "asset-1",
        createdAt: "2026-04-15T00:00:00.000Z",
        fitMode: "cover",
        height: 72,
        id: "image",
        locked: false,
        name: "Hero image",
        opacity: 1,
        pageId: "page-1",
        parentId: "frame",
        rotation: 0,
        type: "image",
        updatedAt: "2026-04-15T00:00:00.000Z",
        visible: true,
        width: 72,
        x: 280,
        y: 200,
        zIndex: 2
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
        zIndex: 1
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
    rootNodeIds: ["frame", "line"]
  };
}

test("deriveInspectDetails returns dimensions, spacing, and color for rectangles", () => {
  const details = deriveInspectDetails(createDocument(), "rect");

  assert.ok(details);
  assert.equal(details?.sections.find((section) => section.title === "Spacing")?.fields[0]?.value, "20");
  assert.equal(
    details?.sections.find((section) => section.title === "Color")?.fields[0]?.value,
    "#f5a24a · 100%"
  );
});

test("deriveInspectDetails returns typography for text nodes", () => {
  const details = deriveInspectDetails(createDocument(), "text");

  assert.ok(details);
  assert.equal(
    details?.sections.find((section) => section.title === "Typography")?.fields[0]?.value,
    "IBM Plex Sans"
  );
});

test("deriveInspectDetails returns line endpoints and stroke width for lines", () => {
  const details = deriveInspectDetails(createDocument(), "line");
  const dimensions = details?.sections.find(
    (section) => section.title === "Dimensions"
  );

  assert.ok(dimensions);
  assert.ok(dimensions?.fields.some((field) => field.label === "X2" && field.value === "820"));
  assert.ok(
    dimensions?.fields.some(
      (field) => field.label === "Stroke width" && field.value === "4"
    )
  );
});

test("deriveInspectDetails omits typography and color sections when a node has none", () => {
  const details = deriveInspectDetails(createDocument(), "image");

  assert.ok(details);
  assert.equal(
    details?.sections.some((section) => section.title === "Typography"),
    false
  );
  assert.equal(
    details?.sections.some((section) => section.title === "Color"),
    false
  );
});
