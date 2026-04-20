import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageEditorScreen } from "./PageEditorScreen";

const currentSnapshot = {
  canRedo: false,
  canUndo: false,
  document: {
    nodes: {
      "rect-1": {
        cornerRadius: 16,
        createdAt: "2026-04-20T00:00:00.000Z",
        fill: {
          color: { alpha: 1, hex: "#f5a24a" }
        },
        height: 120,
        id: "rect-1",
        locked: false,
        name: "Rectangle",
        opacity: 1,
        pageId: "page-1",
        parentId: null,
        rotation: 0,
        shadow: null,
        stroke: null,
        type: "rectangle",
        updatedAt: "2026-04-20T00:00:00.000Z",
        visible: true,
        width: 160,
        x: 48,
        y: 64,
        zIndex: 0
      }
    },
    pageId: "page-1",
    rootNodeIds: ["rect-1"]
  },
  localClientId: 1,
  presenceEntries: []
};

const sessionStubs: Array<{
  clearPresence: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  redo: ReturnType<typeof vi.fn>;
  setPresenceCursor: ReturnType<typeof vi.fn>;
  setPresenceSelection: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  undo: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("./render", () => ({
  renderSceneToCanvas: vi.fn()
}));

vi.mock("./image-load-manager", () => ({
  createImageLoadManager: vi.fn(() => ({
    clear: vi.fn(),
    sync: vi.fn()
  }))
}));

vi.mock("./session", () => ({
  createEditorSession: vi.fn(() => {
    const session = {
      clearPresence: vi.fn(),
      commit: vi.fn(),
      connect: vi.fn(),
      destroy: vi.fn(),
      redo: vi.fn(),
      setPresenceCursor: vi.fn(),
      setPresenceSelection: vi.fn(),
      subscribe: vi.fn((listener: (snapshot: typeof currentSnapshot) => void) => {
        listener(currentSnapshot);
        return () => undefined;
      }),
      undo: vi.fn()
    };

    sessionStubs.push(session);
    return session;
  })
}));

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    },
    status: 200
  });
}

function installResizeObserver() {
  class MockResizeObserver {
    observe() {}
    disconnect() {}
  }

  vi.stubGlobal("ResizeObserver", MockResizeObserver);
}

function createFetchMock() {
  return vi.fn<typeof fetch>().mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.includes("/assets")) {
      return Promise.resolve(createJsonResponse({ assets: [] }));
    }

    if (url.includes("/comments")) {
      if (method === "POST") {
        return Promise.resolve(
          createJsonResponse({
            author: {
              avatarUrl: null,
              displayName: "Reviewer",
              id: "user-2"
            },
            body: "Looks good",
            createdAt: "2026-04-20T02:00:00.000Z",
            fileId: "file-1",
            id: "comment-1",
            nodeId: null,
            pageId: "page-1",
            resolvedAt: url.includes("/resolve")
              ? "2026-04-20T02:05:00.000Z"
              : null
          })
        );
      }

      return Promise.resolve(
        createJsonResponse({
          comments: [
            {
              author: {
                avatarUrl: null,
                displayName: "Reviewer",
                id: "user-2"
              },
              body: "Looks good",
              createdAt: "2026-04-20T02:00:00.000Z",
              fileId: "file-1",
              id: "comment-1",
              nodeId: null,
              pageId: "page-1",
              resolvedAt: null
            }
          ]
        })
      );
    }

    if (url.includes("/share-links")) {
      if (url.includes("/revoke")) {
        const shareLinkId =
          url.match(/share-links\/([^/]+)\/revoke/)?.[1] ?? "share-1";
        const token = shareLinkId === "share-2" ? "token-2" : "token-1";

        return Promise.resolve(
          createJsonResponse({
            createdAt: "2026-04-20T03:00:00.000Z",
            fileId: "file-1",
            id: shareLinkId,
            revokedAt: "2026-04-20T03:05:00.000Z",
            shareUrl: `https://app.test/share/${token}`
          })
        );
      }

      if (method === "POST") {
        return Promise.resolve(
          createJsonResponse({
            shareLink: {
              createdAt: "2026-04-20T03:00:00.000Z",
              fileId: "file-1",
              id: "share-2",
              revokedAt: null,
              shareUrl: "https://app.test/share/token-2"
            },
            token: "token-2"
          })
        );
      }

      return Promise.resolve(
        createJsonResponse({
          shareLinks: [
            {
              createdAt: "2026-04-20T03:00:00.000Z",
              fileId: "file-1",
              id: "share-1",
              revokedAt: null,
              shareUrl: "https://app.test/share/token-1"
            }
          ]
        })
      );
    }

    if (url.includes("/export-jobs")) {
      const requestBody =
        typeof init?.body === "string" ? JSON.parse(init.body) : {};

      return Promise.resolve(
        createJsonResponse({
          createdAt: "2026-04-20T04:00:00.000Z",
          errorMessage: null,
          fileId: "file-1",
          format: requestBody.format ?? "png",
          id: "export-1",
          outputAssetId: null,
          pageId: requestBody.pageId ?? "page-1",
          status: "succeeded"
        })
      );
    }

    return Promise.resolve(createJsonResponse({}));
  });
}

