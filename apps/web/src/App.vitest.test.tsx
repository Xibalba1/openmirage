import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./editor/PageEditorScreen", () => ({
  PageEditorScreen: (props: {
    file: { name: string };
    page: { name: string };
    shareToken: string | null;
  }) => (
    <div data-testid="mock-page-editor">
      <span>{props.file.name}</span>
      <span>{props.page.name}</span>
      <span>{props.shareToken ?? "member-session"}</span>
    </div>
  )
}));

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function setRuntimeEnv() {
  window.__OPENMIRAGE_RUNTIME__ = {
    OPENMIRAGE_ENV: "development",
    VITE_API_BASE_URL: "http://127.0.0.1",
    VITE_AUTH_PATH: "/auth",
    VITE_COLLAB_HTTP_URL: "http://127.0.0.1/collab",
    VITE_COLLAB_WS_PATH: "/collab",
    VITE_COLLAB_WS_URL: "ws://127.0.0.1/collab",
    VITE_WORKER_HTTP_URL: "http://127.0.0.1/worker"
  };
}

const workspaceOne = {
  id: "workspace-1",
  name: "OpenMirage Dev",
  role: "owner",
  slug: "openmirage-dev"
};

const workspaceTwo = {
  id: "workspace-2",
  name: "Client Workspace",
  role: "editor",
  slug: "client-workspace"
};

const projectsByWorkspace = {
  "workspace-1": [
    {
      createdAt: "2026-04-18T00:00:00.000Z",
      description: null,
      id: "project-1",
      name: "Sprint 10 Project",
      updatedAt: "2026-04-18T00:00:00.000Z",
      workspaceId: "workspace-1"
    }
  ],
  "workspace-2": [
    {
      createdAt: "2026-04-18T00:00:00.000Z",
      description: null,
      id: "project-2",
      name: "Client Project",
      updatedAt: "2026-04-18T01:00:00.000Z",
      workspaceId: "workspace-2"
    }
  ]
} satisfies Record<string, Array<Record<string, string | null>>>;

const fileOpenByFileId = {
  "file-1": {
    access: {
      canComment: true,
      canManageShareLinks: true,
      canMutate: true,
      mode: "writable",
      role: "owner",
      source: "membership"
    },
    defaultPageId: "page-1",
    file: {
      createdAt: "2026-04-18T00:00:00.000Z",
      createdByUserId: "user-1",
      deletedAt: null,
      description: null,
      id: "file-1",
      name: "Sprint 10 File",
      projectId: "project-1",
      updatedAt: "2026-04-18T00:00:00.000Z",
      workspaceId: "workspace-1"
    },
    pages: [
      {
        background: "#ffffff",
        createdAt: "2026-04-18T00:00:00.000Z",
        fileId: "file-1",
        height: 1024,
        id: "page-1",
        name: "Page 1",
        orderIndex: 0,
        updatedAt: "2026-04-18T00:00:00.000Z",
        width: 1440
      },
      {
        background: "#ffffff",
        createdAt: "2026-04-18T00:00:00.000Z",
        fileId: "file-1",
        height: 1024,
        id: "page-2",
        name: "Page 2",
        orderIndex: 1,
        updatedAt: "2026-04-18T00:00:00.000Z",
        width: 1440
      }
    ],
    project: projectsByWorkspace["workspace-1"][0],
    workspace: workspaceOne
  },
  "file-2": {
    access: {
      canComment: true,
      canManageShareLinks: true,
      canMutate: true,
      mode: "writable",
      role: "editor",
      source: "membership"
    },
    defaultPageId: "page-3",
    file: {
      createdAt: "2026-04-18T00:00:00.000Z",
      createdByUserId: "user-1",
      deletedAt: null,
      description: null,
      id: "file-2",
      name: "Client File",
      projectId: "project-2",
      updatedAt: "2026-04-18T00:00:00.000Z",
      workspaceId: "workspace-2"
    },
    pages: [
      {
        background: "#ffffff",
        createdAt: "2026-04-18T00:00:00.000Z",
        fileId: "file-2",
        height: 1024,
        id: "page-3",
        name: "Client Page",
        orderIndex: 0,
        updatedAt: "2026-04-18T00:00:00.000Z",
        width: 1440
      }
    ],
    project: projectsByWorkspace["workspace-2"][0],
    workspace: workspaceTwo
  }
};

