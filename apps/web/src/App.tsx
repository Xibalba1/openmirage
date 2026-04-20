import {
  type AuthenticatedUser,
  type AuthContext,
  type CreateFileInput,
  type CreatePageInput,
  type CreateProjectInput,
  type EditorAccessDto,
  type FileDto,
  type FileOpenResponse,
  type PageDto,
  type ProjectDto,
  type RenameFileInput,
  type RenamePageInput,
  type RenameProjectInput,
  type RuntimeUrls,
  type SharedFileOpenResponse,
  type WorkspaceDto,
  type WorkspaceDetailDto
} from "@openmirage/types";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  clearStoredActiveWorkspaceId,
  readStoredActiveWorkspaceId,
  resolveActiveWorkspace,
  writeStoredActiveWorkspaceId
} from "./active-workspace";
import { PageEditorScreen } from "./editor/PageEditorScreen";
import { buildJsonRequestHeaders } from "./http";
import { readRuntimeWebEnv } from "./runtime-env";

const pendingRedirectStorageKey = "openmirage.pendingRedirect";

type SessionState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; auth: AuthContext }
  | { status: "error"; message: string };

type MagicLinkRequestState =
  | { status: "idle" }
  | { status: "submitting" }
  | {
      status: "success";
      delivery: string;
      expiresAt: string;
      magicLinkUrl?: string;
    }
  | { status: "error"; message: string };

type AppRoute =
  | { kind: "root" }
  | { kind: "auth" }
  | { kind: "app-home" }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "project"; projectId: string; workspaceId: string }
  | { kind: "file"; fileId: string; projectId: string; workspaceId: string }
  | {
      kind: "page";
      fileId: string;
      pageId: string;
      projectId: string;
      workspaceId: string;
    }
  | { kind: "shared-file"; token: string }
  | { kind: "shared-page"; pageId: string; token: string }
  | { kind: "unknown" };

interface BrowserLocationState {
  pathname: string;
  search: string;
}

interface MagicLinkRequestResponse {
  delivery: string;
  expiresAt: string;
  magicLinkUrl?: string;
  ok: boolean;
}

interface WorkspacesResponse {
  workspaces: WorkspaceDetailDto[];
}

interface ProjectListResponse {
  projects: ProjectDto[];
  workspace: WorkspaceDetailDto;
}

interface FileListResponse {
  files: FileDto[];
  project: ProjectDto;
  workspace: WorkspaceDetailDto;
}

type ResourceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; value: ResourceData };

type ResourceData =
  | {
      activeWorkspace: WorkspaceDetailDto | null;
      kind: "launchpad";
      projects: ProjectDto[];
      workspaces: WorkspaceDetailDto[];
    }
  | { kind: "projects"; projects: ProjectDto[]; workspace: WorkspaceDetailDto }
  | {
      files: FileDto[];
      kind: "files";
      project: ProjectDto;
      workspace: WorkspaceDetailDto;
    }
  | {
      access: EditorAccessDto;
      file: FileDto;
      kind: "file-open";
      pages: PageDto[];
      project: ProjectDto;
      selectedPageId: string | null;
      workspace: WorkspaceDetailDto;
    }
  | {
      access: EditorAccessDto;
      file: FileDto;
      kind: "shared-file-open";
      pages: PageDto[];
      project: ProjectDto;
      selectedPageId: string | null;
      shareToken: string;
      workspace: WorkspaceDto;
    };

type FileOpenResource = Extract<ResourceData, { kind: "file-open" }>;
type LaunchpadResource = Extract<ResourceData, { kind: "launchpad" }>;

function BuildStamp(props: { appVersion: string }) {
  return (
    <aside className="build-stamp" aria-label="Deployed build version">
      <span className="build-stamp-label">Build</span>
      <code>{props.appVersion}</code>
    </aside>
  );
}

function renderWithBuildStamp(appVersion: string, content: ReactNode) {
  return (
    <>
      {content}
      <BuildStamp appVersion={appVersion} />
    </>
  );
}

function readBrowserLocation(): BrowserLocationState {
  return {
    pathname: window.location.pathname,
    search: window.location.search
  };
}

function parseRoute(pathname: string): AppRoute {
  if (pathname === "/") {
    return { kind: "root" };
  }

  if (pathname === "/auth") {
    return { kind: "auth" };
  }

  const sharedPageMatch = pathname.match(/^\/share\/([^/]+)\/pages\/([^/]+)$/);

  if (sharedPageMatch) {
    return {
      kind: "shared-page",
      pageId: decodeURIComponent(sharedPageMatch[2] ?? ""),
      token: decodeURIComponent(sharedPageMatch[1] ?? "")
    };
  }

  const sharedFileMatch = pathname.match(/^\/share\/([^/]+)$/);

  if (sharedFileMatch) {
    return {
      kind: "shared-file",
      token: decodeURIComponent(sharedFileMatch[1] ?? "")
    };
  }

  if (pathname === "/app") {
    return { kind: "app-home" };
  }

  const pageMatch = pathname.match(
    /^\/app\/workspaces\/([^/]+)\/projects\/([^/]+)\/files\/([^/]+)\/pages\/([^/]+)$/
  );

  if (pageMatch) {
    return {
      fileId: decodeURIComponent(pageMatch[3] ?? ""),
      kind: "page",
      pageId: decodeURIComponent(pageMatch[4] ?? ""),
      projectId: decodeURIComponent(pageMatch[2] ?? ""),
      workspaceId: decodeURIComponent(pageMatch[1] ?? "")
    };
  }

  const fileMatch = pathname.match(
    /^\/app\/workspaces\/([^/]+)\/projects\/([^/]+)\/files\/([^/]+)$/
  );

  if (fileMatch) {
    return {
      fileId: decodeURIComponent(fileMatch[3] ?? ""),
      kind: "file",
      projectId: decodeURIComponent(fileMatch[2] ?? ""),
      workspaceId: decodeURIComponent(fileMatch[1] ?? "")
    };
  }

  const projectMatch = pathname.match(
    /^\/app\/workspaces\/([^/]+)\/projects\/([^/]+)$/
  );

  if (projectMatch) {
    return {
      kind: "project",
      projectId: decodeURIComponent(projectMatch[2] ?? ""),
      workspaceId: decodeURIComponent(projectMatch[1] ?? "")
    };
  }

  const workspaceMatch = pathname.match(/^\/app\/workspaces\/([^/]+)$/);

  if (workspaceMatch) {
    return {
      kind: "workspace",
      workspaceId: decodeURIComponent(workspaceMatch[1] ?? "")
    };
  }

  return { kind: "unknown" };
}

