import { type AuthContext } from "@openmirage/types";
import { type FormEvent, useEffect, useState } from "react";
import { readRuntimeWebEnv } from "./runtime-env";

const knownRoutes = new Set(["/", "/app", "/auth"]);
const pendingRedirectStorageKey = "openmirage.pendingRedirect";

type RoutePath = "/" | "/app" | "/auth";

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

function readBrowserLocation(): BrowserLocationState {
  return {
    pathname: window.location.pathname,
    search: window.location.search
  };
}

function normalizeRoutePath(pathname: string): RoutePath {
  if (knownRoutes.has(pathname)) {
    return pathname as RoutePath;
  }

  return "/";
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

export function App() {
  const runtime = readRuntimeWebEnv();
  const [location, setLocation] = useState<BrowserLocationState>(
    readBrowserLocation
  );
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
      window.location.pathname + window.location.search + window.location.hash ===
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

  const routePath = normalizeRoutePath(location.pathname);
  const searchParams = new URLSearchParams(location.search);
  const authSuccess = searchParams.get("auth") === "success";

  useEffect(() => {
    if (routePath !== location.pathname) {
      navigateTo(routePath, "replace");
    }
  }, [location.pathname, routePath]);

  useEffect(() => {
    if (sessionState.status === "loading" || sessionState.status === "error") {
      return;
    }

    if (sessionState.status === "unauthenticated") {
      if (routePath === "/app") {
        navigateTo("/auth?redirectTo=/app", "replace");
        return;
      }

      if (routePath === "/") {
        const target = authSuccess ? "/auth?error=expired" : "/auth";
        navigateTo(target, "replace");
      }

      return;
    }

    const pendingRedirect =
      (authSuccess ? consumePendingRedirect() : null) ??
      getRedirectTarget(location.search);

    if (routePath === "/" || routePath === "/auth") {
      navigateTo(pendingRedirect, "replace");
    }
  }, [authSuccess, location.search, routePath, sessionState.status]);

  async function refreshSessionState() {
    setSessionState({ status: "loading" });

    try {
      const auth = await fetchSession(runtime.urls.apiBaseUrl, runtime.urls.authPath);

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
    await fetch(createApiUrl(runtime.urls.apiBaseUrl, `${runtime.urls.authPath}/logout`), {
      method: "POST",
      credentials: "include"
    });

    setSessionState({ status: "unauthenticated" });
    navigateTo("/auth", "replace");
  }

  if (sessionState.status === "loading") {
    return (
      <main className="screen screen-centered">
        <section className="panel panel-compact">
          <p className="eyebrow">OpenMirage</p>
          <h1>Loading your workspace</h1>
          <p className="muted">
            Checking your session and preparing the authenticated shell.
          </p>
        </section>
      </main>
    );
  }

  if (sessionState.status === "error") {
    return (
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
    return (
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

  return (
    <AuthenticatedShell
      auth={sessionState.auth}
      onLogout={() => void handleLogout()}
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
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            email,
            ...(displayName.trim() ? { displayName: displayName.trim() } : {})
          })
        }
      );

      if (!response.ok) {
        const failure = (await response.json()) as { error?: string };
        throw new Error(failure.error ?? `Request failed with HTTP ${response.status}`);
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
          <h1>Sign in to the app shell</h1>
          <p className="lede">
            Sprint 1 replaces the empty platform page with the authenticated
            product shell. Use a magic link to enter the workspace.
          </p>
          <div className="auth-notes">
            <div className="note-card">
              <h2>What you get now</h2>
              <p>
                An authenticated shell, stable browser routes, and shared MVP
                contracts for the product and editor layers.
              </p>
            </div>
            <div className="note-card">
              <h2>What comes next</h2>
              <p>
                Workspace, project, file, and page navigation will build on
                this shell in Sprint 2.
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
          <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
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
          <AuthRequestResult redirectTo={redirectTo} requestState={requestState} />
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
      <p>Expires at: {new Date(props.requestState.expiresAt).toLocaleString()}</p>
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

function AuthenticatedShell(props: {
  auth: AuthContext;
  onLogout: () => void;
}) {
  const primaryMembership = props.auth.memberships[0] ?? null;

  return (
    <main className="screen app-screen">
      <header className="app-header">
        <div>
          <p className="eyebrow">OpenMirage</p>
          <h1>Authenticated app shell</h1>
        </div>
        <div className="header-actions">
          <div className="identity-chip">
            <strong>{props.auth.user.displayName}</strong>
            <span>{props.auth.user.email}</span>
          </div>
          <button className="button button-secondary" onClick={props.onLogout} type="button">
            Log out
          </button>
        </div>
      </header>

      <section className="app-grid">
        <article className="panel">
          <p className="eyebrow">Workspace context</p>
          <h2>Ready for product navigation</h2>
          <p className="muted">
            This signed-in shell is the new foundation for project, file, and
            page flows. The platform-status landing page is no longer the
            authenticated destination.
          </p>
          <dl className="detail-list">
            <div>
              <dt>User ID</dt>
              <dd>{props.auth.user.id}</dd>
            </div>
            <div>
              <dt>Session expires</dt>
              <dd>{new Date(props.auth.session.expiresAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Primary workspace</dt>
              <dd>{primaryMembership?.workspaceId ?? "No memberships found"}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{primaryMembership?.role ?? "n/a"}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <p className="eyebrow">Current scope</p>
          <h2>Sprint 1 completion state</h2>
          <ul className="feature-list">
            <li>Session-aware routing is active for `/`, `/auth`, and `/app`.</li>
            <li>Magic-link authentication happens inside the web app.</li>
            <li>Shared TypeScript contracts exist for product and editor work.</li>
          </ul>
        </article>
      </section>
    </main>
  );
}
