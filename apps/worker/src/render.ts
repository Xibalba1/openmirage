import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  serializeSceneToSvg,
  type ExportImageSourceMap,
  type HydratedPageScene
} from "@openmirage/types";

const BROWSER_CANDIDATES = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "chromium-browser",
  "chromium",
  "google-chrome",
  "chrome"
];

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function buildSinglePageHtml(input: {
  height: number;
  svg: string;
  title: string;
  width: number;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: ${input.width}px;
        height: ${input.height}px;
        background: transparent;
        overflow: hidden;
      }

      body {
        display: grid;
        place-items: stretch;
      }

      svg {
        display: block;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>${input.svg}</body>
</html>`;
}

function buildPdfHtml(input: {
  pageHeight: number;
  pageWidth: number;
  pages: Array<{ svg: string; title: string }>;
}): string {
  const sections = input.pages
    .map(
      (page) => `<section class="export-page" aria-label="${escapeHtml(page.title)}">
  ${page.svg}
</section>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>OpenMirage export</title>
    <style>
      @page {
        margin: 0;
        size: ${input.pageWidth}px ${input.pageHeight}px;
      }

      html, body {
        margin: 0;
        padding: 0;
        background: white;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      body {
        display: flex;
        flex-direction: column;
        gap: 0;
      }

      .export-page {
        width: ${input.pageWidth}px;
        height: ${input.pageHeight}px;
        display: grid;
        place-items: center;
        page-break-after: always;
        overflow: hidden;
      }

      .export-page:last-child {
        page-break-after: auto;
      }

      svg {
        display: block;
        max-width: 100%;
        max-height: 100%;
      }
    </style>
  </head>
  <body>${sections}</body>
</html>`;
}

async function runBrowser(input: {
  browserPath: string;
  html: string;
  outputPath: string;
  timeoutMs: number;
  windowHeight: number;
  windowWidth: number;
  writeMode: "pdf" | "screenshot";
}): Promise<void> {
  const directory = await fs.mkdtemp(join(tmpdir(), "openmirage-export-"));
  const htmlPath = join(directory, "index.html");

  try {
    await fs.writeFile(htmlPath, input.html, "utf8");

    const args = [
      "--headless",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--allow-file-access-from-files",
      "--disable-web-security",
      "--no-sandbox",
      `--window-size=${Math.max(1, Math.ceil(input.windowWidth))},${Math.max(
        1,
        Math.ceil(input.windowHeight)
      )}`,
      input.writeMode === "pdf"
        ? `--print-to-pdf=${input.outputPath}`
        : `--screenshot=${input.outputPath}`,
      ...(input.writeMode === "pdf" ? ["--print-to-pdf-no-header"] : []),
      `file://${htmlPath}`
    ];

    await new Promise<void>((resolve, reject) => {
      const child = spawn(input.browserPath, args, {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stderr = "";
      let stdout = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`browser render timed out after ${input.timeoutMs}ms`));
      }, input.timeoutMs);

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);

        if (code === 0) {
          resolve();
          return;
        }

        reject(
          new Error(
            `browser render exited with code ${code}: ${
              stderr.trim() || stdout.trim() || "unknown error"
            }`
          )
        );
      });
    });
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
  }
}

export async function resolveBrowserExecutable(
  preferredPath?: string
): Promise<string | null> {
  const candidates = preferredPath
    ? [preferredPath, ...BROWSER_CANDIDATES]
    : BROWSER_CANDIDATES;

  for (const candidate of candidates) {
    try {
      const child = spawn(candidate, ["--version"], {
        stdio: "ignore"
      });
      const exitCode = await new Promise<number | null>((resolve) => {
        child.on("exit", (code) => resolve(code));
        child.on("error", () => resolve(null));
      });

      if (exitCode === 0) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function renderSceneToPng(input: {
  browserPath: string;
  height: number;
  images?: ExportImageSourceMap;
  scale?: number;
  scene: HydratedPageScene;
  timeoutMs: number;
  width: number;
}): Promise<Uint8Array> {
  const scale = input.scale ?? 1;
  const outputDirectory = await fs.mkdtemp(join(tmpdir(), "openmirage-png-"));
  const outputPath = join(outputDirectory, "export.png");

  try {
    const svg = serializeSceneToSvg(input.scene, input.images);
    await runBrowser({
      browserPath: input.browserPath,
      html: buildSinglePageHtml({
        height: input.height,
        svg,
        title: input.scene.page.name,
        width: input.width
      }),
      outputPath,
      timeoutMs: input.timeoutMs,
      windowHeight: input.height * scale,
      windowWidth: input.width * scale,
      writeMode: "screenshot"
    });

    return new Uint8Array(await fs.readFile(outputPath));
  } finally {
    await fs.rm(outputDirectory, { force: true, recursive: true });
  }
}

export async function renderScenesToPdf(input: {
  browserPath: string;
  imagesByPage?: Record<string, ExportImageSourceMap | undefined>;
  scenes: HydratedPageScene[];
  timeoutMs: number;
}): Promise<Uint8Array> {
  const outputDirectory = await fs.mkdtemp(join(tmpdir(), "openmirage-pdf-"));
  const outputPath = join(outputDirectory, "export.pdf");
  const pageWidth = Math.max(...input.scenes.map((scene) => scene.width));
  const pageHeight = Math.max(...input.scenes.map((scene) => scene.height));

  try {
    const pages = input.scenes.map((scene) => ({
      svg: serializeSceneToSvg(
        scene,
        input.imagesByPage?.[scene.page.id] ?? {}
      ),
      title: scene.page.name
    }));

    await runBrowser({
      browserPath: input.browserPath,
      html: buildPdfHtml({
        pageHeight,
        pageWidth,
        pages
      }),
      outputPath,
      timeoutMs: input.timeoutMs,
      windowHeight: pageHeight,
      windowWidth: pageWidth,
      writeMode: "pdf"
    });

    return new Uint8Array(await fs.readFile(outputPath));
  } finally {
    await fs.rm(outputDirectory, { force: true, recursive: true });
  }
}
