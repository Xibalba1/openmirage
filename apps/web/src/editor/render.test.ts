import assert from "node:assert/strict";
import test from "node:test";
import { type PageDocumentDto, type PageDto } from "@openmirage/types";
import { renderSceneToCanvas } from "./render";
import { createPaintRecords, hydratePageDocument } from "./scene";

class FakeCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  globalAlpha = 1;
  lineWidth = 1;
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000000";
  quadraticCurveCalls = 0;

  beginPath(): void {}
  clearRect(): void {}
  closePath(): void {}
  ellipse(): void {}
  fill(): void {}
  fillRect(): void {}
  fillText(): void {}
  lineTo(): void {}
  moveTo(): void {}
  quadraticCurveTo(): void {
    this.quadraticCurveCalls += 1;
  }
  rect(): void {}
  restore(): void {}
  rotate(): void {}
  save(): void {}
  scale(): void {}
  setLineDash(): void {}
  setTransform(): void {}
  stroke(): void {}
  strokeRect(): void {}
  translate(): void {}
}

class FakeCanvas {
  clientHeight = 600;
  clientWidth = 800;
  height = 0;
  width = 0;

  constructor(private readonly context: FakeCanvasContext) {}

  getContext(kind: string): FakeCanvasContext | null {
    return kind === "2d" ? this.context : null;
  }
}

const page: PageDto = {
  background: "#ffffff",
  createdAt: "2026-04-15T00:00:00.000Z",
  fileId: "file-1",
  height: 800,
  id: "page-1",
  name: "Render Test Page",
  orderIndex: 0,
  updatedAt: "2026-04-15T00:00:00.000Z",
  width: 1200
};

function createDocument(): PageDocumentDto {
  return {
    nodes: {
      rect: {
        cornerRadius: 18,
        createdAt: "2026-04-15T00:00:00.000Z",
        fill: {
          color: { alpha: 1, hex: "#f5a24a" }
        },
        height: 120,
        id: "rect",
        locked: false,
        name: "Rectangle",
        opacity: 1,
        pageId: "page-1",
        parentId: null,
        rotation: 0,
        shadow: null,
        stroke: {
          color: { alpha: 1, hex: "#5fabc0" },
          width: 2
        },
        type: "rectangle",
        updatedAt: "2026-04-15T00:00:00.000Z",
        visible: true,
        width: 160,
        x: 80,
        y: 100,
        zIndex: 0
      }
    },
    pageId: "page-1",
    rootNodeIds: ["rect"]
  };
}

test("renderSceneToCanvas falls back when roundRect is unavailable", () => {
  const context = new FakeCanvasContext();
  const canvas = new FakeCanvas(context);
  const scene = hydratePageDocument(page, createDocument());
  const records = createPaintRecords(scene);
  const originalWindow = globalThis.window;

  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        devicePixelRatio: 1
      }
    });
    assert.doesNotThrow(() => {
      renderSceneToCanvas(
        canvas as unknown as HTMLCanvasElement,
        { panX: 0, panY: 0, zoom: 1 },
        {
          background: scene.background,
          height: scene.height,
          width: scene.width
        },
        records,
        {
          hoveredId: null,
          marquee: null,
          primarySelectionId: null,
          selectedIds: []
        }
      );
    });
    assert.ok(context.quadraticCurveCalls > 0);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
  }
});
