import {
  type FileDto,
  type GroupNode,
  type GroupNodesCommand,
  type PageDocumentDto,
  type PageDto,
  type ProjectDto,
  type RuntimeUrls,
  type SceneGraphNode,
  type WorkspaceDetailDto
} from "@openmirage/types";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { applyEditorCommand, getNodeAbsolutePosition, getTopLevelNodeIds, isContainerNode } from "./commands";
import {
  hitTestPaintRecords,
  hitTestResizeHandle,
  selectPaintRecordsInMarquee
} from "./hit-test";
import {
  createEmptyDocument,
  createNodeCommandForInsert,
  deriveMoveUpdates,
  deriveResizeUpdates,
  getContainerInsertionTarget
} from "./interactions";
import { renderSceneToCanvas } from "./render";
import { createPaintRecords, hydratePageDocument } from "./scene";
import {
  createInitialViewport,
  pagePointToScreenPoint,
  screenPointToPagePoint,
  zoomViewportAtPoint
} from "./viewport";
import { type ActiveInteraction, type ActiveTextEdit, type EditorSession, type EditorSessionSnapshot, type Point, type ViewportState } from "./types";

interface AppPageRoute {
  fileId: string;
  pageId: string;
  projectId: string;
  workspaceId: string;
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

function toggleSelectedIds(selectedIds: string[], nodeId: string): string[] {
  return selectedIds.includes(nodeId)
    ? selectedIds.filter((candidateId) => candidateId !== nodeId)
    : [...selectedIds, nodeId];
}

function buildGroupCommand(
  document: PageDocumentDto,
  pageId: string,
  selectedIds: string[]
): GroupNodesCommand | null {
  const topLevelIds = getTopLevelNodeIds(document, selectedIds);

  if (topLevelIds.length < 2) {
    return null;
  }

  const firstNodeId = topLevelIds[0];

  if (!firstNodeId) {
    return null;
  }

  const firstNode = document.nodes[firstNodeId];

  if (!firstNode) {
    return null;
  }

  const timestamp = new Date().toISOString();
  const group: GroupNode = {
    childIds: [],
    createdAt: timestamp,
    height: 1,
    id: crypto.randomUUID(),
    locked: false,
    name: "Group",
    opacity: 1,
    pageId,
    parentId: firstNode.parentId,
    rotation: 0,
    type: "group",
    updatedAt: timestamp,
    visible: true,
    width: 1,
    x: 0,
    y: 0,
    zIndex: 0
  };

  return {
    group,
    index: null,
    nodeIds: topLevelIds,
    pageId,
    type: "group-nodes"
  };
}

function getInteractionPreview(
  interaction: ActiveInteraction | null,
  snapshot: PageDocumentDto,
  selectedIds: string[],
  point: Point | null
): PageDocumentDto {
  if (!interaction || !point) {
    return snapshot;
  }

  switch (interaction.type) {
    case "move": {
      const delta = {
        x: point.x - interaction.startPagePoint.x,
        y: point.y - interaction.startPagePoint.y
      };

      if (!delta.x && !delta.y) {
        return snapshot;
      }

      return applyEditorCommand(snapshot, {
        pageId: snapshot.pageId,
        type: "move-node",
        updates: deriveMoveUpdates(interaction.originalDocument, selectedIds, delta)
      });
    }
    case "resize":
      return applyEditorCommand(snapshot, {
        nodeId: interaction.record.node.id,
        pageId: snapshot.pageId,
        type: "resize-node",
        updates: deriveResizeUpdates(
          interaction.originalDocument,
          interaction.record,
          interaction.handle,
          point
        )
      });
    default:
      return snapshot;
  }
}

function resolvePrimarySelectionId(selectedIds: string[], preferredId: string | null): string | null {
  if (preferredId && selectedIds.includes(preferredId)) {
    return preferredId;
  }

  return selectedIds.at(-1) ?? null;
}

function getLayerOrder(document: PageDocumentDto, parentId: string | null): string[] {
  if (!parentId) {
    return document.rootNodeIds;
  }

  const parent = document.nodes[parentId];
  return parent && isContainerNode(parent) ? parent.childIds : [];
}

function flattenLayerTree(document: PageDocumentDto, parentId: string | null, depth = 0): Array<{ depth: number; node: SceneGraphNode }> {
  const items: Array<{ depth: number; node: SceneGraphNode }> = [];

  for (const nodeId of getLayerOrder(document, parentId)) {
    const node = document.nodes[nodeId];

    if (!node) {
      continue;
    }

    items.push({ depth, node });

    if (isContainerNode(node)) {
      items.push(...flattenLayerTree(document, node.id, depth + 1));
    }
  }

  return items;
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
  const [activeScopeId, setActiveScopeId] = useState<string | null>(null);
  const [activeTextEdit, setActiveTextEdit] = useState<ActiveTextEdit | null>(null);
  const [activeInteraction, setActiveInteraction] = useState<ActiveInteraction | null>(null);
  const resizeVersion = useCanvasResizeVersion(canvasRef);

  useEffect(() => {
    setSessionSnapshot({
      canRedo: false,
      canUndo: false,
      document: createEmptyDocument(props.page.id)
    });
    setSelectedIds([]);
    setPrimarySelectionId(null);
    setHoveredId(null);
    setViewport(createInitialViewport());

    const session = createEditorSession(
      {
        collabWsPath: props.collab.collabWsPath,
        collabWsUrl: props.collab.collabWsUrl,
        location: {
          fileId: props.route.fileId,
          pageId: props.route.pageId,
          workspaceId: props.route.workspaceId
        }
      },
      setCollabStatus
    );
    const unsubscribe = session.subscribe((nextSnapshot) => {
      setSessionSnapshot(nextSnapshot);
    });

    sessionRef.current = session;
    session.connect();

    return () => {
      unsubscribe();
      session.destroy();
      sessionRef.current = null;
    };
  }, [
    props.collab.collabWsPath,
    props.collab.collabWsUrl,
    props.page.id,
    props.route.fileId,
    props.route.pageId,
    props.route.workspaceId
  ]);

  const previewDocument = useMemo(
    () =>
      getInteractionPreview(
        activeInteraction,
        sessionSnapshot.document,
        selectedIds,
        activeInteraction?.currentPagePoint ?? null
      ),
    [activeInteraction, selectedIds, sessionSnapshot.document]
  );
  const scene = useMemo(
    () => hydratePageDocument(props.page, previewDocument),
    [previewDocument, props.page]
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
        marquee:
          activeInteraction?.type === "marquee" && activeInteraction.currentPagePoint
            ? {
                end: activeInteraction.currentPagePoint,
                start: activeInteraction.startPagePoint
              }
            : null,
        primarySelectionId: effectivePrimarySelectionId,
        selectedIds: effectiveSelectedIds
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

  function readPagePoint(event: { clientX: number; clientY: number }): Point | null {
    const screenPoint = readCanvasPoint(event);

    if (!screenPoint) {
      return null;
    }

    return screenPointToPagePoint(screenPoint, viewport);
  }

  function commitTextEdit() {
    const session = sessionRef.current;

    if (!session || !activeTextEdit || !activeTextNode) {
      setActiveTextEdit(null);
      return;
    }

    const panStart = panStartRef.current;

    if (isPanning && panStart) {
      setViewport((current) => ({
        ...current,
        panX: panStart.panX + screenPoint.x - panStart.x,
        panY: panStart.panY + screenPoint.y - panStart.y
      }));
      return;
    }

    const hit = hitTestPaintRecords(scopedRecords, pagePoint, viewport.zoom);
    setHoveredId(hit?.node.id ?? null);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const session = sessionRef.current;
    const pagePoint = readPagePoint(event);
    const screenPoint = readCanvasPoint(event);

    if (!session || !screenPoint) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    if (event.button === 1 || event.button === 2 || event.altKey || event.metaKey || event.ctrlKey) {
      setActiveInteraction({
        startScreenPoint: screenPoint,
        startViewport: viewport,
        type: "pan"
      });
      return;
    }

    const primaryScopedRecord = primaryRecord && scopedRecords.some((record) => record.node.id === primaryRecord.node.id)
      ? primaryRecord
      : null;
    const handleHit = pagePoint
      ? hitTestResizeHandle(primaryScopedRecord, pagePoint, viewport.zoom)
      : null;

    if (handleHit && primaryScopedRecord && pagePoint) {
      setActiveInteraction({
        currentPagePoint: pagePoint,
        handle: handleHit.handle,
        originalDocument: sessionSnapshot.document,
        record: primaryScopedRecord,
        startPagePoint: pagePoint,
        type: "resize"
      });
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
          Command-backed local editing with collab persistence, local undo/redo, and
          DOM-overlay text editing.
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
        <div className="editor-sidebar-section">
          <p className="eyebrow">Layers</p>
          <div className="layer-list">
            {layerItems.map(({ depth, node }) => {
              const order = getLayerOrder(sessionSnapshot.document, node.parentId);
              const index = order.indexOf(node.id);

              return (
                <div
                  className={`layer-row ${selectedIds.includes(node.id) ? "layer-row-active" : ""}`}
                  key={node.id}
                  style={{ paddingLeft: `${12 + depth * 16}px` }}
                >
                  <button
                    className="layer-label"
                    onClick={() => updateSelection([node.id], node.id)}
                    type="button"
                  >
                    <strong>{node.name}</strong>
                    <span>{node.type}</span>
                  </button>
                  <div className="layer-actions">
                    <button className="button button-secondary button-icon" onClick={() => reorderNode(node.id, -1)} type="button">
                      ↑
                    </button>
                    <button className="button button-secondary button-icon" onClick={() => reorderNode(node.id, 1)} type="button">
                      ↓
                    </button>
                    <button
                      className="button button-secondary button-icon"
                      onClick={() => toggleNodeFlag(node.id, { locked: !node.locked } as Partial<SceneGraphNode>)}
                      type="button"
                    >
                      {node.locked ? "Unlock" : "Lock"}
                    </button>
                    <button
                      className="button button-secondary button-icon"
                      onClick={() => toggleNodeFlag(node.id, { visible: !node.visible } as Partial<SceneGraphNode>)}
                      type="button"
                    >
                      {node.visible ? "Hide" : "Show"}
                    </button>
                    <button
                      className="button button-secondary button-icon"
                      onClick={() => deleteNodes([node.id])}
                      type="button"
                    >
                      Del
                    </button>
                  </div>
                  <span className="layer-order">#{index + 1}</span>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="panel editor-panel">
        <div className="editor-toolbar">
          <div>
            <p className="eyebrow">Page</p>
            <h2>{props.page.name}</h2>
          </div>
          <div className="toolbar-strip">
            <button className="button button-secondary" onClick={() => createNode("frame")} type="button">
              Frame
            </button>
            <button className="button button-secondary" onClick={() => createNode("rectangle")} type="button">
              Rectangle
            </button>
            <button className="button button-secondary" onClick={() => createNode("ellipse")} type="button">
              Ellipse
            </button>
            <button className="button button-secondary" onClick={() => createNode("line")} type="button">
              Line
            </button>
            <button className="button button-secondary" onClick={() => createNode("text")} type="button">
              Text
            </button>
            <button
              className="button button-secondary"
              disabled={selectedIds.length < 2}
              onClick={groupSelection}
              type="button"
            >
              Group
            </button>
            <button
              className="button button-secondary"
              disabled={sessionSnapshot.document.nodes[primarySelectionId ?? ""]?.type !== "group"}
              onClick={ungroupSelection}
              type="button"
            >
              Ungroup
            </button>
            <button
              className="button button-secondary"
              disabled={!sessionSnapshot.canUndo}
              onClick={() => sessionRef.current?.undo()}
              type="button"
            >
              Undo
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
              onClick={() => setViewport((current) => ({ ...current, zoom: clampZoom(current.zoom * 1.1) }))}
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
          <span>Selection: {effectivePrimarySelectionId ?? "None"}</span>
          <span>Scope: {activeScopeId ?? "Root"}</span>
        </div>

        <div className="editor-canvas-shell" ref={canvasShellRef}>
          <canvas
            className="editor-canvas"
            onPointerCancel={stopPanning}
            onPointerDown={handlePointerDown}
            onPointerLeave={() => {
              setHoveredId(null);
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={stopInteraction}
            onWheel={handleWheel}
            ref={canvasRef}
          />
          {activeTextEdit && textEditStyle && activeTextNode ? (
            <textarea
              autoFocus
              className="editor-text-overlay"
              onBlur={commitTextEdit}
              onChange={(event) =>
                setActiveTextEdit((current) =>
                  current
                    ? {
                        ...current,
                        draft: event.target.value
                      }
                    : current
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setActiveTextEdit(null);
                }

                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  commitTextEdit();
                }
              }}
              style={textEditStyle}
              value={activeTextEdit.draft}
            />
          ) : null}
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