function createAuthenticatedSession(
  workspaceIds: string[] = ["workspace-1", "workspace-2"]
) {
  return {
    memberships: workspaceIds.map((workspaceId, index) => ({
      id: `membership-${index + 1}`,
      role: workspaceId === "workspace-1" ? "owner" : "editor",
      workspaceId
    })),
    session: {
      expiresAt: "2026-05-01T00:00:00.000Z",
      id: "session-1"
    },
    user: {
      avatarUrl: null,
      displayName: "OpenMirage Dev",
      email: "dev@openmirage.local",
      id: "user-1"
    }
  };
}

function createWorkspaceProjectsResponse(workspaceId: "workspace-1" | "workspace-2") {
  return createJsonResponse({
    projects: projectsByWorkspace[workspaceId],
    workspace: workspaceId === "workspace-1" ? workspaceOne : workspaceTwo
  });
}

function createWorkspaceLaunchpadPayload(
  workspaceId: "workspace-1" | "workspace-2"
) {
  const fileOpen =
    workspaceId === "workspace-1" ? fileOpenByFileId["file-1"] : fileOpenByFileId["file-2"];

  return {
    projects: [
      {
        files: [
          {
            defaultPageId: fileOpen.defaultPageId,
            file: fileOpen.file,
            pageCount: fileOpen.pages.length
          }
        ],
        project: fileOpen.project
      }
    ],
    workspace: workspaceId === "workspace-1" ? workspaceOne : workspaceTwo
  };
}

function createWorkspaceLaunchpadResponse(
  workspaceId: "workspace-1" | "workspace-2"
) {
  return createJsonResponse(createWorkspaceLaunchpadPayload(workspaceId));
}

