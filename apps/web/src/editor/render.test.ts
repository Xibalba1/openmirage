import assert from "node:assert/strict";
import test from "node:test";
import { type PageDocumentDto, type PageDto } from "@openmirage/types";
import { renderSceneToCanvas } from "./render";
import { createPaintRecords, hydratePageDocument } from "./scene";

class FakeCanvasContext {
  drawImageCalls = 0;
  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  globalAlpha = 1;
  lineWidth = 1;
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000000";
  quadraticCurveCalls = 0;

  beginPath(): void {}
  clip(): void {}
  clearRect(): void {}
  closePath(): void {}
  drawImage(): void {
    this.drawImageCalls += 1;
  }
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
        {},
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

test("renderSceneToCanvas draws resolved images when available", () => {
  const context = new FakeCanvasContext();
  const canvas = new FakeCanvas(context);
  const scene = hydratePageDocument(page, {
    nodes: {
      image: {
        assetId: "asset-1",
        createdAt: "2026-04-15T00:00:00.000Z",
        fitMode: "cover",
        height: 180,
        id: "image",
        locked: false,
        name: "Image",
        opacity: 1,
        pageId: "page-1",
        parentId: null,
        rotation: 0,
        type: "image",
        updatedAt: "2026-04-15T00:00:00.000Z",
        visible: true,
        width: 240,
        x: 80,
        y: 100,
        zIndex: 0
      }
    },
    pageId: "page-1",
    rootNodeIds: ["image"]
  });
  const records = createPaintRecords(scene);
  const originalWindow = globalThis.window;

  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        devicePixelRatio: 1
      }
    });
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
        "asset-1": {
          height: 20,
          width: 20
        } as unknown as CanvasImageSource
      },
      {
        hoveredId: null,
        marquee: null,
        primarySelectionId: null,
        selectedIds: []
      }
    );
    assert.equal(context.drawImageCalls, 1);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
  }
});
