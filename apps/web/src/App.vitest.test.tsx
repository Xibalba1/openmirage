import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const authenticatedSession = {
  memberships: [
    {
      id: "membership-1",
      role: "owner",
      workspaceId: "workspace-1"
    }
  ],
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
    expect(window.location.pathname).toBe("/auth");
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
        .mockResolvedValueOnce(createJsonResponse(authenticatedSession))
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
            workspace: {
              id: "workspace-1",
              name: "OpenMirage Dev",
              role: "owner",
              slug: "openmirage-dev"
            }
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