function createAuthenticatedFetchMock() {
  return vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = String(input);

    if (url.includes("/auth/me")) {
      return Promise.resolve(createJsonResponse(createAuthenticatedSession()));
    }

    if (url.endsWith("/v1/workspaces")) {
      return Promise.resolve(
        createJsonResponse({
          workspaces: [workspaceOne, workspaceTwo]
        })
      );
    }

    if (url.includes("/v1/workspaces/workspace-1/launchpad")) {
      return Promise.resolve(createWorkspaceLaunchpadResponse("workspace-1"));
    }

    if (url.includes("/v1/workspaces/workspace-2/launchpad")) {
      return Promise.resolve(createWorkspaceLaunchpadResponse("workspace-2"));
    }

    if (
      url.includes("/v1/workspaces/workspace-1/projects/project-1/files/file-1")
    ) {
      return Promise.resolve(createJsonResponse(fileOpenByFileId["file-1"]));
    }

    if (
      url.includes("/v1/workspaces/workspace-2/projects/project-2/files/file-2")
    ) {
      return Promise.resolve(createJsonResponse(fileOpenByFileId["file-2"]));
    }

    if (url.includes("/v1/workspaces/workspace-2/projects/project-2/files")) {
      return Promise.resolve(
        createJsonResponse({
          files: [fileOpenByFileId["file-2"].file],
          project: projectsByWorkspace["workspace-2"][0],
          workspace: workspaceTwo
        })
      );
    }

    if (url.includes("/v1/workspaces/workspace-1/projects/project-1/files")) {
      return Promise.resolve(
        createJsonResponse({
          files: [fileOpenByFileId["file-1"].file],
          project: projectsByWorkspace["workspace-1"][0],
          workspace: workspaceOne
        })
      );
    }

    if (url.includes("/v1/workspaces/workspace-1/projects")) {
      return Promise.resolve(createWorkspaceProjectsResponse("workspace-1"));
    }

    if (url.includes("/v1/workspaces/workspace-2/projects")) {
      return Promise.resolve(createWorkspaceProjectsResponse("workspace-2"));
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

function createEmptyWorkspaceFetchMock() {
  return vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = String(input);

    if (url.includes("/auth/me")) {
      return Promise.resolve(createJsonResponse(createAuthenticatedSession([])));
    }

    if (url.endsWith("/v1/workspaces")) {
      return Promise.resolve(
        createJsonResponse({
          workspaces: []
        })
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

beforeEach(() => {
  setRuntimeEnv();
});

describe("App auth and routing flows", () => {
  it("redirects protected unauthenticated routes to auth and requests a magic link", async () => {
    window.history.replaceState(null, "", "/app");

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        createJsonResponse({
          delivery: "log",
          expiresAt: "2026-05-01T00:00:00.000Z",
          magicLinkUrl:
            "http://127.0.0.1/auth/magic-link/consume?token=test-token",
          ok: true
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", {
      name: "Sign in to your workspace"
    });
    await waitFor(() => expect(window.location.pathname).toBe("/auth"));
    expect(window.location.search).toContain("redirectTo=%2Fapp");

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "dev@openmirage.local" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }));

    await screen.findByRole("heading", { name: "Check your magic link" });
    expect(screen.getByRole("link", { name: "Open development magic link" })).toHaveAttribute(
      "href",
      "http://127.0.0.1/auth/magic-link/consume?token=test-token"
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("loads the authenticated /app launchpad with grouped files and file actions", async () => {
    window.history.replaceState(null, "", "/app");

    vi.stubGlobal("fetch", createAuthenticatedFetchMock());

    render(<App />);

    await screen.findByRole("heading", { name: "Workspace launchpad" });
    await screen.findByRole("heading", { name: "OpenMirage Dev" });
    expect(screen.getByText("Sprint 10 Project")).toBeInTheDocument();
    expect(screen.getByText("Sprint 10 File")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Browse pages" })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("mock-page-editor")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("openmirage.activeWorkspaceId")).toBe(
      "workspace-1"
    );
  });

  it("restores the last active workspace and updates browser-local memory when switching workspaces", async () => {
    window.history.replaceState(null, "", "/app");
    window.localStorage.setItem("openmirage.activeWorkspaceId", "workspace-2");
    const fetchMock = createAuthenticatedFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByRole("heading", { name: "Workspace launchpad" });
    await screen.findByRole("heading", { name: "Client Workspace" });
    expect(screen.getByText("Client Project")).toBeInTheDocument();
    expect(screen.getByText("Client File")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /OpenMirage Dev/i }));

    await screen.findByRole("heading", { name: "OpenMirage Dev" });
    await waitFor(() =>
      expect(screen.getByText("Sprint 10 Project")).toBeInTheDocument()
    );
    expect(window.localStorage.getItem("openmirage.activeWorkspaceId")).toBe(
      "workspace-1"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/workspaces/workspace-2/launchpad"),
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/workspaces/workspace-1/launchpad"),
      expect.any(Object)
    );
  });

  it("falls back to the first accessible workspace when stored memory is stale", async () => {
    window.history.replaceState(null, "", "/app");
    window.localStorage.setItem(
      "openmirage.activeWorkspaceId",
      "workspace-missing"
    );

    vi.stubGlobal("fetch", createAuthenticatedFetchMock());

    render(<App />);

    await screen.findByRole("heading", { name: "OpenMirage Dev" });
    expect(window.localStorage.getItem("openmirage.activeWorkspaceId")).toBe(
      "workspace-1"
    );
  });

  it("clears stale browser-local memory when no workspaces are available", async () => {
    window.history.replaceState(null, "", "/app");
    window.localStorage.setItem("openmirage.activeWorkspaceId", "workspace-1");

    vi.stubGlobal("fetch", createEmptyWorkspaceFetchMock());

    render(<App />);

    await screen.findByRole("heading", { name: "No workspaces yet" });
    expect(window.localStorage.getItem("openmirage.activeWorkspaceId")).toBeNull();
  });

  it("retries launchpad loading after a workspace request failure", async () => {
    window.history.replaceState(null, "", "/app");
    let projectLoadAttempts = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((input) => {
        const url = String(input);

        if (url.includes("/auth/me")) {
          return Promise.resolve(createJsonResponse(createAuthenticatedSession()));
        }

        if (url.endsWith("/v1/workspaces")) {
          return Promise.resolve(
            createJsonResponse({
              workspaces: [workspaceOne, workspaceTwo]
            })
          );
        }

        if (url.includes("/v1/workspaces/workspace-1/launchpad")) {
          projectLoadAttempts += 1;

          return Promise.resolve(
            projectLoadAttempts === 1
              ? createJsonResponse({ error: "Workspace load failed" }, 500)
              : createWorkspaceLaunchpadResponse("workspace-1")
          );
        }

        if (url.includes("/v1/workspaces/workspace-2/launchpad")) {
          return Promise.resolve(createWorkspaceLaunchpadResponse("workspace-2"));
        }

        return Promise.resolve(new Response(null, { status: 404 }));
      })
    );

    render(<App />);

    await screen.findByRole("heading", { name: "Metadata load failed" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Sprint 10 Project");
  });

  it("creates a project from the launchpad and keeps the user on /app", async () => {
    window.history.replaceState(null, "", "/app");
    let createdProject = false;
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((input, init) => {
        const url = String(input);

        if (url.includes("/auth/me")) {
          return Promise.resolve(createJsonResponse(createAuthenticatedSession()));
        }

        if (url.endsWith("/v1/workspaces")) {
          return Promise.resolve(
            createJsonResponse({
              workspaces: [workspaceOne, workspaceTwo]
            })
          );
        }

        if (
          url.includes("/v1/workspaces/workspace-1/projects") &&
          init?.method === "POST"
        ) {
          createdProject = true;
          return Promise.resolve(
            createJsonResponse({
              createdAt: "2026-04-18T00:00:00.000Z",
              description: null,
              id: "project-3",
              name: "Launchpad Project",
              deletedAt: null,
              updatedAt: "2026-04-18T00:00:00.000Z",
              workspaceId: "workspace-1"
            })
          );
        }

        if (url.includes("/v1/workspaces/workspace-1/launchpad")) {
          return Promise.resolve(
            createJsonResponse({
              projects: [
                ...(createdProject
                  ? [
                      {
                        files: [],
                        project: {
                          createdAt: "2026-04-18T00:00:00.000Z",
                          description: null,
                          id: "project-3",
                          name: "Launchpad Project",
                          updatedAt: "2026-04-18T00:00:00.000Z",
                          workspaceId: "workspace-1"
                        }
                      }
                    ]
                  : []),
                ...createWorkspaceLaunchpadPayload("workspace-1").projects
              ],
              workspace: workspaceOne
            })
          );
        }

        return Promise.resolve(new Response(null, { status: 404 }));
      })
    );

    render(<App />);

    await screen.findByRole("heading", { name: "OpenMirage Dev" });
    await user.click(screen.getByRole("button", { name: "New project" }));
    const projectNameInput = await screen.findByPlaceholderText("New project name");
    await user.type(projectNameInput, "Launchpad Project");
    expect((projectNameInput as HTMLInputElement).value).toBe("Launchpad Project");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    await screen.findByText("Launchpad Project");
    expect(window.localStorage.getItem("openmirage.activeWorkspaceId")).toBe(
      "workspace-1"
    );
    expect(window.location.pathname).toBe("/app");
  });

  it("opens a file directly to its default page from the launchpad", async () => {
    window.history.replaceState(null, "", "/app");

    vi.stubGlobal("fetch", createAuthenticatedFetchMock());

    render(<App />);

    await screen.findByText("Sprint 10 File");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await screen.findByTestId("mock-page-editor");
    expect(window.location.pathname).toBe(
      "/app/workspaces/workspace-1/projects/project-1/files/file-1/pages/page-1"
    );
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });

  it("browses pages inline from the launchpad and navigates directly to a selected page", async () => {
    window.history.replaceState(null, "", "/app");
    const user = userEvent.setup();

    vi.stubGlobal("fetch", createAuthenticatedFetchMock());

    render(<App />);

    await screen.findByText("Sprint 10 File");
    await user.click(screen.getByRole("button", { name: "Browse pages" }));

    await screen.findAllByRole("button", { name: "Open page" });
    expect(screen.getByText("Page 1")).toBeInTheDocument();
    expect(screen.getByText("Page 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Page 2/i }));

    await screen.findByTestId("mock-page-editor");
    expect(window.location.pathname).toBe(
      "/app/workspaces/workspace-1/projects/project-1/files/file-1/pages/page-2"
    );
    expect(screen.getByText("Page 2")).toBeInTheDocument();
  });

  it("reuses cached file details when pages are hidden and reopened", async () => {
    window.history.replaceState(null, "", "/app");
    const fetchMock = createAuthenticatedFetchMock();
    const user = userEvent.setup();
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await screen.findByText("Sprint 10 File");
    await user.click(screen.getByRole("button", { name: "Browse pages" }));
    await screen.findByText("Page 2");
    await user.click(screen.getByRole("button", { name: "Hide pages" }));
    await user.click(screen.getByRole("button", { name: "Browse pages" }));
    await screen.findByText("Page 2");

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes(
          "/v1/workspaces/workspace-1/projects/project-1/files/file-1"
        )
      ).length
    ).toBe(1);
  });

  it("opens a page from the inline secondary page action", async () => {
    window.history.replaceState(null, "", "/app");
    const user = userEvent.setup();

    vi.stubGlobal("fetch", createAuthenticatedFetchMock());

    render(<App />);

    await screen.findByText("Sprint 10 File");
    await user.click(screen.getByRole("button", { name: "Browse pages" }));
    await screen.findAllByRole("button", { name: "Open page" });
    await user.click(screen.getAllByRole("button", { name: "Open page" })[1]!);

    await screen.findByTestId("mock-page-editor");
    expect(window.location.pathname).toBe(
      "/app/workspaces/workspace-1/projects/project-1/files/file-1/pages/page-2"
    );
  });

  it("shows an inline browse error when page loading fails", async () => {
    window.history.replaceState(null, "", "/app");
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((input, init) => {
        const url = String(input);

        if (
          url.includes("/v1/workspaces/workspace-1/projects/project-1/files/file-1")
        ) {
          return Promise.resolve(
            init?.method === "GET"
              ? createJsonResponse({ error: "Page load failed" }, 500)
              : new Response(null, { status: 404 })
          );
        }

        return createAuthenticatedFetchMock()(input, init);
      })
    );

    render(<App />);

    await screen.findByText("Sprint 10 File");
    await user.click(screen.getByRole("button", { name: "Browse pages" }));

    await screen.findByText("Page load failed");
  });

  it("creates a file from the launchpad project section and refreshes the grouped hierarchy", async () => {
    window.history.replaceState(null, "", "/app");
    let createdFile = false;
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((input, init) => {
        const url = String(input);

        if (url.includes("/auth/me")) {
          return Promise.resolve(createJsonResponse(createAuthenticatedSession()));
        }

        if (url.endsWith("/v1/workspaces")) {
          return Promise.resolve(
            createJsonResponse({
              workspaces: [workspaceOne, workspaceTwo]
            })
          );
        }

        if (
          url.includes("/v1/workspaces/workspace-1/projects/project-1/files") &&
          init?.method === "POST"
        ) {
          createdFile = true;
          return Promise.resolve(
            createJsonResponse({
              ...fileOpenByFileId["file-1"],
              defaultPageId: "page-4",
              file: {
                ...fileOpenByFileId["file-1"].file,
                id: "file-4",
                name: "New Launchpad File"
              },
              pages: [
                {
                  ...fileOpenByFileId["file-1"].pages[0],
                  id: "page-4",
                  name: "Kickoff"
                },
                {
                  ...fileOpenByFileId["file-1"].pages[1],
                  id: "page-5",
                  name: "Specs"
                }
              ]
            })
          );
        }

        if (url.includes("/v1/workspaces/workspace-1/launchpad")) {
          const payload = createWorkspaceLaunchpadPayload("workspace-1");

          if (createdFile) {
            payload.projects[0]?.files.unshift({
              defaultPageId: "page-4",
              file: {
                ...fileOpenByFileId["file-1"].file,
                id: "file-4",
                name: "New Launchpad File"
              },
              pageCount: 2
            });
          }

          return Promise.resolve(createJsonResponse(payload));
        }

        return createAuthenticatedFetchMock()(input, init);
      })
    );

    render(<App />);

    await screen.findByText("Sprint 10 Project");
    await user.click(screen.getByRole("button", { name: "New file" }));
    await user.type(
      screen.getByPlaceholderText("New file name"),
      "New Launchpad File"
    );
    await user.clear(screen.getByPlaceholderText("Page 1"));
    await user.type(screen.getByPlaceholderText("Page 1"), "Kickoff");
    await user.clear(screen.getByPlaceholderText("Page 2"));
    await user.type(screen.getByPlaceholderText("Page 2"), "Specs");
    await user.click(screen.getByRole("button", { name: "Create file" }));

    await screen.findByText("New Launchpad File");
    expect(window.location.pathname).toBe("/app");
  });

  it("creates a page from an expanded file and refreshes inline page browsing", async () => {
    window.history.replaceState(null, "", "/app");
    let createdPage = false;
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((input, init) => {
        const url = String(input);

        if (url.includes("/auth/me")) {
          return Promise.resolve(createJsonResponse(createAuthenticatedSession()));
        }

        if (url.endsWith("/v1/workspaces")) {
          return Promise.resolve(
            createJsonResponse({
              workspaces: [workspaceOne, workspaceTwo]
            })
          );
        }

        if (
          url.includes("/v1/workspaces/workspace-1/projects/project-1/files/file-1/pages") &&
          init?.method === "POST"
        ) {
          createdPage = true;
          return Promise.resolve(
            createJsonResponse({
              ...fileOpenByFileId["file-1"].pages[0],
              id: "page-9",
              name: "New Launchpad Page",
              orderIndex: 2
            })
          );
        }

        if (
          url.includes("/v1/workspaces/workspace-1/projects/project-1/files/file-1")
        ) {
          if (!createdPage) {
            return Promise.resolve(createJsonResponse(fileOpenByFileId["file-1"]));
          }

          return Promise.resolve(
            createJsonResponse({
              ...fileOpenByFileId["file-1"],
              pages: [
                ...fileOpenByFileId["file-1"].pages,
                {
                  ...fileOpenByFileId["file-1"].pages[0],
                  id: "page-9",
                  name: "New Launchpad Page",
                  orderIndex: 2
                }
              ]
            })
          );
        }

        if (url.includes("/v1/workspaces/workspace-1/launchpad")) {
          const payload = createWorkspaceLaunchpadPayload("workspace-1");

          if (createdPage) {
            payload.projects[0]!.files[0] = {
              ...payload.projects[0]!.files[0]!,
              pageCount: 3
            };
          }

          return Promise.resolve(createJsonResponse(payload));
        }

        return createAuthenticatedFetchMock()(input, init);
      })
    );

    render(<App />);

    await screen.findByText("Sprint 10 File");
    await user.click(screen.getByRole("button", { name: "Browse pages" }));
    await screen.findByText("Page 2");

    await user.click(screen.getByRole("button", { name: "New page" }));
    await user.type(
      screen.getByPlaceholderText("New page name"),
      "New Launchpad Page"
    );
    await user.click(screen.getByRole("button", { name: "Create page" }));

    await screen.findByText("New Launchpad Page");
    expect(screen.getByText(/3 pages/)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app");
  });

  it("disables direct open when the launchpad file summary has no default page", async () => {
    window.history.replaceState(null, "", "/app");
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((input) => {
        const url = String(input);

        if (url.includes("/auth/me")) {
          return Promise.resolve(createJsonResponse(createAuthenticatedSession()));
        }

        if (url.endsWith("/v1/workspaces")) {
          return Promise.resolve(
            createJsonResponse({
              workspaces: [workspaceOne]
            })
          );
        }

        if (url.includes("/v1/workspaces/workspace-1/launchpad")) {
          return Promise.resolve(
            createJsonResponse({
              projects: [
                {
                  files: [
                    {
                      defaultPageId: null,
                      file: {
                        ...fileOpenByFileId["file-1"].file,
                        id: "file-empty",
                        name: "Untitled Draft"
                      },
                      pageCount: 0
                    }
                  ],
                  project: projectsByWorkspace["workspace-1"][0]
                }
              ],
              workspace: workspaceOne
            })
          );
        }

        if (
          url.includes("/v1/workspaces/workspace-1/projects/project-1/files/file-empty")
        ) {
          return Promise.resolve(
            createJsonResponse({
              ...fileOpenByFileId["file-1"],
              defaultPageId: null,
              file: {
                ...fileOpenByFileId["file-1"].file,
                id: "file-empty",
                name: "Untitled Draft"
              },
              pages: []
            })
          );
        }

        return Promise.resolve(new Response(null, { status: 404 }));
      })
    );

    render(<App />);

    await screen.findByText("Untitled Draft");
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    expect(
      screen.getByText(/does not have a default page/i)
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Browse pages" }));
    await screen.findByText("This file does not contain any pages yet.");
  });

  it("shows launchpad form validation and submission errors", async () => {
    window.history.replaceState(null, "", "/app");
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((input, init) => {
        const url = String(input);

        if (
          url.includes("/v1/workspaces/workspace-1/projects/project-1/files") &&
          init?.method === "POST"
        ) {
          return Promise.resolve(
            createJsonResponse({ error: "File creation failed" }, 500)
          );
        }

        return createAuthenticatedFetchMock()(input, init);
      })
    );

    render(<App />);

    await screen.findByText("Sprint 10 Project");
    await user.click(screen.getByRole("button", { name: "New file" }));
    await user.click(screen.getByRole("button", { name: "Create file" }));
    await screen.findByText("File name is required.");

    await user.type(screen.getByPlaceholderText("New file name"), "Broken File");
    await user.clear(screen.getByPlaceholderText("Page 2"));
    await user.click(screen.getByRole("button", { name: "Create file" }));
    await screen.findByText("Add at least two pages for the initial file.");

    await user.click(screen.getByRole("button", { name: "Add page field" }));
    expect(screen.getByPlaceholderText("Page 3")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Page 2"), "Page 2");
    await user.click(screen.getByRole("button", { name: "Create file" }));
    await screen.findByText("File creation failed");
  });

  it("updates browser-local workspace memory from deep-link routes", async () => {
    window.history.replaceState(
      null,
      "",
      "/app/workspaces/workspace-2/projects/project-2"
    );

    vi.stubGlobal("fetch", createAuthenticatedFetchMock());

    render(<App />);

    await screen.findByRole("heading", { name: "Client Project" });
    expect(window.localStorage.getItem("openmirage.activeWorkspaceId")).toBe(
      "workspace-2"
    );
    expect(screen.getByText("Client File")).toBeInTheDocument();
  });

  it("navigates to fallback workspace and project routes from the launchpad", async () => {
    window.history.replaceState(null, "", "/app");

    vi.stubGlobal("fetch", createAuthenticatedFetchMock());

    render(<App />);

    await screen.findByRole("heading", { name: "OpenMirage Dev" });
    fireEvent.click(screen.getAllByRole("button", { name: "View route" })[0]!);
    await waitFor(() =>
      expect(window.location.pathname).toBe("/app/workspaces/workspace-1")
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to launchpad" }));
    await screen.findByRole("heading", { name: "OpenMirage Dev" });

    fireEvent.click(screen.getByRole("button", { name: "Open project route" }));
    await waitFor(() =>
      expect(window.location.pathname).toBe(
        "/app/workspaces/workspace-1/projects/project-1"
      )
    );
  });

  it("uses the launchpad header action to open the fallback workspace route", async () => {
    window.history.replaceState(null, "", "/app");

    vi.stubGlobal("fetch", createAuthenticatedFetchMock());

    render(<App />);

    await screen.findByRole("heading", { name: "OpenMirage Dev" });
    fireEvent.click(screen.getByRole("button", { name: "Open workspace route" }));

    await waitFor(() =>
      expect(window.location.pathname).toBe("/app/workspaces/workspace-1")
    );
  });

  it("loads the authenticated page route and passes file data to the editor surface", async () => {
    window.history.replaceState(
      null,
      "",
      "/app/workspaces/workspace-1/projects/project-1/files/file-1/pages/page-2"
    );

    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          createJsonResponse(createAuthenticatedSession(["workspace-1"]))
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            access: {
              canComment: true,
              canEdit: true,
              canManageShareLinks: true,
              mode: "edit"
            },
            defaultPageId: "page-1",
            file: {
              createdAt: "2026-04-18T00:00:00.000Z",
              createdByUserId: "user-1",
              id: "file-1",
              name: "Sprint 10 File",
              projectId: "project-1",
              updatedAt: "2026-04-18T00:00:00.000Z",
              workspaceId: "workspace-1"
            },
            pages: [
              {
                background: "#ffffff",
                createdAt: "2026-04-18T00:00:00.000Z",
                fileId: "file-1",
                height: 1024,
                id: "page-1",
                name: "Page 1",
                orderIndex: 0,
                updatedAt: "2026-04-18T00:00:00.000Z",
                width: 1440
              },
              {
                background: "#ffffff",
                createdAt: "2026-04-18T00:00:00.000Z",
                fileId: "file-1",
                height: 1024,
                id: "page-2",
                name: "Page 2",
                orderIndex: 1,
                updatedAt: "2026-04-18T00:00:00.000Z",
                width: 1440
              }
            ],
            project: {
              createdAt: "2026-04-18T00:00:00.000Z",
              id: "project-1",
              name: "Sprint 10 Project",
              updatedAt: "2026-04-18T00:00:00.000Z",
              workspaceId: "workspace-1"
            },
            workspace: workspaceOne
          })
        )
    );

    render(<App />);

    await screen.findByTestId("mock-page-editor");
    expect(screen.getByText("Sprint 10 File")).toBeInTheDocument();
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    expect(screen.getByText("member-session")).toBeInTheDocument();
  });

  it("renders shared page routes in read-only mode", async () => {
    window.history.replaceState(null, "", "/share/share-token/pages/page-1");

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((input) => {
        const url = String(input);

        if (url.includes("/auth/me")) {
          return Promise.resolve(new Response(null, { status: 401 }));
        }

        if (url.includes("/v1/share-links/share-token/pages/page-1")) {
          return Promise.resolve(
            createJsonResponse({
              access: {
                canComment: false,
                canEdit: false,
                canManageShareLinks: false,
                mode: "view"
              },
              defaultPageId: "page-1",
              file: {
                createdAt: "2026-04-18T00:00:00.000Z",
                createdByUserId: "user-1",
                id: "file-1",
                name: "Shared Sprint 10 File",
                projectId: "project-1",
                updatedAt: "2026-04-18T00:00:00.000Z",
                workspaceId: "workspace-1"
              },
              pages: [
                {
                  background: "#ffffff",
                  createdAt: "2026-04-18T00:00:00.000Z",
                  fileId: "file-1",
                  height: 1024,
                  id: "page-1",
                  name: "Shared Page",
                  orderIndex: 0,
                  updatedAt: "2026-04-18T00:00:00.000Z",
                  width: 1440
                }
              ],
              project: {
                createdAt: "2026-04-18T00:00:00.000Z",
                id: "project-1",
                name: "Shared Project",
                updatedAt: "2026-04-18T00:00:00.000Z",
                workspaceId: "workspace-1"
              },
              shareToken: "share-token",
              workspace: {
                id: "workspace-1",
                name: "OpenMirage Dev",
                slug: "openmirage-dev"
              }
            })
          );
        }

        return Promise.resolve(new Response(null, { status: 404 }));
      })
    );

    render(<App />);

    await screen.findByRole("heading", { name: "Shared inspect view" });
    await waitFor(() =>
      expect(screen.getByText("share-token")).toBeInTheDocument()
    );
  });
});
