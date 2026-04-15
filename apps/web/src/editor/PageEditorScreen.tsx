import { type FileDto, type PageDocumentDto, type PageDto, type ProjectDto, type RuntimeUrls, type WorkspaceDetailDto } from "@openmirage/types";
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { subscribeToPageDocument } from "./collab-client";
import { hitTestPaintRecords } from "./hit-test";
import { renderSceneToCanvas } from "./render";
import { createPaintRecords, hydratePageDocument } from "./scene";
import {
  createInitialViewport,
  screenPointToPagePoint,
  zoomViewportAtPoint
} from "./viewport";
import { type ViewportState } from "./types";

interface AppPageRoute {
  fileId: string;
  pageId: string;
  projectId: string;
  workspaceId: string;
}

function createEmptyDocument(pageId: string): PageDocumentDto {
  return {
    nodes: {},
    pageId,
    rootNodeIds: []
  };
}

function useCanvasResizeVersion(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setVersion((value) => value + 1);
    });

    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef]);

  return version;
}

export function PageEditorScreen(props: {
  collab: RuntimeUrls;
  file: FileDto;
  onCreatePage: (name: string) => Promise<void>;
  onNavigate: (route: AppPageRoute & { kind: "page" }) => void;
  onRenameFile: (fileId: string, name: string) => Promise<void>;
  onRenamePage: (pageId: string, name: string) => Promise<void>;
  page: PageDto;
  pages: PageDto[];
  project: ProjectDto;
  route: AppPageRoute;
  workspace: WorkspaceDetailDto;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [documentState, setDocumentState] = useState<PageDocumentDto>(() =>
    createEmptyDocument(props.page.id)
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [primarySelectionId, setPrimarySelectionId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ViewportState>(createInitialViewport);
  const [collabStatus, setCollabStatus] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("connecting");
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ panX: number; panY: number; x: number; y: number } | null>(
    null
  );
  const resizeVersion = useCanvasResizeVersion(canvasRef);

  useEffect(() => {
    setDocumentState(createEmptyDocument(props.page.id));
    setSelectedIds([]);
    setPrimarySelectionId(null);
    setHoveredId(null);
    setViewport(createInitialViewport());

    const subscription = subscribeToPageDocument(
      {
        collabWsPath: props.collab.collabWsPath,
        collabWsUrl: props.collab.collabWsUrl,
        location: {
          fileId: props.route.fileId,
          pageId: props.route.pageId,
          workspaceId: props.route.workspaceId
        }
      },
      (nextDocument) => {
        setDocumentState(nextDocument);
      },
      setCollabStatus
    );

    subscription.connect();

    return () => {
      subscription.destroy();
    };
  }, [
    props.collab.collabWsPath,
    props.collab.collabWsUrl,
    props.route.fileId,
    props.route.pageId,
    props.route.workspaceId,
    props.page.id
  ]);

  const scene = useMemo(
    () => hydratePageDocument(props.page, documentState),
    [documentState, props.page]
  );
  const paintRecords = useMemo(() => createPaintRecords(scene), [scene]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    renderSceneToCanvas(
      canvas,
      viewport,
      {
        background: scene.background,
        height: scene.height,
        width: scene.width
      },
      paintRecords,
      {
        hoveredId,
        selectedIds
      }
    );
  }, [hoveredId, paintRecords, resizeVersion, scene.background, scene.height, scene.width, selectedIds, viewport]);

  function updateSelection(nodeId: string | null) {
    setPrimarySelectionId(nodeId);
    setSelectedIds(nodeId ? [nodeId] : []);
  }

  function readCanvasPoint(event: {
    clientX: number;
    clientY: number;
  }) {
    const canvas = canvasRef.current;
    const bounds = canvas?.getBoundingClientRect();

    if (!canvas || !bounds) {
      return null;
    }

    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const screenPoint = readCanvasPoint(event);

    if (!screenPoint) {
      return;
    }

    if (isPanning && panStartRef.current) {
      setViewport((current) => ({
        ...current,
        panX: panStartRef.current!.panX + screenPoint.x - panStartRef.current!.x,
        panY: panStartRef.current!.panY + screenPoint.y - panStartRef.current!.y
      }));
      return;
    }

    const pagePoint = screenPointToPagePoint(screenPoint, viewport);
    const hit = hitTestPaintRecords(paintRecords, pagePoint, viewport.zoom);
    setHoveredId(hit?.node.id ?? null);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const screenPoint = readCanvasPoint(event);

    if (!screenPoint) {
      return;
    }

    const pagePoint = screenPointToPagePoint(screenPoint, viewport);
    const hit = hitTestPaintRecords(paintRecords, pagePoint, viewport.zoom);

    if (!hit) {
      setIsPanning(true);
      panStartRef.current = {
        panX: viewport.panX,
        panY: viewport.panY,
        x: screenPoint.x,
        y: screenPoint.y
      };
      updateSelection(null);
      return;
    }

    updateSelection(hit.node.id);
  }

  function stopPanning() {
    setIsPanning(false);
    panStartRef.current = null;
  }

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const screenPoint = readCanvasPoint(event);

    if (!screenPoint) {
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      const nextZoom = viewport.zoom * (event.deltaY < 0 ? 1.1 : 0.9);
      setViewport((current) => zoomViewportAtPoint(current, nextZoom, screenPoint));
      return;
    }

    setViewport((current) => ({
      ...current,
      panX: current.panX - event.deltaX,
      panY: current.panY - event.deltaY
    }));
  }

  return (
    <section className="editor-layout">
      <aside className="panel editor-sidebar">
        <p className="eyebrow">Editor</p>
        <h2>{props.file.name}</h2>
        <p className="muted">
          Canvas-first page route with collab-backed hydration, viewport pan and zoom,
          and paint-order hit testing.
        </p>
        <div className="action-strip">
          <InlineRenameForm
            label="Rename file"
            onSubmit={(name) => props.onRenameFile(props.file.id, name)}
          />
          <CreatePageForm onCreate={props.onCreatePage} />
        </div>
        <div className="editor-sidebar-section">
          <p className="eyebrow">Pages</p>
          <ul className="resource-list compact-resource-list">
            {props.pages.map((page) => (
              <li key={page.id}>
                <div className="resource-row">
                  <button
                    className={`resource-button ${
                      page.id === props.page.id ? "resource-button-active" : ""
                    }`}
                    onClick={() =>
                      props.onNavigate({
                        fileId: props.file.id,
                        kind: "page",
                        pageId: page.id,
                        projectId: props.project.id,
                        workspaceId: props.workspace.id
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
        </div>
      </aside>

      <section className="panel editor-panel">
        <div className="editor-toolbar">
          <div>
            <p className="eyebrow">Page</p>
            <h2>{props.page.name}</h2>
          </div>
          <div className="toolbar-strip">
            <button
              className="button button-secondary"
              onClick={() => setViewport((current) => ({ ...current, zoom: Math.max(0.25, current.zoom * 0.9) }))}
              type="button"
            >
              Zoom out
            </button>
            <button
              className="button button-secondary"
              onClick={() => setViewport(createInitialViewport())}
              type="button"
            >
              Reset view
            </button>
            <button
              className="button button-secondary"
              onClick={() => setViewport((current) => ({ ...current, zoom: Math.min(4, current.zoom * 1.1) }))}
              type="button"
            >
              Zoom in
            </button>
          </div>
        </div>

        <div className="editor-meta">
          <span>Collab: {collabStatus}</span>
          <span>
            Viewport: {viewport.zoom.toFixed(2)}x · pan {Math.round(viewport.panX)}/
            {Math.round(viewport.panY)}
          </span>
          <span>Nodes: {paintRecords.length}</span>
          <span>Selection: {primarySelectionId ?? "None"}</span>
        </div>

        <div className="editor-canvas-shell">
          <canvas
            className="editor-canvas"
            onPointerCancel={stopPanning}
            onPointerDown={handlePointerDown}
            onPointerLeave={() => {
              stopPanning();
              setHoveredId(null);
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={stopPanning}
            onWheel={handleWheel}
            ref={canvasRef}
          />
        </div>
      </section>
    </section>
  );
}

function InlineRenameForm(props: {
  label: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();

    if (!trimmed) {
      return;
    }

    setIsSubmitting(true);

    try {
      await props.onSubmit(trimmed);
      setValue("");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="inline-form compact-inline-form" onSubmit={(event) => void handleSubmit(event)}>
      <input
        onChange={(event) => setValue(event.target.value)}
        placeholder={props.label}
        value={value}
      />
      <button className="button button-secondary" disabled={isSubmitting} type="submit">
        Save
      </button>
    </form>
  );
}

function CreatePageForm(props: { onCreate: (name: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();

    if (!trimmed) {
      return;
    }

    setIsSubmitting(true);

    try {
      await props.onCreate(trimmed);
      setValue("");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="inline-form compact-inline-form" onSubmit={(event) => void handleSubmit(event)}>
      <input
        onChange={(event) => setValue(event.target.value)}
        placeholder="New page name"
        value={value}
      />
      <button className="button button-primary" disabled={isSubmitting} type="submit">
        Add page
      </button>
    </form>
  );
}
