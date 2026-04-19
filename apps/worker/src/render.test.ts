import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { type PageDocumentDto, type PageDto, hydratePageDocument } from "@openmirage/types";

import {
  renderSceneToPng,
  renderScenesToPdf,
  resolveBrowserExecutable
} from "./render.js";

const page: PageDto = {
  background: "#ffffff",
  createdAt: "2026-04-18T00:00:00.000Z",
  fileId: "file-1",
  height: 720,
  id: "page-1",
  name: "Worker Export Page",
  orderIndex: 0,
  updatedAt: "2026-04-18T00:00:00.000Z",
  width: 1280
};

function createDocument(): PageDocumentDto {
  return {
    nodes: {
      "rect-1": {
        cornerRadius: 20,
        createdAt: "2026-04-18T00:00:00.000Z",
        fill: {
          color: { alpha: 1, hex: "#f5a24a" }
        },
        height: 240,
        id: "rect-1",
        locked: false,
        name: "Hero",
        opacity: 1,
        pageId: page.id,
        parentId: null,
        rotation: 0,
        shadow: null,
        stroke: null,
        type: "rectangle",
        updatedAt: "2026-04-18T00:00:00.000Z",
        visible: true,
        width: 360,
        x: 64,
        y: 72,
        zIndex: 0
      },
      "text-1": {
        content: "OpenMirage",
        createdAt: "2026-04-18T00:00:00.000Z",
        height: 64,
        id: "text-1",
        locked: false,
        name: "Title",
        opacity: 1,
        pageId: page.id,
        parentId: null,
        rotation: 0,
        typography: {
          color: { alpha: 1, hex: "#121212" },
          fontFamily: "Arial",
          fontSize: 48,
          fontWeight: 600,
          lineHeight: 1.2,
          textAlign: "left"
        },
        type: "text",
        updatedAt: "2026-04-18T00:00:00.000Z",
        visible: true,
        width: 400,
        x: 84,
        y: 108,
        zIndex: 1
      }
    },
    pageId: page.id,
    rootNodeIds: ["rect-1", "text-1"]
  };
}

async function createFakeBrowserExecutable() {
  const directory = await fs.mkdtemp(join(tmpdir(), "openmirage-fake-browser-"));
  const browserPath = join(directory, "fake-browser.mjs");
  const script = `#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("FakeBrowser 1.0.0\\n");
  process.exit(0);
}

const screenshotArg = args.find((arg) => arg.startsWith("--screenshot="));
if (screenshotArg) {
  await writeFile(screenshotArg.slice("--screenshot=".length), Buffer.from("png-bytes"));
  process.exit(0);
}

const pdfArg = args.find((arg) => arg.startsWith("--print-to-pdf="));
if (pdfArg) {
  await writeFile(pdfArg.slice("--print-to-pdf=".length), Buffer.from("pdf-bytes"));
  process.exit(0);
}

process.exit(1);
`;

  await fs.writeFile(browserPath, script, "utf8");
  await fs.chmod(browserPath, 0o755);

  return {
    async cleanup() {
      await fs.rm(directory, { force: true, recursive: true });
    },
    browserPath
  };
}

test("render helpers discover an executable browser and return output bytes", async () => {
  const fakeBrowser = await createFakeBrowserExecutable();

  try {
    assert.equal(await resolveBrowserExecutable(fakeBrowser.browserPath), fakeBrowser.browserPath);

    const scene = hydratePageDocument(page, createDocument());
    const png = await renderSceneToPng({
      browserPath: fakeBrowser.browserPath,
      height: scene.height,
      scene,
      timeoutMs: 2_000,
      width: scene.width
    });
    const pdf = await renderScenesToPdf({
      browserPath: fakeBrowser.browserPath,
      scenes: [scene],
      timeoutMs: 2_000
    });

    assert.deepEqual(Buffer.from(png).toString("utf8"), "png-bytes");
    assert.deepEqual(Buffer.from(pdf).toString("utf8"), "pdf-bytes");
  } finally {
    await fakeBrowser.cleanup();
  }
});
