import { readWebEnv } from "@openmirage/config-env";
import { type HealthStatus } from "@openmirage/types";
import { useEffect, useState } from "react";

type ProbeState =
  | { status: "checking" }
  | { status: "healthy"; summary: string }
  | { status: "unreachable"; summary: string };

function probeLabel(state: ProbeState): string {
  switch (state.status) {
    case "checking":
      return "Checking";
    case "healthy":
      return "Healthy";
    case "unreachable":
      return "Unreachable";
  }
}

async function fetchHealth(url: string): Promise<HealthStatus> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as HealthStatus;
}

export function App() {
  const runtime = readWebEnv(import.meta.env);
  const [apiState, setApiState] = useState<ProbeState>({
    status: "checking"
  });
  const [collabState, setCollabState] = useState<ProbeState>({
    status: "checking"
  });

  useEffect(() => {
    let cancelled = false;

    async function probeServices() {
      try {
        const apiHealth = await fetchHealth(`${runtime.urls.apiBaseUrl}/healthz`);

        if (!cancelled) {
          setApiState({
            status: "healthy",
            summary: `${apiHealth.service} responded in ${apiHealth.environment}`
          });
        }
      } catch (error) {
        if (!cancelled) {
          setApiState({
            status: "unreachable",
            summary: error instanceof Error ? error.message : String(error)
          });
        }
      }

      try {
        const collabHealth = await fetchHealth(
          `${runtime.urls.collabHttpUrl}/healthz`
        );

        if (!cancelled) {
          setCollabState({
            status: "healthy",
            summary: `${collabHealth.service} websocket path ${collabHealth.details.websocketPath}`
          });
        }
      } catch (error) {
        if (!cancelled) {
          setCollabState({
            status: "unreachable",
            summary: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    void probeServices();

    return () => {
      cancelled = true;
    };
  }, [runtime.environment, runtime.urls.apiBaseUrl, runtime.urls.collabHttpUrl]);

  const apiSummary =
    apiState.status === "checking" ? "Waiting for API probe..." : apiState.summary;
  const collabSummary =
    collabState.status === "checking"
      ? "Waiting for collab probe..."
      : collabState.summary;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">OpenMirage runtime slice</p>
        <h1>Platform shell status</h1>
        <p className="lede">
          This environment is intentionally product-empty. It verifies the web,
          API, collaboration, and worker surfaces before editor work begins.
        </p>
        <div className="hero-actions">
          <a
            className="primary-link"
            href={`${runtime.urls.apiBaseUrl}${runtime.urls.authPath}/entry`}
            rel="noreferrer"
            target="_blank"
          >
            Open auth entrypoint
          </a>
        </div>
      </section>

      <section className="grid">
        <article className="card">
          <h2>Environment</h2>
          <dl>
            <div>
              <dt>Mode</dt>
              <dd>{runtime.environment}</dd>
            </div>
            <div>
              <dt>API</dt>
              <dd>{runtime.urls.apiBaseUrl}</dd>
            </div>
            <div>
              <dt>Collab HTTP</dt>
              <dd>{runtime.urls.collabHttpUrl}</dd>
            </div>
            <div>
              <dt>Collab WebSocket</dt>
              <dd>{runtime.urls.collabWsUrl}</dd>
            </div>
          </dl>
        </article>

        <article className="card">
          <h2>Service reachability</h2>
          <div className="status-row">
            <span className={`pill pill-${apiState.status}`}>
              {probeLabel(apiState)}
            </span>
            <div>
              <strong>API</strong>
              <p>{apiSummary}</p>
            </div>
          </div>
          <div className="status-row">
            <span className={`pill pill-${collabState.status}`}>
              {probeLabel(collabState)}
            </span>
            <div>
              <strong>Collab</strong>
              <p>{collabSummary}</p>
            </div>
          </div>
        </article>

        <article className="card">
          <h2>Boundaries</h2>
          <ul>
            <li>API owns auth, sessions, and product-domain metadata.</li>
            <li>Collab owns page-scoped realtime sync and awareness transport.</li>
            <li>Worker remains bounded to background status and future jobs.</li>
            <li>This slice does not ship editor or document features yet.</li>
          </ul>
        </article>
      </section>
    </main>
  );
}