function createProps(overrides?: {
  access?: Partial<{
    canComment: boolean;
    canManageShareLinks: boolean;
    canMutate: boolean;
    mode: "read-only" | "writable";
    role: "editor" | "owner" | "viewer";
    source: "membership" | "share-link";
  }>;
  shareToken?: string | null;
}) {
  return {
    access: {
      canComment: true,
      canManageShareLinks: true,
      canMutate: true,
      mode: "writable" as const,
      role: "owner" as const,
      source: "membership" as const,
      ...overrides?.access
    },
    collab: {
      apiBaseUrl: "http://127.0.0.1",
      authPath: "/auth",
      collabHttpUrl: "http://127.0.0.1/collab",
      collabWsPath: "/collab",
      collabWsUrl: "ws://127.0.0.1/collab",
      workerHttpUrl: "http://127.0.0.1/worker"
    },
    currentUser: {
      avatarUrl: null,
      displayName: "OpenMirage Dev",
      email: "dev@openmirage.local",
      id: "user-1"
    },
    file: {
      createdAt: "2026-04-20T00:00:00.000Z",
      createdByUserId: "user-1",
      deletedAt: null,
      description: null,
      id: "file-1",
      name: "Canvas File",
      projectId: "project-1",
      updatedAt: "2026-04-20T00:00:00.000Z",
      workspaceId: "workspace-1"
    },
    onCreatePage: vi.fn(async () => undefined),
    onNavigatePage: vi.fn(),
    onRenameFile: vi.fn(async () => undefined),
    onRenamePage: vi.fn(async () => undefined),
    page: {
      background: "#ffffff",
      createdAt: "2026-04-20T00:00:00.000Z",
      fileId: "file-1",
      height: 1024,
      id: "page-1",
      name: "Page 1",
      orderIndex: 0,
      updatedAt: "2026-04-20T00:00:00.000Z",
      width: 1440
    },
    pages: [
      {
        background: "#ffffff",
        createdAt: "2026-04-20T00:00:00.000Z",
        fileId: "file-1",
        height: 1024,
        id: "page-1",
        name: "Page 1",
        orderIndex: 0,
        updatedAt: "2026-04-20T00:00:00.000Z",
        width: 1440
      },
      {
        background: "#ffffff",
        createdAt: "2026-04-20T00:00:00.000Z",
        fileId: "file-1",
        height: 1024,
        id: "page-2",
        name: "Page 2",
        orderIndex: 1,
        updatedAt: "2026-04-20T00:00:00.000Z",
        width: 1440
      }
    ],
    project: {
      createdAt: "2026-04-20T00:00:00.000Z",
      deletedAt: null,
      description: null,
      id: "project-1",
      name: "Project",
      updatedAt: "2026-04-20T00:00:00.000Z",
      workspaceId: "workspace-1"
    },
    route: {
      fileId: "file-1",
      pageId: "page-1",
      projectId: "project-1",
      workspaceId: "workspace-1"
    },
    shareToken: overrides?.shareToken ?? null,
    workspace: {
      createdAt: "2026-04-20T00:00:00.000Z",
      deletedAt: null,
      id: "workspace-1",
      membershipId: "membership-1",
      name: "Workspace",
      role: "owner",
      slug: "workspace",
      updatedAt: "2026-04-20T00:00:00.000Z"
    }
  };
}