function getRoutePath(route: AppRoute): string {
  switch (route.kind) {
    case "root":
      return "/";
    case "auth":
      return "/auth";
    case "app-home":
      return "/app";
    case "workspace":
      return `/app/workspaces/${encodeURIComponent(route.workspaceId)}`;
    case "project":
      return `/app/workspaces/${encodeURIComponent(route.workspaceId)}/projects/${encodeURIComponent(route.projectId)}`;
    case "file":
      return `/app/workspaces/${encodeURIComponent(route.workspaceId)}/projects/${encodeURIComponent(route.projectId)}/files/${encodeURIComponent(route.fileId)}`;
    case "page":
      return `/app/workspaces/${encodeURIComponent(route.workspaceId)}/projects/${encodeURIComponent(route.projectId)}/files/${encodeURIComponent(route.fileId)}/pages/${encodeURIComponent(route.pageId)}`;
    case "shared-file":
      return `/share/${encodeURIComponent(route.token)}`;
    case "shared-page":
      return `/share/${encodeURIComponent(route.token)}/pages/${encodeURIComponent(route.pageId)}`;
    case "unknown":
      return "/";
  }
}

function isProtectedRoute(route: AppRoute): boolean {
  return ![
    "root",
    "auth",
    "shared-file",
    "shared-page",
    "unknown"
  ].includes(route.kind);
}

function getRedirectTarget(search: string): string {
  const params = new URLSearchParams(search);
  const redirectTo = params.get("redirectTo");

  if (!redirectTo || !redirectTo.startsWith("/")) {
    return "/app";
  }

  return redirectTo;
}

function setPendingRedirect(path: string) {
  window.sessionStorage.setItem(pendingRedirectStorageKey, path);
}

function consumePendingRedirect(): string | null {
  const value = window.sessionStorage.getItem(pendingRedirectStorageKey);

  if (!value) {
    return null;
  }

  window.sessionStorage.removeItem(pendingRedirectStorageKey);
  return value.startsWith("/") ? value : null;
}

function createApiUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

