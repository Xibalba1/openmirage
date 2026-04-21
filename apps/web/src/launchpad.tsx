import {
  type FileOpenResponse,
  type LaunchpadProjectGroup,
  type LaunchpadFileSummary,
  type WorkspaceDetailDto
} from "@openmirage/types";
import { type FormEvent, useEffect, useState } from "react";

type FileDetailsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; value: FileOpenResponse }
  | { status: "error"; message: string };

export interface LaunchpadViewData {
  activeWorkspace: WorkspaceDetailDto | null;
  projectGroups: LaunchpadProjectGroup[];
  workspaces: WorkspaceDetailDto[];
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function PreviewPlaceholder(props: { label: string }) {
  return (
    <div className="preview-placeholder" aria-hidden="true">
      <div className="preview-frame preview-frame-large" />
      <div className="preview-frame preview-frame-card" />
      <div className="preview-frame preview-frame-chip" />
      <span>{props.label}</span>
    </div>
  );
}

function EmptyState(props: {
  body: string;
  title: string;
}) {
  return (
    <div className="empty-state">
      <PreviewPlaceholder label={props.title} />
      <div className="empty-state-copy">
        <strong>{props.title}</strong>
        <p className="muted">{props.body}</p>
      </div>
    </div>
  );
}

function LaunchpadFilePreview(props: { summary: LaunchpadFileSummary }) {
  if (props.summary.thumbnailUrl) {
    return (
      <div className="launchpad-file-preview">
        <img
          alt={`Preview of ${props.summary.file.name}`}
          className="launchpad-file-preview-image"
          src={props.summary.thumbnailUrl}
        />
      </div>
    );
  }

  return (
    <div className="launchpad-file-preview">
      <PreviewPlaceholder label="Preview" />
    </div>
  );
}

export function LaunchpadView(props: {
  data: LaunchpadViewData;
  onCreateFile: (projectId: string, name: string, pageNames: string[]) => Promise<void>;
  onCreatePage: (
    projectId: string,
    fileId: string,
    name: string
  ) => Promise<FileOpenResponse>;
  onCreateProject: (name: string) => Promise<void>;
  onLoadFileDetails: (
    projectId: string,
    fileId: string
  ) => Promise<FileOpenResponse>;
  onOpenPage: (projectId: string, fileId: string, pageId: string) => void;
  onOpenProjectRoute: (projectId: string) => void;
  onOpenWorkspaceRoute: (workspaceId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
}) {
  const [expandedFileIds, setExpandedFileIds] = useState<string[]>([]);
  const [fileDetailsById, setFileDetailsById] = useState<
    Record<string, FileDetailsState>
  >({});

  useEffect(() => {
    const currentFileIds = new Set(
      props.data.projectGroups.flatMap((group) =>
        group.files.map((summary) => summary.file.id)
      )
    );

    setExpandedFileIds((current) =>
      current.filter((fileId) => currentFileIds.has(fileId))
    );
    setFileDetailsById((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([fileId]) => currentFileIds.has(fileId))
      )
    );
  }, [props.data.projectGroups]);

  async function toggleFilePages(projectId: string, fileId: string) {
    const isExpanded = expandedFileIds.includes(fileId);

    if (isExpanded) {
      setExpandedFileIds((current) => current.filter((entry) => entry !== fileId));
      return;
    }

    setExpandedFileIds((current) => [...current, fileId]);
    const existingState = fileDetailsById[fileId];

    if (existingState?.status === "loaded" || existingState?.status === "loading") {
      return;
    }

    setFileDetailsById((current) => ({
      ...current,
      [fileId]: { status: "loading" }
    }));

    try {
      const value = await props.onLoadFileDetails(projectId, fileId);
      setFileDetailsById((current) => ({
        ...current,
        [fileId]: { status: "loaded", value }
      }));
    } catch (error) {
      setFileDetailsById((current) => ({
        ...current,
        [fileId]: {
          status: "error",
          message: error instanceof Error ? error.message : String(error)
        }
      }));
    }
  }

  async function handleCreatePage(
    projectId: string,
    fileId: string,
    name: string
  ): Promise<void> {
    const value = await props.onCreatePage(projectId, fileId, name);
    setExpandedFileIds((current) =>
      current.includes(fileId) ? current : [...current, fileId]
    );
    setFileDetailsById((current) => ({
      ...current,
      [fileId]: { status: "loaded", value }
    }));
  }

  const activeWorkspace = props.data.activeWorkspace;

  return (
    <div className="route-stack">
      <article className="panel panel-hero">
        <div className="launchpad-heading">
          <div className="section-copy">
            <span className="section-label">Active workspace</span>
            <h2>{activeWorkspace ? activeWorkspace.name : "No workspaces yet"}</h2>
            <p className="muted">
              {activeWorkspace
                ? `${activeWorkspace.slug} · ${activeWorkspace.role}`
                : "You don't have access to a workspace yet."}
            </p>
            <p className="muted">
              {activeWorkspace
                ? "Pick up a project, jump into a file, or create something new without leaving the launchpad."
                : "Once you join a workspace, projects and files will collect here."}
            </p>
          </div>
          {activeWorkspace ? (
            <div className="action-strip">
              <DisclosureCreateProject onCreate={props.onCreateProject} />
              <button
                className="button button-secondary"
                onClick={() => props.onOpenWorkspaceRoute(activeWorkspace.id)}
                type="button"
              >
                View workspace
              </button>
            </div>
          ) : null}
        </div>
      </article>

      <article className="panel">
        <div className="panel-header">
          <div className="section-copy">
            <span className="section-label">Workspaces</span>
            <h2>Choose a workspace</h2>
          </div>
        </div>
        {props.data.workspaces.length > 0 ? (
          <div className="workspace-grid">
            {props.data.workspaces.map((workspace) => (
              <div className="workspace-switch-card" key={workspace.id}>
                <button
                  className={`resource-button workspace-switch-button ${
                    workspace.id === activeWorkspace?.id
                      ? "resource-button-active"
                      : ""
                  }`}
                  onClick={() => props.onSelectWorkspace(workspace.id)}
                  type="button"
                >
                  <strong>{workspace.name}</strong>
                  <span>
                    {workspace.slug} · {workspace.role}
                    {workspace.id === activeWorkspace?.id ? " · Active" : ""}
                  </span>
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => props.onOpenWorkspaceRoute(workspace.id)}
                  type="button"
                >
                  Open workspace
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            body="Workspace memberships will appear here once your account has access."
            title="No workspaces yet"
          />
        )}
      </article>

      {activeWorkspace ? (
        <article className="panel">
          <div className="panel-header">
            <div className="section-copy">
              <span className="section-label">Projects</span>
              <h2>Recent work</h2>
              <p className="muted">
                Projects stay grouped so teams can browse screens and jump back
                into the right file quickly.
              </p>
            </div>
          </div>
          {props.data.projectGroups.length > 0 ? (
            <div className="launchpad-project-list">
              {props.data.projectGroups.map((group) => (
                <LaunchpadProjectSection
                  key={group.project.id}
                  expandedFileIds={expandedFileIds}
                  fileDetailsById={fileDetailsById}
                  group={group}
                  onBrowsePages={(fileId) =>
                    void toggleFilePages(group.project.id, fileId)
                  }
                  onCreateFile={(name, pageNames) =>
                    props.onCreateFile(group.project.id, name, pageNames)
                  }
                  onCreatePage={(fileId, name) =>
                    handleCreatePage(group.project.id, fileId, name)
                  }
                  onOpenPage={(fileId, pageId) =>
                    props.onOpenPage(group.project.id, fileId, pageId)
                  }
                  onOpenProjectRoute={() =>
                    props.onOpenProjectRoute(group.project.id)
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState
              body="Create a project to start organizing files for this workspace."
              title="No projects yet"
            />
          )}
        </article>
      ) : null}
    </div>
  );
}

function LaunchpadProjectSection(props: {
  expandedFileIds: string[];
  fileDetailsById: Record<string, FileDetailsState>;
  group: LaunchpadProjectGroup;
  onBrowsePages: (fileId: string) => void;
  onCreateFile: (name: string, pageNames: string[]) => Promise<void>;
  onCreatePage: (fileId: string, name: string) => Promise<void>;
  onOpenPage: (fileId: string, pageId: string) => void;
  onOpenProjectRoute: () => void;
}) {
  return (
    <section className="launchpad-project-section">
      <header className="launchpad-project-header">
        <div className="section-copy">
          <h3>{props.group.project.name}</h3>
          <p className="muted">
            {props.group.files.length} file{props.group.files.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="action-strip">
          <DisclosureCreateFile onCreate={props.onCreateFile} />
          <button
            className="button button-secondary"
            onClick={props.onOpenProjectRoute}
            type="button"
          >
            View project
          </button>
        </div>
      </header>
      {props.group.files.length > 0 ? (
        <div className="launchpad-file-grid">
          {props.group.files.map((summary) => {
            const fileDetailsState =
              props.fileDetailsById[summary.file.id] ?? ({ status: "idle" } as const);
            const isExpanded = props.expandedFileIds.includes(summary.file.id);

            return (
              <article className="launchpad-file-card" key={summary.file.id}>
                <LaunchpadFilePreview summary={summary} />
                <div className="launchpad-file-body">
                  <div className="launchpad-file-meta">
                    <strong>{summary.file.name}</strong>
                    <span>
                      {summary.pageCount} page
                      {summary.pageCount === 1 ? "" : "s"} · Updated{" "}
                      {formatTimestamp(summary.file.updatedAt)}
                    </span>
                  </div>
                  <div className="launchpad-file-actions">
                    <button
                      className="button button-primary"
                      disabled={!summary.defaultPageId}
                      onClick={() =>
                        summary.defaultPageId
                          ? props.onOpenPage(
                              summary.file.id,
                              summary.defaultPageId
                            )
                          : undefined
                      }
                      type="button"
                    >
                      Open
                    </button>
                    <button
                      className="button button-secondary"
                      onClick={() => props.onBrowsePages(summary.file.id)}
                      type="button"
                    >
                      {isExpanded ? "Hide pages" : "Browse pages"}
                    </button>
                  </div>
                  {!summary.defaultPageId ? (
                    <p className="form-error">
                      Add a page before opening this file.
                    </p>
                  ) : null}
                  {isExpanded ? (
                    <div className="launchpad-pages-panel">
                      <div className="launchpad-pages-header">
                        <div className="section-copy">
                          <h4>Pages</h4>
                          <p className="muted">
                            Open any page here without leaving the launchpad.
                          </p>
                        </div>
                        <DisclosureCreatePage
                          onCreate={(name) =>
                            props.onCreatePage(summary.file.id, name)
                          }
                        />
                      </div>
                      <LaunchpadPagesState
                        fileDetailsState={fileDetailsState}
                        onOpenPage={(pageId) =>
                          props.onOpenPage(summary.file.id, pageId)
                        }
                      />
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          body="Create a file in this project to start designing."
          title="No files yet"
        />
      )}
    </section>
  );
}

function LaunchpadPagesState(props: {
  fileDetailsState: FileDetailsState;
  onOpenPage: (pageId: string) => void;
}) {
  if (
    props.fileDetailsState.status === "loading" ||
    props.fileDetailsState.status === "idle"
  ) {
    return <p className="muted">Loading pages...</p>;
  }

  if (props.fileDetailsState.status === "error") {
    return (
      <p className="form-error">
        Couldn't load pages right now. Close and reopen to try again.
      </p>
    );
  }

  const loadedState = props.fileDetailsState;

  if (loadedState.value.pages.length === 0) {
    return (
      <EmptyState
        body="No pages yet. Add one to keep working here."
        title="No pages yet"
      />
    );
  }

  return (
    <ul className="resource-list compact-resource-list">
      {loadedState.value.pages.map((page) => (
        <li key={page.id}>
          <div className="resource-row resource-row-inline">
            <button
              className={`resource-button ${
                page.id === loadedState.value.defaultPageId
                  ? "resource-button-active"
                  : ""
              }`}
              onClick={() => props.onOpenPage(page.id)}
              type="button"
            >
              <strong>{page.name}</strong>
              <span>Order {page.orderIndex + 1}</span>
            </button>
            <button
              className="button button-secondary"
              onClick={() => props.onOpenPage(page.id)}
              type="button"
            >
              Open page
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DisclosureCreateProject(props: {
  onCreate: (name: string) => Promise<void>;
}) {
  return (
    <DisclosureForm
      createLabel="New project"
      errorPrefix="Project"
      inputPlaceholder="New project name"
      submitLabel="Create project"
      onSubmit={(values) => props.onCreate(values.name)}
    />
  );
}

function DisclosureCreateFile(props: {
  onCreate: (name: string, pageNames: string[]) => Promise<void>;
}) {
  return (
    <DisclosureForm
      createLabel="New file"
      errorPrefix="File"
      inputPlaceholder="New file name"
      submitLabel="Create file"
      withPageInputs
      onSubmit={(values) => props.onCreate(values.name, values.pageNames)}
    />
  );
}

function DisclosureCreatePage(props: {
  onCreate: (name: string) => Promise<void>;
}) {
  return (
    <DisclosureForm
      createLabel="New page"
      errorPrefix="Page"
      inputPlaceholder="New page name"
      submitLabel="Create page"
      onSubmit={(values) => props.onCreate(values.name)}
    />
  );
}

function DisclosureForm(props: {
  createLabel: string;
  errorPrefix: string;
  inputPlaceholder: string;
  onSubmit: (values: { name: string; pageNames: string[] }) => Promise<void>;
  submitLabel: string;
  withPageInputs?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [pageNames, setPageNames] = useState(["Page 1", "Page 2"]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setExpanded(false);
    setName("");
    setPageNames(["Page 1", "Page 2"]);
    setSubmitting(false);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedPageNames = pageNames.map((entry) => entry.trim()).filter(Boolean);

    if (!trimmedName) {
      setError(`Enter a ${props.errorPrefix.toLowerCase()} name.`);
      return;
    }

    if (props.withPageInputs && trimmedPageNames.length < 2) {
      setError("Add at least two pages to start this file.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await props.onSubmit({
        name: trimmedName,
        pageNames: props.withPageInputs ? trimmedPageNames : []
      });
      reset();
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

  function updatePageName(index: number, value: string) {
    setPageNames((current) =>
      current.map((entry, currentIndex) =>
        currentIndex === index ? value : entry
      )
    );
  }

  if (!expanded) {
    return (
      <button
        className="button button-secondary"
        onClick={() => setExpanded(true)}
        type="button"
      >
        {props.createLabel}
      </button>
    );
  }

  return (
    <form
      className={`contextual-form ${props.withPageInputs ? "contextual-form-stack" : ""}`}
      onSubmit={(event) => void handleSubmit(event)}
    >
      <input
        onChange={(event) => setName(event.target.value)}
        placeholder={props.inputPlaceholder}
        type="text"
        value={name}
      />
      {props.withPageInputs ? (
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
      ) : null}
      <div className="action-strip">
        {props.withPageInputs ? (
          <button
            className="button button-secondary"
            onClick={() =>
              setPageNames((current) => [...current, `Page ${current.length + 1}`])
            }
            type="button"
          >
            Add page field
          </button>
        ) : null}
        <button
          className="button button-primary"
          disabled={submitting}
          type="submit"
        >
          {submitting ? "Saving..." : props.submitLabel}
        </button>
        <button
          className="button button-secondary"
          onClick={reset}
          type="button"
        >
          Cancel
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </form>
  );
}