describe("PageEditorScreen shell", () => {
  beforeEach(() => {
    installResizeObserver();
    sessionStubs.length = 0;
    vi.stubGlobal("fetch", createFetchMock());
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined)
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts canvas-first with both overlays closed and toggles the left rail modes", async () => {
    const user = userEvent.setup();

    render(<PageEditorScreen {...createProps()} />);

    await waitFor(() => expect(sessionStubs).toHaveLength(1));
    expect(screen.queryByTestId("left-rail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("right-panel")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("left-rail-toggle-pages"));
    expect(screen.getByTestId("left-rail")).toBeVisible();
    expect(screen.getByPlaceholderText("New page name")).toBeVisible();

    await user.click(screen.getByTestId("left-rail-toggle-layers"));
    expect(
      within(screen.getByTestId("left-rail")).getAllByRole("button", {
        name: /Rectangle/
      }).length
    ).toBeGreaterThan(0);

    await user.click(screen.getByTestId("left-rail-toggle-comments"));
    expect(
      screen.getByPlaceholderText("Leave lightweight review context")
    ).toBeVisible();

    await user.click(screen.getByLabelText("Close left rail"));
    expect(screen.queryByTestId("left-rail")).not.toBeInTheDocument();
  });

  it("switches overlay modes and keeps inspect/share/export actions reachable", async () => {
    const user = userEvent.setup();
    const props = createProps();

    render(<PageEditorScreen {...props} />);

    await waitFor(() => expect(sessionStubs).toHaveLength(1));
    const session = sessionStubs[0];

    await user.click(screen.getByTestId("left-rail-toggle-layers"));
    await user.click(
      within(screen.getByTestId("left-rail")).getAllByRole("button", {
        name: /Rectangle/
      })[0] as HTMLButtonElement
    );
    await user.click(screen.getByTestId("right-panel-toggle-inspect"));

    expect(screen.getByTestId("right-panel")).toBeVisible();
    await waitFor(() =>
      expect(
        within(screen.getByTestId("right-panel")).getByText("Dimensions")
      ).toBeVisible()
    );

    await user.click(
      within(screen.getByTestId("left-rail")).getByRole("button", {
        name: "Pages"
      })
    );
    await user.click(screen.getByRole("button", { name: /Page 2/ }));
    expect(props.onNavigatePage).toHaveBeenCalledWith("page-2");

    await user.click(screen.getByTestId("left-rail-toggle-layers"));
    const layerButtons = within(screen.getByTestId("left-rail")).getAllByRole(
      "button",
      { name: /↑|↓|Lock|Hide|Del/ }
    );
    for (const button of layerButtons) {
      await user.click(button);
    }
    expect(session?.commit).toHaveBeenCalled();

    await user.click(
      within(screen.getByTestId("left-rail")).getByRole("button", {
        name: "Comments"
      })
    );
    await user.selectOptions(screen.getByRole("combobox"), "file");
    await user.type(
      screen.getByPlaceholderText("Leave lightweight review context"),
      "Check alignment"
    );
    await user.click(screen.getByRole("button", { name: "Resolve" }));

    await user.click(
      within(screen.getByTestId("right-panel")).getByRole("button", {
        name: "Share"
      })
    );
    await user.click(screen.getByRole("button", { name: "Create share link" }));
    await waitFor(() =>
      expect(screen.getAllByTestId("share-link-card")).toHaveLength(2)
    );
    const firstShareCard = screen
      .getAllByTestId("share-link-card")
      .find((card) => card.getAttribute("data-share-url")?.includes("token-2"));

    expect(firstShareCard).toBeTruthy();
    await user.click(
      within(firstShareCard as HTMLElement).getByRole("button", {
        name: /Copy|Copied/
      })
    );
    await user.click(
      within(firstShareCard as HTMLElement).getByRole("button", { name: "Revoke" })
    );

    await user.click(
      within(screen.getByTestId("right-panel")).getByRole("button", {
        name: "Export"
      })
    );
    await user.click(screen.getByRole("button", { name: "Export page PNG" }));
    await user.click(screen.getByRole("button", { name: "Export file PDF" }));
    await user.click(screen.getByLabelText("Close right panel"));
    expect(screen.queryByTestId("right-panel")).not.toBeInTheDocument();
  });

  it("surfaces file/page rename and page creation controls in contextual locations", async () => {
    const user = userEvent.setup();
    const props = createProps();

    render(<PageEditorScreen {...props} />);

    await waitFor(() => expect(sessionStubs).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Rename file" }));
    await user.type(screen.getByPlaceholderText("Rename file"), "Renamed File");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onRenameFile).toHaveBeenCalledWith("file-1", "Renamed File");

    await user.click(screen.getByTestId("left-rail-toggle-pages"));
    await user.type(screen.getByPlaceholderText("New page name"), "Roadmap");
    await user.click(screen.getByRole("button", { name: "Add page" }));
    expect(props.onCreatePage).toHaveBeenCalledWith("Roadmap");

    const renamePageInputs = screen.getAllByPlaceholderText("Rename page");
    await user.type(renamePageInputs[0] as HTMLInputElement, "Overview");
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    await user.click(saveButtons[0] as HTMLButtonElement);
    expect(props.onRenamePage).toHaveBeenCalledWith("page-1", "Overview");
  });

  it("preserves share-link restrictions in the overlay shell", async () => {
    const user = userEvent.setup();

    render(
      <PageEditorScreen
        {...createProps({
          access: {
            canComment: false,
            canManageShareLinks: false,
            canMutate: false,
            mode: "read-only",
            role: "viewer",
            source: "share-link"
          },
          shareToken: "share-token"
        })}
      />
    );

    await waitFor(() => expect(sessionStubs).toHaveLength(1));
    expect(screen.queryByTestId("left-rail-toggle-comments")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename file" })).not.toBeInTheDocument();
    expect(screen.getByText("This file is open in read-only mode.")).toBeVisible();

    await user.click(screen.getByTestId("right-panel-toggle-share"));
    expect(
      screen.getByText(
        "This session is running from a read-only share link. Document changes are disabled in the UI and blocked server-side."
      )
    ).toBeVisible();

    await user.click(screen.getByTestId("right-panel-toggle-export"));
    expect(
      screen.getByText(
        "Export creation is unavailable from read-only share-link access."
      )
    ).toBeVisible();
  });

  it("resets comment mode when comments become unavailable", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PageEditorScreen {...createProps()} />);

    await waitFor(() => expect(sessionStubs).toHaveLength(1));
    await user.click(screen.getByTestId("left-rail-toggle-comments"));
    expect(screen.getByTestId("left-rail")).toBeVisible();

    rerender(
      <PageEditorScreen
        {...createProps({
          access: {
            canComment: false,
            canManageShareLinks: false,
            canMutate: false,
            mode: "read-only",
            role: "viewer",
            source: "share-link"
          },
          shareToken: "share-token"
        })}
      />
    );

    await waitFor(() =>
      expect(screen.queryByTestId("left-rail")).not.toBeInTheDocument()
    );
    expect(screen.queryByTestId("left-rail-toggle-comments")).not.toBeInTheDocument();
  });
});