async function fetchSession(
  apiBaseUrl: string,
  authPath: string
): Promise<AuthContext | null> {
  const response = await fetch(createApiUrl(apiBaseUrl, `${authPath}/me`), {
    credentials: "include"
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Session bootstrap failed with HTTP ${response.status}`);
  }

  return (await response.json()) as AuthContext;
}

async function fetchJson<T>(
  apiBaseUrl: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(createApiUrl(apiBaseUrl, path), {
    credentials: "include",
    ...init,
    headers: buildJsonRequestHeaders(init)
  });

  if (!response.ok) {
    const failure =
      response.status === 204
        ? {}
        : ((await response.json().catch(() => ({}))) as {
            error?: string;
          });
    throw new Error(
      failure.error ?? `Request failed with HTTP ${response.status}`
    );
  }

  return (await response.json()) as T;
}

async function fetchPublicJson<T>(
  apiBaseUrl: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(createApiUrl(apiBaseUrl, path), {
    ...init,
    headers: buildJsonRequestHeaders(init)
  });

  if (!response.ok) {
    const failure =
      response.status === 204
        ? {}
        : ((await response.json().catch(() => ({}))) as {
            error?: string;
          });
    throw new Error(
      failure.error ?? `Request failed with HTTP ${response.status}`
    );
  }

  return (await response.json()) as T;
}

async function fetchLaunchpadResource(
  apiBaseUrl: string,
  preferredWorkspaceId: string | null
): Promise<LaunchpadResource> {
  const workspacesPayload = await fetchJson<WorkspacesResponse>(
    apiBaseUrl,
    "/v1/workspaces",
    {
      method: "GET"
    }
  );
  const activeWorkspace = resolveActiveWorkspace(
    workspacesPayload.workspaces,
    preferredWorkspaceId
  );

  if (!activeWorkspace) {
    return {
      activeWorkspace: null,
      kind: "launchpad",
      projects: [],
      workspaces: workspacesPayload.workspaces
    };
  }

  const projectPayload = await fetchJson<ProjectListResponse>(
    apiBaseUrl,
    `/v1/workspaces/${encodeURIComponent(activeWorkspace.id)}/projects`,
    {
      method: "GET"
    }
  );

  return {
    activeWorkspace: projectPayload.workspace,
    kind: "launchpad",
    projects: projectPayload.projects,
    workspaces: workspacesPayload.workspaces
  };
}

async function fetchRouteResource(
  apiBaseUrl: string,
  route: AppRoute,
  options?: {
    preferredWorkspaceId?: string | null;
  }
): Promise<ResourceData> {
  switch (route.kind) {
    case "app-home": {
      return fetchLaunchpadResource(
        apiBaseUrl,
        options?.preferredWorkspaceId ?? readStoredActiveWorkspaceId()
      );
    }
    case "workspace": {
      const payload = await fetchJson<ProjectListResponse>(
        apiBaseUrl,
        `/v1/workspaces/${encodeURIComponent(route.workspaceId)}/projects`,
        {
          method: "GET"
        }
      );

      return {
        kind: "projects",
        projects: payload.projects,
        workspace: payload.workspace
      };
    }
    case "project": {
      const payload = await fetchJson<FileListResponse>(
        apiBaseUrl,
        `/v1/workspaces/${encodeURIComponent(route.workspaceId)}/projects/${encodeURIComponent(route.projectId)}/files`,
        {
          method: "GET"
        }
      );

      return {
        files: payload.files,
        kind: "files",
        project: payload.project,
        workspace: payload.workspace
      };
    }
    case "file":
    case "page": {
      const payload = await fetchJson<FileOpenResponse>(
        apiBaseUrl,
        `/v1/workspaces/${encodeURIComponent(route.workspaceId)}/projects/${encodeURIComponent(route.projectId)}/files/${encodeURIComponent(route.fileId)}`,
        {
          method: "GET"
        }
      );

      return {
        access: payload.access,
        file: payload.file,
        kind: "file-open",
        pages: payload.pages,
        project: payload.project,
        selectedPageId:
          route.kind === "page"
            ? route.pageId
            : (payload.defaultPageId ?? null),
        workspace: payload.workspace
      };
    }
    case "shared-file":
    case "shared-page": {
      const payload = await fetchPublicJson<SharedFileOpenResponse>(
        apiBaseUrl,
        route.kind === "shared-page"
          ? `/v1/share-links/${encodeURIComponent(route.token)}/pages/${encodeURIComponent(route.pageId)}`
          : `/v1/share-links/${encodeURIComponent(route.token)}`,
        {
          method: "GET"
        }
      );

      return {
        access: payload.access,
        file: payload.file,
        kind: "shared-file-open",
        pages: payload.pages,
        project: payload.project,
        selectedPageId:
          route.kind === "shared-page"
            ? route.pageId
            : (payload.defaultPageId ?? null),
        shareToken: route.token,
        workspace: payload.workspace
      };
    }
    default:
      throw new Error("No resource loader for this route");
  }
}

export function App() {
  const runtime = readRuntimeWebEnv();
  const [location, setLocation] =
    useState<BrowserLocationState>(readBrowserLocation);
  const [sessionState, setSessionState] = useState<SessionState>({
    status: "loading"
  });

  useEffect(() => {
    const handleLocationChange = () => {
      setLocation(readBrowserLocation());
    };

    window.addEventListener("popstate", handleLocationChange);

    return () => {
      window.removeEventListener("popstate", handleLocationChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapSession() {
      setSessionState({ status: "loading" });

      try {
        const auth = await fetchSession(
          runtime.urls.apiBaseUrl,
          runtime.urls.authPath
        );

        if (cancelled) {
          return;
        }

        if (!auth) {
          setSessionState({ status: "unauthenticated" });
          return;
        }

        setSessionState({ status: "authenticated", auth });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setSessionState({
          status: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    void bootstrapSession();

    return () => {
      cancelled = true;
    };
  }, [runtime.urls.apiBaseUrl, runtime.urls.authPath]);

  function navigateTo(path: string, mode: "push" | "replace" = "push") {
    const nextPath = path.startsWith("/") ? path : "/";

    if (
      window.location.pathname +
        window.location.search +
        window.location.hash ===
      nextPath
    ) {
      return;
    }

    if (mode === "replace") {
      window.history.replaceState(null, "", nextPath);
    } else {
      window.history.pushState(null, "", nextPath);
    }

    setLocation(readBrowserLocation());
  }

  const route = parseRoute(location.pathname);
  const searchParams = new URLSearchParams(location.search);
  const authSuccess = searchParams.get("auth") === "success";

  useEffect(() => {
    if (route.kind === "unknown") {
      navigateTo("/", "replace");
    }
  }, [route.kind]);

  useEffect(() => {
    if (sessionState.status === "loading" || sessionState.status === "error") {
      return;
    }

    if (sessionState.status === "unauthenticated") {
      if (isProtectedRoute(route)) {
        navigateTo(
          `/auth?redirectTo=${encodeURIComponent(getRoutePath(route))}`,
          "replace"
        );
        return;
      }

      if (route.kind === "root") {
        const target = authSuccess ? "/auth?error=expired" : "/auth";
        navigateTo(target, "replace");
      }

      return;
    }

    const pendingRedirect =
      (authSuccess ? consumePendingRedirect() : null) ??
      getRedirectTarget(location.search);

    if (route.kind === "root" || route.kind === "auth") {
      navigateTo(pendingRedirect, "replace");
    }
  }, [authSuccess, location.search, route, sessionState.status]);

  async function refreshSessionState() {
    setSessionState({ status: "loading" });

    try {
      const auth = await fetchSession(
        runtime.urls.apiBaseUrl,
        runtime.urls.authPath
      );

      if (!auth) {
        setSessionState({ status: "unauthenticated" });
        return;
      }

      setSessionState({ status: "authenticated", auth });
    } catch (error) {
      setSessionState({
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleLogout() {
    await fetch(
      createApiUrl(runtime.urls.apiBaseUrl, `${runtime.urls.authPath}/logout`),
      {
        credentials: "include",
        method: "POST"
      }
    );

    setSessionState({ status: "unauthenticated" });
    navigateTo("/auth", "replace");
  }

  const isSharedRoute =
    route.kind === "shared-file" || route.kind === "shared-page";

  if (isSharedRoute) {
    return renderWithBuildStamp(
      runtime.appVersion,
      <SharedApp
        apiBaseUrl={runtime.urls.apiBaseUrl}
        onNavigate={(nextRoute) => navigateTo(getRoutePath(nextRoute))}
        route={route}
        runtimeUrls={runtime.urls}
      />
    );
  }

  if (sessionState.status === "loading") {
    return renderWithBuildStamp(
      runtime.appVersion,
      <main className="screen screen-centered">
        <section className="panel panel-compact">
          <p className="eyebrow">OpenMirage</p>
          <h1>Loading your workspace</h1>
          <p className="muted">
            Checking your session and preparing metadata navigation.
          </p>
        </section>
      </main>
    );
  }

  if (sessionState.status === "error") {
    return renderWithBuildStamp(
      runtime.appVersion,
      <main className="screen screen-centered">
        <section className="panel panel-compact">
          <p className="eyebrow">OpenMirage</p>
          <h1>Session bootstrap failed</h1>
          <p className="muted">{sessionState.message}</p>
          <button
            className="button button-primary"
            onClick={() => void refreshSessionState()}
            type="button"
          >
            Retry
          </button>
        </section>
      </main>
    );
  }

  if (sessionState.status === "unauthenticated") {
    return renderWithBuildStamp(
      runtime.appVersion,
      <AuthScreen
        apiBaseUrl={runtime.urls.apiBaseUrl}
        authPath={runtime.urls.authPath}
        authSuccess={authSuccess}
        onMagicLinkSent={(redirectTo) => {
          setPendingRedirect(redirectTo);
        }}
      />
    );
  }

  return renderWithBuildStamp(
    runtime.appVersion,
    <AuthenticatedApp
      apiBaseUrl={runtime.urls.apiBaseUrl}
      auth={sessionState.auth}
      onLogout={() => void handleLogout()}
      onNavigate={(nextRoute) => navigateTo(getRoutePath(nextRoute))}
      route={route}
      runtimeUrls={runtime.urls}
    />
  );
}

function AuthScreen(props: {
  apiBaseUrl: string;
  authPath: string;
  authSuccess: boolean;
  onMagicLinkSent: (redirectTo: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [requestState, setRequestState] = useState<MagicLinkRequestState>({
    status: "idle"
  });

  const redirectTo = getRedirectTarget(window.location.search);
  const errorCode = new URLSearchParams(window.location.search).get("error");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestState({ status: "submitting" });
    props.onMagicLinkSent(redirectTo);

    try {
      const response = await fetch(
        createApiUrl(props.apiBaseUrl, `${props.authPath}/magic-link/request`),
        {
          body: JSON.stringify({
            email,
            ...(displayName.trim() ? { displayName: displayName.trim() } : {})
          }),
          credentials: "include",
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        }
      );

      if (!response.ok) {
        const failure = (await response.json()) as { error?: string };
        throw new Error(
          failure.error ?? `Request failed with HTTP ${response.status}`
        );
      }

      const payload = (await response.json()) as MagicLinkRequestResponse;
      setRequestState({
        status: "success",
        delivery: payload.delivery,
        expiresAt: payload.expiresAt,
        ...(payload.magicLinkUrl ? { magicLinkUrl: payload.magicLinkUrl } : {})
      });
    } catch (error) {
      setRequestState({
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return (
    <main className="screen auth-screen">
      <section className="auth-layout">
        <article className="auth-copy">
          <p className="eyebrow">OpenMirage MVP foundation</p>
          <h1>Sign in to your workspace</h1>
          <p className="lede">
            Sprint 2 adds the first real product flow: navigate workspace,
            project, file, and page metadata in the authenticated app.
          </p>
          <div className="auth-notes">
            <div className="note-card">
              <h2>What you get now</h2>
              <p>
                Workspace-scoped metadata APIs, multi-page file creation, and
                stable browser routes for reopening a file and page after
                reload.
              </p>
            </div>
            <div className="note-card">
              <h2>What comes next</h2>
              <p>
                Sprint 3 will attach real page-scoped collaboration and durable
                page state to these routes.
              </p>
            </div>
          </div>
        </article>

        <article className="panel auth-panel">
          <p className="eyebrow">Authentication</p>
          <h2>Magic link sign-in</h2>
          <p className="muted">
            Enter your email to request a one-time sign-in link.
          </p>
          {props.authSuccess ? (
            <div className="inline-alert inline-alert-success">
              Sign-in succeeded. Finalizing your session.
            </div>
          ) : null}
          {errorCode === "expired" ? (
            <div className="inline-alert inline-alert-error">
              Your session is not active. Request a new magic link to continue.
            </div>
          ) : null}
          <form
            className="auth-form"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <label className="field">
              <span>Email</span>
              <input
                autoComplete="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="dev@openmirage.local"
                required
                type="email"
                value={email}
              />
            </label>
            <label className="field">
              <span>Display name</span>
              <input
                autoComplete="name"
                name="displayName"
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Optional"
                type="text"
                value={displayName}
              />
            </label>
            <button
              className="button button-primary"
              disabled={requestState.status === "submitting"}
              type="submit"
            >
              {requestState.status === "submitting"
                ? "Sending magic link..."
                : "Send magic link"}
            </button>
          </form>
          <AuthRequestResult
            redirectTo={redirectTo}
            requestState={requestState}
          />
        </article>
      </section>
    </main>
  );
}

function AuthRequestResult(props: {
  redirectTo: string;
  requestState: MagicLinkRequestState;
}) {
  if (props.requestState.status === "idle") {
    return null;
  }

  if (props.requestState.status === "error") {
    return (
      <div className="request-result request-result-error">
        <h3>Request failed</h3>
        <p>{props.requestState.message}</p>
      </div>
    );
  }

  if (props.requestState.status === "submitting") {
    return (
      <div className="request-result">
        <h3>Requesting link</h3>
        <p>OpenMirage is creating your one-time sign-in link.</p>
      </div>
    );
  }

  return (
    <div className="request-result request-result-success">
      <h3>Check your magic link</h3>
      <p>
        Delivery mode: <strong>{props.requestState.delivery}</strong>
      </p>
      <p>
        Expires at: {new Date(props.requestState.expiresAt).toLocaleString()}
      </p>
      <p>After sign-in, OpenMirage will send you to {props.redirectTo}.</p>
      {props.requestState.magicLinkUrl ? (
        <a
          className="button button-secondary"
          href={props.requestState.magicLinkUrl}
          rel="noreferrer"
        >
          Open development magic link
        </a>
      ) : null}
    </div>
  );
}

function AuthenticatedApp(props: {
  apiBaseUrl: string;
  auth: AuthContext;
  onLogout: () => void;
  onNavigate: (route: AppRoute) => void;
  route: AppRoute;
  runtimeUrls: RuntimeUrls;
}) {
  const [resourceState, setResourceState] = useState<ResourceState>({
    status: "idle"
  });
  const [appHomeWorkspaceId, setAppHomeWorkspaceId] = useState<string | null>(
    readStoredActiveWorkspaceId
  );

  useEffect(() => {
    if (
      props.route.kind === "workspace" ||
      props.route.kind === "project" ||
      props.route.kind === "file" ||
      props.route.kind === "page"
    ) {
      writeStoredActiveWorkspaceId(props.route.workspaceId);
      setAppHomeWorkspaceId(props.route.workspaceId);
      return;
    }

    if (props.route.kind === "app-home") {
      setAppHomeWorkspaceId((current) => current ?? readStoredActiveWorkspaceId());
    }
  }, [props.route]);

  useEffect(() => {
    if (!isProtectedRoute(props.route)) {
      setResourceState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setResourceState({ status: "loading" });
    const routeResourceOptions =
      props.route.kind === "app-home"
        ? { preferredWorkspaceId: appHomeWorkspaceId }
        : undefined;

    void fetchRouteResource(props.apiBaseUrl, props.route, routeResourceOptions)
      .then((value) => {
        if (!cancelled) {
          setResourceState({ status: "loaded", value });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setResourceState({
            status: "error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    props.apiBaseUrl,
    props.route,
    props.route.kind === "app-home" ? appHomeWorkspaceId : null
  ]);

  useEffect(() => {
    if (resourceState.status !== "loaded") {
      return;
    }

    if (resourceState.value.kind !== "launchpad") {
      return;
    }

    if (!resourceState.value.activeWorkspace) {
      clearStoredActiveWorkspaceId();

      if (appHomeWorkspaceId !== null) {
        setAppHomeWorkspaceId(null);
      }

      return;
    }

    const resolvedWorkspaceId = resourceState.value.activeWorkspace.id;
    writeStoredActiveWorkspaceId(resolvedWorkspaceId);

    if (appHomeWorkspaceId === null) {
      setAppHomeWorkspaceId(resolvedWorkspaceId);
    }
  }, [appHomeWorkspaceId, resourceState]);

  async function reloadResource() {
    if (!isProtectedRoute(props.route)) {
      return;
    }

    setResourceState({ status: "loading" });

    try {
      const routeResourceOptions =
        props.route.kind === "app-home"
          ? { preferredWorkspaceId: appHomeWorkspaceId }
          : undefined;
      const value = await fetchRouteResource(
        props.apiBaseUrl,
        props.route,
        routeResourceOptions
      );
      setResourceState({ status: "loaded", value });
    } catch (error) {
      setResourceState({
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleCreateProject(name: string) {
    const workspaceId =
      props.route.kind === "workspace"
        ? props.route.workspaceId
        : props.route.kind === "app-home" &&
            resourceState.status === "loaded" &&
            resourceState.value.kind === "launchpad"
          ? resourceState.value.activeWorkspace?.id ?? null
          : null;

    if (!workspaceId) {
      return;
    }

    const project = await fetchJson<ProjectDto>(
      props.apiBaseUrl,
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/projects`,
      {
        body: JSON.stringify({ name } satisfies CreateProjectInput),
        method: "POST"
      }
    );
    writeStoredActiveWorkspaceId(workspaceId);
    setAppHomeWorkspaceId(workspaceId);
    props.onNavigate({
      kind: "project",
      projectId: project.id,
      workspaceId
    });
  }

  async function handleRenameProject(projectId: string, name: string) {
    const route = props.route;
    const workspaceId =
      route.kind === "workspace" ||
      route.kind === "project" ||
      route.kind === "file" ||
      route.kind === "page"
        ? route.workspaceId
        : null;

    if (!workspaceId) {
      return;
    }

    await fetchJson<ProjectDto>(
      props.apiBaseUrl,
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}`,
      {
        body: JSON.stringify({ name } satisfies RenameProjectInput),
        method: "PATCH"
      }
    );
    await reloadResource();
  }

  async function handleCreateFile(name: string, pageNames: string[]) {
    if (props.route.kind !== "project") {
      return;
    }

    const payload = await fetchJson<FileOpenResponse>(
      props.apiBaseUrl,
      `/v1/workspaces/${encodeURIComponent(props.route.workspaceId)}/projects/${encodeURIComponent(props.route.projectId)}/files`,
      {
        body: JSON.stringify({
          initialPages: pageNames.map((pageName) => ({ name: pageName })),
          name
        } satisfies CreateFileInput),
        method: "POST"
      }
    );

    const nextPageId = payload.defaultPageId ?? payload.pages[0]?.id;

    if (nextPageId) {
      props.onNavigate({
        fileId: payload.file.id,
        kind: "page",
        pageId: nextPageId,
        projectId: payload.project.id,
        workspaceId: payload.workspace.id
      });
      return;
    }

    props.onNavigate({
      fileId: payload.file.id,
      kind: "file",
      projectId: payload.project.id,
      workspaceId: payload.workspace.id
    });
  }

  async function handleRenameFile(fileId: string, name: string) {
    const route = props.route;

    if (
      route.kind !== "project" &&
      route.kind !== "file" &&
      route.kind !== "page"
    ) {
      return;
    }

    await fetchJson<FileDto>(
      props.apiBaseUrl,
      `/v1/workspaces/${encodeURIComponent(route.workspaceId)}/projects/${encodeURIComponent(route.projectId)}/files/${encodeURIComponent(fileId)}`,
      {
        body: JSON.stringify({ name } satisfies RenameFileInput),
        method: "PATCH"
      }
    );
    await reloadResource();
  }

  async function handleCreatePage(name: string) {
    const route = props.route;

    if (route.kind !== "file" && route.kind !== "page") {
      return;
    }

    const page = await fetchJson<PageDto>(
      props.apiBaseUrl,
      `/v1/workspaces/${encodeURIComponent(route.workspaceId)}/projects/${encodeURIComponent(route.projectId)}/files/${encodeURIComponent(route.fileId)}/pages`,
      {
        body: JSON.stringify({ name } satisfies CreatePageInput),
        method: "POST"
      }
    );

    props.onNavigate({
      fileId: route.fileId,
      kind: "page",
      pageId: page.id,
      projectId: route.projectId,
      workspaceId: route.workspaceId
    });
  }

  async function handleRenamePage(pageId: string, name: string) {
    const route = props.route;

    if (route.kind !== "file" && route.kind !== "page") {
      return;
    }

    await fetchJson<PageDto>(
      props.apiBaseUrl,
      `/v1/workspaces/${encodeURIComponent(route.workspaceId)}/projects/${encodeURIComponent(route.projectId)}/files/${encodeURIComponent(route.fileId)}/pages/${encodeURIComponent(pageId)}`,
      {
        body: JSON.stringify({ name } satisfies RenamePageInput),
        method: "PATCH"
      }
    );
    await reloadResource();
  }

  function handleSelectLaunchpadWorkspace(workspaceId: string) {
    writeStoredActiveWorkspaceId(workspaceId);
    setAppHomeWorkspaceId(workspaceId);
  }

  const editorData: FileOpenResource | null =
    props.route.kind === "page" &&
    resourceState.status === "loaded" &&
    resourceState.value.kind === "file-open"
      ? resourceState.value
      : null;
  const isEditorRoute = Boolean(editorData);
  const currentPageId = props.route.kind === "page" ? props.route.pageId : null;
  const editorPage =
    editorData && currentPageId
      ? (editorData.pages.find((page) => page.id === currentPageId) ?? null)
      : null;

  return (
    <main
      className={`screen app-screen ${isEditorRoute ? "app-screen-editor" : ""}`}
    >
      <header className="app-header">
        <div>
          <p className="eyebrow">OpenMirage</p>
          <h1 className="app-title">
            {isEditorRoute
              ? "Canvas editor"
              : props.route.kind === "app-home"
                ? "Workspace launchpad"
                : "Workspace navigation"}
          </h1>
          <p className="muted">
            {isEditorRoute
              ? "Hydrate page content from collaboration state into a browser-owned scene graph and canvas renderer."
              : props.route.kind === "app-home"
                ? "Reopen the right workspace quickly without dropping directly into a canvas."
                : "Use deep links and fallback routes to move through the workspace hierarchy."}
          </p>
        </div>
        <div className="header-actions">
          <div className="identity-chip">
            <strong>{props.auth.user.displayName}</strong>
            <span>{props.auth.user.email}</span>
          </div>
          <button
            className="button button-secondary"
            onClick={props.onLogout}
            type="button"
          >
            Log out
          </button>
        </div>
      </header>

      {editorData && editorPage && props.route.kind === "page" ? (
        <PageEditorScreen
          access={editorData.access}
          collab={props.runtimeUrls}
          currentUser={props.auth.user}
          file={editorData.file}
          onCreatePage={handleCreatePage}
          onNavigatePage={(pageId) =>
            props.onNavigate({
              fileId: editorData.file.id,
              kind: "page",
              pageId,
              projectId: editorData.project.id,
              workspaceId: editorData.workspace.id
            })
          }
          onRenameFile={handleRenameFile}
          onRenamePage={handleRenamePage}
          page={editorPage}
          pages={editorData.pages}
          project={editorData.project}
          route={props.route}
          shareToken={null}
          workspace={editorData.workspace}
        />
      ) : (
        <section className="app-shell">
          <aside className="panel sidebar-panel">
            <p className="eyebrow">Routing</p>
            <h2>Current route</h2>
            <p className="route-chip">{getRoutePath(props.route)}</p>
            <button
              className="button button-secondary button-full"
              onClick={() => props.onNavigate({ kind: "app-home" })}
              type="button"
            >
              Back to launchpad
            </button>
            <dl className="detail-list compact-list">
              <div>
                <dt>User ID</dt>
                <dd>{props.auth.user.id}</dd>
              </div>
              <div>
                <dt>Session expires</dt>
                <dd>
                  {new Date(props.auth.session.expiresAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt>Memberships</dt>
                <dd>{props.auth.memberships.length}</dd>
              </div>
            </dl>
          </aside>

          <section className="main-panel-stack">
            {resourceState.status === "loading" ? (
              <article className="panel">
                <p className="eyebrow">Loading</p>
                <h2>
                  {props.route.kind === "app-home"
                    ? "Loading launchpad"
                    : "Fetching metadata"}
                </h2>
                <p className="muted">
                  {props.route.kind === "app-home"
                    ? "Restoring your workspace dashboard from browser-local state."
                    : "Reading the current workspace navigation state."}
                </p>
              </article>
            ) : null}
            {resourceState.status === "error" ? (
              <article className="panel">
                <p className="eyebrow">Request failed</p>
                <h2>Metadata load failed</h2>
                <p className="muted">{resourceState.message}</p>
                <button
                  className="button button-primary"
                  onClick={() => void reloadResource()}
                  type="button"
                >
                  Retry
                </button>
              </article>
            ) : null}
            {resourceState.status === "loaded" ? (
              <NavigationContent
                data={resourceState.value}
                onCreateFile={handleCreateFile}
                onCreatePage={handleCreatePage}
                onCreateProject={handleCreateProject}
                onNavigate={props.onNavigate}
                onRenameFile={handleRenameFile}
                onRenamePage={handleRenamePage}
                onRenameProject={handleRenameProject}
                onSelectLaunchpadWorkspace={handleSelectLaunchpadWorkspace}
              />
            ) : null}
          </section>
        </section>
      )}
    </main>
  );
}

function createSharedViewer(token: string): AuthenticatedUser {
  return {
    avatarUrl: null,
    displayName: "Shared viewer",
    email: `share-${token}@openmirage.local`,
    id: `share-${token}`
  };
}

function SharedApp(props: {
  apiBaseUrl: string;
  onNavigate: (route: AppRoute) => void;
  route: Extract<AppRoute, { kind: "shared-file" | "shared-page" }>;
  runtimeUrls: RuntimeUrls;
}) {
  const [resourceState, setResourceState] = useState<ResourceState>({
    status: "loading"
  });

  useEffect(() => {
    let cancelled = false;
    setResourceState({ status: "loading" });

    void fetchRouteResource(props.apiBaseUrl, props.route)
      .then((value) => {
        if (!cancelled) {
          setResourceState({ status: "loaded", value });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setResourceState({
            status: "error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.apiBaseUrl, props.route]);

  const editorData =
    resourceState.status === "loaded" &&
    resourceState.value.kind === "shared-file-open"
      ? resourceState.value
      : null;
  const currentPageId =
    props.route.kind === "shared-page" ? props.route.pageId : null;
  const editorPage =
    editorData && (currentPageId ?? editorData.selectedPageId)
      ? (editorData.pages.find(
          (page) => page.id === (currentPageId ?? editorData.selectedPageId)
        ) ?? null)
      : null;

  if (editorData && editorPage) {
    return (
      <main className="screen app-screen app-screen-editor">
        <header className="app-header">
          <div>
            <p className="eyebrow">OpenMirage</p>
            <h1 className="app-title">Shared inspect view</h1>
            <p className="muted">
              Lightweight read-only handoff with inspect values and page
              navigation.
            </p>
          </div>
          <div className="header-actions">
            <div className="identity-chip">
              <strong>Read-only share link</strong>
              <span>{editorData.file.name}</span>
            </div>
          </div>
        </header>

        <PageEditorScreen
          access={editorData.access}
          collab={props.runtimeUrls}
          currentUser={createSharedViewer(editorData.shareToken)}
          file={editorData.file}
          onCreatePage={async () => undefined}
          onNavigatePage={(pageId) =>
            props.onNavigate({
              kind: "shared-page",
              pageId,
              token: editorData.shareToken
            })
          }
          onRenameFile={async () => undefined}
          onRenamePage={async () => undefined}
          page={editorPage}
          pages={editorData.pages}
          project={editorData.project}
          route={{
            fileId: editorData.file.id,
            pageId: editorPage.id,
            projectId: editorData.project.id,
            workspaceId: editorData.workspace.id
          }}
          shareToken={editorData.shareToken}
          workspace={editorData.workspace}
        />
      </main>
    );
  }

  return (
    <main className="screen screen-centered">
      <section className="panel panel-compact">
        <p className="eyebrow">Shared handoff</p>
        <h1>
          {resourceState.status === "error"
            ? "Shared file unavailable"
            : "Loading shared file"}
        </h1>
        <p className="muted">
          {resourceState.status === "error"
            ? resourceState.message
            : "Resolving the shared file and page metadata."}
        </p>
      </section>
    </main>
  );
}

function NavigationContent(props: {
  data: ResourceData;
  onCreateFile: (name: string, pageNames: string[]) => Promise<void>;
  onCreatePage: (name: string) => Promise<void>;
  onCreateProject: (name: string) => Promise<void>;
  onNavigate: (route: AppRoute) => void;
  onRenameFile: (fileId: string, name: string) => Promise<void>;
  onRenamePage: (pageId: string, name: string) => Promise<void>;
  onRenameProject: (projectId: string, name: string) => Promise<void>;
  onSelectLaunchpadWorkspace: (workspaceId: string) => void;
}) {
  switch (props.data.kind) {
    case "launchpad": {
      const data = props.data;
      const activeWorkspace = data.activeWorkspace;

      return (
        <>
          <article className="panel">
            <p className="eyebrow">Launchpad</p>
            <h2>{activeWorkspace ? activeWorkspace.name : "No workspaces yet"}</h2>
            <p className="muted">
              {activeWorkspace
                ? "This workspace is restored from browser-local state and stays separate from direct file/page routes."
                : "You do not have access to any workspaces yet."}
            </p>
            {activeWorkspace ? (
              <div className="action-strip">
                <CreateProjectForm onCreate={props.onCreateProject} />
                <button
                  className="button button-secondary"
                  onClick={() =>
                    props.onNavigate({
                      kind: "workspace",
                      workspaceId: activeWorkspace.id
                    })
                  }
                  type="button"
                >
                  Open workspace route
                </button>
              </div>
            ) : null}
          </article>
          <article className="panel">
            <p className="eyebrow">Workspaces</p>
            <h2>Switch active workspace</h2>
            <ul className="resource-list">
              {data.workspaces.map((workspace) => (
                <li key={workspace.id}>
                  <div className="resource-row">
                    <button
                      className={`resource-button ${
                        workspace.id === activeWorkspace?.id
                          ? "resource-button-active"
                          : ""
                      }`}
                      onClick={() => props.onSelectLaunchpadWorkspace(workspace.id)}
                      type="button"
                    >
                      <strong>{workspace.name}</strong>
                      <span>
                        {workspace.slug} · {workspace.role}
                        {workspace.id === activeWorkspace?.id
                          ? " · Active"
                          : ""}
                      </span>
                    </button>
                    <button
                      className="button button-secondary"
                      onClick={() =>
                        props.onNavigate({
                          kind: "workspace",
                          workspaceId: workspace.id
                        })
                      }
                      type="button"
                    >
                      View route
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </article>
          {activeWorkspace ? (
            <article className="panel">
              <p className="eyebrow">Projects</p>
              <h2>Recent project list</h2>
              <p className="muted">
                Open a project or use its deep-link route. File grouping stays in
                the next sprint.
              </p>
              {data.projects.length > 0 ? (
                <ul className="resource-list">
                  {data.projects.map((project) => (
                    <li key={project.id}>
                      <div className="resource-row">
                        <button
                          className="resource-button"
                          onClick={() =>
                            props.onNavigate({
                              kind: "project",
                              projectId: project.id,
                              workspaceId: activeWorkspace.id
                            })
                          }
                          type="button"
                        >
                          <strong>{project.name}</strong>
                          <span>
                            Updated {new Date(project.updatedAt).toLocaleString()}
                          </span>
                        </button>
                        <button
                          className="button button-secondary"
                          onClick={() =>
                            props.onNavigate({
                              kind: "workspace",
                              workspaceId: activeWorkspace.id
                            })
                          }
                          type="button"
                        >
                          Workspace route
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  No projects in this workspace yet. Create one from the
                  launchpad to keep `/app` as the primary entry point.
                </p>
              )}
            </article>
          ) : null}
        </>
      );
    }
    case "projects": {
      const data = props.data;

      return (
        <>
          <article className="panel">
            <Breadcrumbs
              items={[
                {
                  label: "Workspaces",
                  route: { kind: "app-home" }
                },
                {
                  label: data.workspace.name,
                  route: {
                    kind: "workspace",
                    workspaceId: data.workspace.id
                  }
                }
              ]}
              onNavigate={props.onNavigate}
            />
            <p className="eyebrow">Projects</p>
            <h2>{data.workspace.name}</h2>
            <p className="muted">Create a project or open an existing one.</p>
            <CreateProjectForm onCreate={props.onCreateProject} />
          </article>
          <article className="panel">
            <ul className="resource-list">
              {data.projects.map((project) => (
                <li key={project.id}>
                  <div className="resource-row">
                    <button
                      className="resource-button"
                      onClick={() =>
                        props.onNavigate({
                          kind: "project",
                          projectId: project.id,
                          workspaceId: data.workspace.id
                        })
                      }
                      type="button"
                    >
                      <strong>{project.name}</strong>
                      <span>
                        Updated {new Date(project.updatedAt).toLocaleString()}
                      </span>
                    </button>
                    <InlineRenameForm
                      label="Rename project"
                      onSubmit={(name) =>
                        props.onRenameProject(project.id, name)
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </>
      );
    }
    case "files": {
      const data = props.data;

      return (
        <>
          <article className="panel">
            <Breadcrumbs
              items={[
                {
                  label: "Workspaces",
                  route: { kind: "app-home" }
                },
                {
                  label: data.workspace.name,
                  route: {
                    kind: "workspace",
                    workspaceId: data.workspace.id
                  }
                },
                {
                  label: data.project.name,
                  route: {
                    kind: "project",
                    projectId: data.project.id,
                    workspaceId: data.workspace.id
                  }
                }
              ]}
              onNavigate={props.onNavigate}
            />
            <p className="eyebrow">Files</p>
            <h2>{data.project.name}</h2>
            <p className="muted">
              Create a file with multiple pages, then open one of its pages.
            </p>
            <CreateFileForm onCreate={props.onCreateFile} />
          </article>
          <article className="panel">
            <ul className="resource-list">
              {data.files.map((file) => (
                <li key={file.id}>
                  <div className="resource-row">
                    <button
                      className="resource-button"
                      onClick={() =>
                        props.onNavigate({
                          fileId: file.id,
                          kind: "file",
                          projectId: data.project.id,
                          workspaceId: data.workspace.id
                        })
                      }
                      type="button"
                    >
                      <strong>{file.name}</strong>
                      <span>
                        Updated {new Date(file.updatedAt).toLocaleString()}
                      </span>
                    </button>
                    <InlineRenameForm
                      label="Rename file"
                      onSubmit={(name) => props.onRenameFile(file.id, name)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </>
      );
    }
    case "file-open": {
      const data = props.data;

      return (
        <>
          <article className="panel">
            <Breadcrumbs
              items={[
                {
                  label: "Workspaces",
                  route: { kind: "app-home" }
                },
                {
                  label: data.workspace.name,
                  route: {
                    kind: "workspace",
                    workspaceId: data.workspace.id
                  }
                },
                {
                  label: data.project.name,
                  route: {
                    kind: "project",
                    projectId: data.project.id,
                    workspaceId: data.workspace.id
                  }
                },
                {
                  label: data.file.name,
                  route: {
                    fileId: data.file.id,
                    kind: "file",
                    projectId: data.project.id,
                    workspaceId: data.workspace.id
                  }
                }
              ]}
              onNavigate={props.onNavigate}
            />
            <p className="eyebrow">File open</p>
            <h2>{data.file.name}</h2>
            <p className="muted">
              This is the Sprint 2 open flow. The page route is stable and can
              be reloaded; the editor arrives in a later sprint.
            </p>
            <div className="action-strip">
              <InlineRenameForm
                label="Rename file"
                onSubmit={(name) => props.onRenameFile(data.file.id, name)}
              />
              <CreatePageForm onCreate={props.onCreatePage} />
            </div>
          </article>
          <article className="panel">
            <div className="page-open-summary">
              <div>
                <p className="eyebrow">Selected page</p>
                <h3>
                  {data.pages.find((page) => page.id === data.selectedPageId)
                    ?.name ?? "No page selected"}
                </h3>
              </div>
              <div className="selected-page-chip">
                {data.selectedPageId ?? "No default page"}
              </div>
            </div>
            <ul className="resource-list">
              {data.pages.map((page) => (
                <li key={page.id}>
                  <div className="resource-row">
                    <button
                      className={`resource-button ${
                        page.id === data.selectedPageId
                          ? "resource-button-active"
                          : ""
                      }`}
                      onClick={() =>
                        props.onNavigate({
                          fileId: data.file.id,
                          kind: "page",
                          pageId: page.id,
                          projectId: data.project.id,
                          workspaceId: data.workspace.id
                        })
                      }
                      type="button"
                    >
                      <strong>{page.name}</strong>
                      <span>Order {page.orderIndex + 1}</span>
                    </button>
                    <InlineRenameForm
                      label="Rename page"
                      onSubmit={(name) => props.onRenamePage(page.id, name)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </>
      );
    }
  }
}

function Breadcrumbs(props: {
  items: Array<{ label: string; route: AppRoute }>;
  onNavigate: (route: AppRoute) => void;
}) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {props.items.map((item) => (
        <button
          className="breadcrumb-link"
          key={`${item.label}:${getRoutePath(item.route)}`}
          onClick={() => props.onNavigate(item.route)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function CreateProjectForm(props: {
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();

    if (!trimmed) {
      setError("Project name is required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await props.onCreate(trimmed);
      setName("");
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : String(submissionError)
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="inline-form"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <input
        onChange={(event) => setName(event.target.value)}
        placeholder="New project name"
        type="text"
        value={name}
      />
      <button
        className="button button-primary"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Creating..." : "Create project"}
      </button>
      {error ? <p className="form-error">{error}</p> : null}
    </form>
  );
}

function CreateFileForm(props: {
  onCreate: (name: string, pageNames: string[]) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [pageNames, setPageNames] = useState(["Page 1", "Page 2"]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updatePageName(index: number, value: string) {
    setPageNames((current) =>
      current.map((entry, currentIndex) =>
        currentIndex === index ? value : entry
      )
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedPages = pageNames
      .map((pageName) => pageName.trim())
      .filter(Boolean);

    if (!trimmedName) {
      setError("File name is required.");
      return;
    }

    if (trimmedPages.length < 2) {
      setError("Add at least two pages for the initial file.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await props.onCreate(trimmedName, trimmedPages);
      setName("");
      setPageNames(["Page 1", "Page 2"]);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : String(submissionError)
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stack-form" onSubmit={(event) => void handleSubmit(event)}>
      <input
        onChange={(event) => setName(event.target.value)}
        placeholder="New file name"
        type="text"
        value={name}
      />
      <div className="page-grid">
        {pageNames.map((pageName, index) => (
          <input
            key={`page-${index}`}
            onChange={(event) => updatePageName(index, event.target.value)}
            placeholder={`Page ${index + 1}`}
            type="text"
            value={pageName}
          />
        ))}
      </div>
      <div className="action-strip">
        <button
          className="button button-secondary"
          onClick={() =>
            setPageNames((current) => [
              ...current,
              `Page ${current.length + 1}`
            ])
          }
          type="button"
        >
          Add page field
        </button>
        <button
          className="button button-primary"
          disabled={submitting}
          type="submit"
        >
          {submitting ? "Creating..." : "Create file"}
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </form>
  );
}

function CreatePageForm(props: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();

    if (!trimmed) {
      setError("Page name is required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await props.onCreate(trimmed);
      setName("");
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : String(submissionError)
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="inline-form"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <input
        onChange={(event) => setName(event.target.value)}
        placeholder="New page name"
        type="text"
        value={name}
      />
      <button
        className="button button-primary"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Creating..." : "Create page"}
      </button>
      {error ? <p className="form-error">{error}</p> : null}
    </form>
  );
}

function InlineRenameForm(props: {
  label: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();

    if (!trimmed) {
      setError("Name is required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await props.onSubmit(trimmed);
      setEditing(false);
      setName("");
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : String(submissionError)
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing) {
    return (
      <button
        className="button button-secondary"
        onClick={() => setEditing(true)}
        type="button"
      >
        {props.label}
      </button>
    );
  }

  return (
    <form
      className="rename-form"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <input
        onChange={(event) => setName(event.target.value)}
        placeholder="New name"
        type="text"
        value={name}
      />
      <button
        className="button button-primary"
        disabled={submitting}
        type="submit"
      >
        Save
      </button>
      <button
        className="button button-secondary"
        onClick={() => {
          setEditing(false);
          setName("");
          setError(null);
        }}
        type="button"
      >
        Cancel
      </button>
      {error ? <p className="form-error">{error}</p> : null}
    </form>
  );
}
