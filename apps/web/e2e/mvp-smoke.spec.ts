import { expect, test, type Page } from "@playwright/test";
import { createDatabasePool, PgCollabPersistence } from "@openmirage/db";

const SMOKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z0foAAAAASUVORK5CYII=",
  "base64"
);

interface StoredPageDocument {
  nodes: Record<string, Record<string, unknown>>;
  pageId: string;
  rootNodeIds: string[];
}

function createUniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`;
}

function parsePageRoute(url: string) {
  const match = new URL(url).pathname.match(
    /^\/app\/workspaces\/([^/]+)\/projects\/([^/]+)\/files\/([^/]+)\/pages\/([^/]+)$/
  );

  if (!match) {
    throw new Error(`expected page route, received ${url}`);
  }

  return {
    fileId: decodeURIComponent(match[3] ?? ""),
    pageId: decodeURIComponent(match[4] ?? ""),
    projectId: decodeURIComponent(match[2] ?? ""),
    workspaceId: decodeURIComponent(match[1] ?? "")
  };
}

async function readStoredPageDocument(
  pageId: string
): Promise<StoredPageDocument> {
  const pool = createDatabasePool();
  const persistence = new PgCollabPersistence(pool);

  try {
    const loaded = await persistence.loadPageDocument(pageId);
    const pageMap = loaded.document.getMap<unknown>("page");
    const raw = pageMap.toJSON() as Partial<StoredPageDocument>;

    return {
      nodes:
        typeof raw.nodes === "object" && raw.nodes
          ? (raw.nodes as StoredPageDocument["nodes"])
          : {},
      pageId,
      rootNodeIds: Array.isArray(raw.rootNodeIds)
        ? raw.rootNodeIds.filter(
            (entry): entry is string => typeof entry === "string"
          )
        : []
    };
  } finally {
    await pool.end();
  }
}

async function waitForStoredNodeCount(
  pageId: string,
  expectedMinimumCount: number
): Promise<void> {
  await expect
    .poll(async () => Object.keys((await readStoredPageDocument(pageId)).nodes).length, {
      timeout: 15_000
    })
    .toBeGreaterThanOrEqual(expectedMinimumCount);
}

async function ensureModePanelOpen(
  page: Page,
  toggleTestId: string,
  panelTestId: string
): Promise<void> {
  const toggle = page.getByTestId(toggleTestId);

  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }

  await expect(page.getByTestId(panelTestId)).toBeVisible();
}

test("local MVP browser smoke flow passes", async ({
  baseURL,
  browser,
  context,
  page
}) => {
  const projectName = createUniqueName("Sprint 10 Project");
  const fileName = createUniqueName("Sprint 10 File");
  const pageOneName = "Flow Page 1";
  const pageTwoName = "Flow Page 2";
  const pageThreeName = "Flow Page 3";
  const commentBody = "Sprint 10 browser smoke comment";

  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(baseURL ?? "http://127.0.0.1").origin
  });

  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: "Sign in to your workspace" })
  ).toBeVisible();

  await page.getByLabel("Email").fill("dev@openmirage.local");
  await page.getByRole("button", { name: "Send magic link" }).click();
  await expect(
    page.getByRole("link", { name: "Open development magic link" })
  ).toBeVisible();
  await page.getByRole("link", { name: "Open development magic link" }).click();

  await expect(
    page.getByRole("heading", { name: "Workspace launchpad" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "OpenMirage Dev" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("openmirage.activeWorkspaceId"))
    )
    .not.toBeNull();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByPlaceholder("New project name").fill(projectName);
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByText(projectName)).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
  const projectSection = page.locator(".launchpad-project-section", {
    has: page.getByRole("heading", { name: projectName })
  });
  await projectSection.getByRole("button", { name: "New file" }).click();
  await projectSection.getByPlaceholder("New file name").fill(fileName);
  await projectSection.locator(".page-grid input").nth(0).fill(pageOneName);
  await projectSection.locator(".page-grid input").nth(1).fill(pageTwoName);
  await projectSection.getByRole("button", { name: "Create file" }).click();

  await expect(page.getByText(fileName)).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
  const fileCard = page.locator(".launchpad-file-card", {
    has: page.getByText(fileName)
  });
  await fileCard.getByRole("button", { name: "Open" }).click();

  await expect(page).toHaveURL(/\/pages\//);
  await expect(page.getByText("Collab: connected")).toBeVisible({
    timeout: 30_000
  });
  await expect(page.getByTestId("left-rail")).toHaveCount(0);
  await expect(page.getByTestId("right-panel")).toHaveCount(0);

  const canvas = page.getByTestId("editor-canvas");
  const canvasBeforeOverlays = await canvas.boundingBox();

  if (!canvasBeforeOverlays) {
    throw new Error("expected editor canvas bounds");
  }

  await ensureModePanelOpen(page, "left-rail-toggle-pages", "left-rail");
  const canvasAfterLeftRail = await canvas.boundingBox();
  expect(canvasAfterLeftRail?.width).toBeCloseTo(canvasBeforeOverlays.width, 4);
  expect(canvasAfterLeftRail?.height).toBeCloseTo(canvasBeforeOverlays.height, 4);

  await ensureModePanelOpen(page, "right-panel-toggle-inspect", "right-panel");
  const canvasAfterRightPanel = await canvas.boundingBox();
  expect(canvasAfterRightPanel?.width).toBeCloseTo(canvasBeforeOverlays.width, 4);
  expect(canvasAfterRightPanel?.height).toBeCloseTo(canvasBeforeOverlays.height, 4);

  const pageOneRoute = parsePageRoute(page.url());

  await page.getByRole("button", { name: "Rectangle" }).click();
  await page.getByRole("button", { name: "Text" }).click();
  await expect(page.getByText("Metadata")).toBeVisible();
  await ensureModePanelOpen(page, "left-rail-toggle-layers", "left-rail");
  await expect(
    page.locator(".layer-list .layer-label", { hasText: "Rectangle" }).first()
  ).toBeVisible();

  const launchpadUrl = new URL("/app", page.url()).toString();
  await page.goto(launchpadUrl);
  await expect(
    page.getByRole("heading", { name: "Workspace launchpad" })
  ).toBeVisible();
  await fileCard.getByRole("button", { name: "Browse pages" }).click();
  await expect(fileCard.getByText(pageTwoName)).toBeVisible();
  await fileCard.getByRole("button", { name: "New page" }).click();
  await fileCard.getByPlaceholder("New page name").fill(pageThreeName);
  await fileCard.getByRole("button", { name: "Create page" }).click();
  await expect(fileCard).toContainText("3 pages");
  const browsePagesButton = fileCard.getByRole("button", {
    name: /Browse pages|Hide pages/
  });

  if ((await browsePagesButton.textContent())?.includes("Browse pages")) {
    await browsePagesButton.click();
  }

  await expect(fileCard.getByText(pageThreeName)).toBeVisible();
  await fileCard
    .locator(".resource-row-inline", { hasText: pageTwoName })
    .getByRole("button", { name: "Open page" })
    .click();

  await expect(page).toHaveURL(/\/pages\//);
  const pageTwoRoute = parsePageRoute(page.url());
  await page.getByRole("button", { name: "Frame" }).click();
  await ensureModePanelOpen(page, "left-rail-toggle-layers", "left-rail");
  await expect(
    page.locator(".layer-list .layer-label", { hasText: "Frame" }).first()
  ).toBeVisible();
  await waitForStoredNodeCount(pageTwoRoute.pageId, 1);

  await page.reload();
  await expect(page.getByText("Collab: connected")).toBeVisible({
    timeout: 30_000
  });
  await ensureModePanelOpen(page, "left-rail-toggle-layers", "left-rail");
  await expect(
    page.locator(".layer-list .layer-label", { hasText: "Frame" }).first()
  ).toBeVisible();

  await ensureModePanelOpen(page, "left-rail-toggle-pages", "left-rail");
  await page.getByRole("button", { name: /Flow Page 1/ }).click();
  await expect(page).toHaveURL(new RegExp(`${pageOneRoute.pageId}$`));
  await ensureModePanelOpen(page, "left-rail-toggle-layers", "left-rail");
  await expect(
    page.locator(".layer-list .layer-label", { hasText: "Rectangle" }).first()
  ).toBeVisible();

  const collaboratorContext = await browser.newContext({
    storageState: await context.storageState()
  });
  const collaboratorPage = await collaboratorContext.newPage();
  await collaboratorPage.goto(page.url());
  await expect(collaboratorPage.getByText("Collab: connected")).toBeVisible({
    timeout: 30_000
  });
  await expect
    .poll(async () => page.locator(".presence-strip .presence-chip").count())
    .toBeGreaterThan(1);

  const collaboratorCanvas = collaboratorPage.getByTestId("editor-canvas");
  const canvasBox = await collaboratorCanvas.boundingBox();

  if (!canvasBox) {
    throw new Error("expected collaborator canvas bounds");
  }

  await collaboratorCanvas.hover({
    position: {
      x: 80,
      y: 80
    }
  });
  await collaboratorCanvas.dispatchEvent("pointermove", {
    bubbles: true,
    clientX: canvasBox.x + 80,
    clientY: canvasBox.y + 80,
    composed: true,
    isPrimary: true,
    pointerId: 1,
    pointerType: "mouse"
  });
  await expect(page.getByTestId("remote-cursor")).toHaveCount(1, {
    timeout: 15_000
  });

  await collaboratorPage.getByRole("button", { name: "Ellipse" }).click();
  await expect(page.getByTestId("remote-selection")).toHaveCount(1, {
    timeout: 15_000
  });
  await ensureModePanelOpen(page, "left-rail-toggle-layers", "left-rail");
  await expect(
    page.locator(".layer-list .layer-label", { hasText: "Ellipse" }).first()
  ).toBeVisible({
    timeout: 15_000
  });
  await collaboratorContext.close();

  await ensureModePanelOpen(page, "left-rail-toggle-comments", "left-rail");
  await page.getByPlaceholder("Leave lightweight review context").fill(commentBody);
  await page.getByRole("button", { name: "Add comment" }).click();
  await expect(page.getByText(commentBody)).toBeVisible();
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByText(/Resolved/)).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    buffer: SMOKE_PNG,
    mimeType: "image/png",
    name: "smoke.png"
  });
  await ensureModePanelOpen(page, "left-rail-toggle-layers", "left-rail");
  await expect(
    page.locator(".layer-list .layer-label", { hasText: "Image" }).first()
  ).toBeVisible({
    timeout: 15_000
  });

  await page.reload();
  await expect(page.getByText("Collab: connected")).toBeVisible({
    timeout: 30_000
  });
  await ensureModePanelOpen(page, "left-rail-toggle-layers", "left-rail");
  await expect(
    page.locator(".layer-list .layer-label", { hasText: "Image" }).first()
  ).toBeVisible();

  const storedPage = await readStoredPageDocument(pageOneRoute.pageId);
  const storedPageJson = JSON.stringify(storedPage);
  const imageNodes = Object.values(storedPage.nodes).filter(
    (node) => node.type === "image"
  ) as Array<{ assetId?: unknown }>;

  expect(imageNodes.length).toBeGreaterThan(0);
  expect(typeof imageNodes[0]?.assetId).toBe("string");
  expect(storedPageJson).not.toContain(commentBody);
  expect(storedPageJson).not.toContain("data:image");

  await ensureModePanelOpen(page, "right-panel-toggle-share", "right-panel");
  await page.getByRole("button", { name: "Create share link" }).click();
  const shareLinkCard = page.getByTestId("share-link-card").first();
  await expect(shareLinkCard).toBeVisible();
  const shareUrl = await shareLinkCard.getAttribute("data-share-url");
  expect(shareUrl).toBeTruthy();

  const sharedPage = await browser.newPage();
  await sharedPage.goto(shareUrl as string);
  await expect(
    sharedPage.getByRole("heading", { name: "Shared inspect view" })
  ).toBeVisible();
  await expect(
    sharedPage.getByText("Lightweight read-only handoff with inspect values and page navigation.")
  ).toBeVisible();
  await expect(
    sharedPage.getByText("This file is open in read-only mode.")
  ).toBeVisible();
  await sharedPage.close();

  await ensureModePanelOpen(page, "right-panel-toggle-export", "right-panel");
  await page.getByRole("button", { name: "Export page PNG" }).click();
  await expect(page.getByText(/Status: (Queued|Running|Succeeded)/)).toBeVisible({
    timeout: 30_000
  });

  const [apiReady, collabHealth, workerReady] = await Promise.all([
    page.request.get("/readyz"),
    page.request.get("/collab/healthz"),
    page.request.get("/worker/readyz")
  ]);
  expect(apiReady.ok()).toBeTruthy();
  expect(collabHealth.ok()).toBeTruthy();
  expect(workerReady.ok()).toBeTruthy();

  await expect(page.getByText("Status: Succeeded")).toBeVisible({
    timeout: 120_000
  });
  const [pngDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download" }).click()
  ]);
  expect((await pngDownload.createReadStream()) !== null).toBeTruthy();
  await page.getByRole("button", { name: "Dismiss" }).click();

  await page.getByRole("button", { name: "Export file PDF" }).click();
  await expect(page.getByText(/Status: (Queued|Running|Succeeded)/)).toBeVisible({
    timeout: 30_000
  });
  await expect(page.getByText("Status: Succeeded")).toBeVisible({
    timeout: 120_000
  });
  const [pdfDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download" }).click()
  ]);
  expect((await pdfDownload.createReadStream()) !== null).toBeTruthy();

  expect(pageTwoRoute.fileId).toBe(pageOneRoute.fileId);
  expect(pageTwoRoute.workspaceId).toBe(pageOneRoute.workspaceId);
  expect(pageTwoRoute.projectId).toBe(pageOneRoute.projectId);
});
