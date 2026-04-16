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
import {
  createPaintRecords,
  getNodePaintRecord,
  getScopedPaintRecords,
  hydratePageDocument
} from "./scene";
import { createEditorSession } from "./session";
import {
  clampZoom,
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
  const canvasShellRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<EditorSession | null>(null);
  const activeInteractionRef = useRef<ActiveInteraction | null>(null);
  const selectedIdsRef = useRef<string[]>([]);
  const primarySelectionIdRef = useRef<string | null>(null);
  const [sessionSnapshot, setSessionSnapshot] = useState<EditorSessionSnapshot>({
    canRedo: false,
    canUndo: false,
    document: createEmptyDocument(props.page.id)
  });
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
    setActiveScopeId(null);
    setActiveTextEdit(null);
    activeInteractionRef.current = null;
    selectedIdsRef.current = [];
    primarySelectionIdRef.current = null;
    setActiveInteraction(null);

    const session = createEditorSession(
      {
        pageId: props.page.id,
        transport: {
          collabWsPath: props.collab.collabWsPath,
          collabWsUrl: props.collab.collabWsUrl,
          location: {
            fileId: props.route.fileId,
            pageId: props.route.pageId,
            workspaceId: props.route.workspaceId
          }
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
  const scopedRecords = useMemo(
    () => getScopedPaintRecords(paintRecords, scene, activeScopeId),
    [activeScopeId, paintRecords, scene]
  );
  const marqueeSelection = useMemo(() => {
    if (activeInteraction?.type !== "marquee" || !activeInteraction.currentPagePoint) {
      return null;
    }

    return selectPaintRecordsInMarquee(
      scopedRecords,
      activeInteraction.startPagePoint,
      activeInteraction.currentPagePoint
    );
  }, [activeInteraction, scopedRecords]);
  const effectiveSelectedIds =
    activeInteraction?.type === "marquee" && marqueeSelection
    ? Array.from(
        new Set([
          ...activeInteraction.startSelectedIds,
          ...marqueeSelection
        ])
      )
    : selectedIds;
  const effectivePrimarySelectionId = resolvePrimarySelectionId(
    effectiveSelectedIds,
    primarySelectionId
  );
  const primaryRecord = useMemo(
    () => getNodePaintRecord(scopedRecords, effectivePrimarySelectionId ?? ""),
    [effectivePrimarySelectionId, scopedRecords]
  );
  const layerItems = useMemo(
    () => flattenLayerTree(sessionSnapshot.document, null),
    [sessionSnapshot.document]
  );
  const textEditRecord = useMemo(
    () =>
      activeTextEdit
        ? getNodePaintRecord(paintRecords, activeTextEdit.nodeId)
        : null,
    [activeTextEdit, paintRecords]
  );
  const activeTextNode = useMemo(() => {
    if (!activeTextEdit) {
      return null;
    }

    const node = sessionSnapshot.document.nodes[activeTextEdit.nodeId];
    return node?.type === "text" ? node : null;
  }, [activeTextEdit, sessionSnapshot.document.nodes]);

  useEffect(() => {
    if (!primarySelectionId || previewDocument.nodes[primarySelectionId]) {
      return;
    }

    updateSelection([], null);
  }, [previewDocument.nodes, primarySelectionId]);

  useEffect(() => {
    if (activeScopeId && !previewDocument.nodes[activeScopeId]) {
      setActiveScopeId(null);
    }
  }, [activeScopeId, previewDocument.nodes]);

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
  }, [
    activeInteraction,
    effectivePrimarySelectionId,
    effectiveSelectedIds,
    hoveredId,
    paintRecords,
    resizeVersion,
    scene.background,
    scene.height,
    scene.width,
    viewport
  ]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const session = sessionRef.current;

      if (!session) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();

        if (event.shiftKey) {
          session.redo();
          return;
        }

        session.undo();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        session.redo();
        return;
      }

      if (activeTextEdit) {
        if (event.key === "Escape") {
          event.preventDefault();
          setActiveTextEdit(null);
        }

        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (effectiveSelectedIds.length === 0) {
          return;
        }

        event.preventDefault();
        session.commit({
          nodeIds: effectiveSelectedIds,
          pageId: props.page.id,
          type: "delete-node"
        });
        updateSelection([], null);
        return;
      }

      if (event.key === "Escape") {
        if (activeInteraction) {
          event.preventDefault();
          updateActiveInteraction(null);
          return;
        }

        if (activeScopeId) {
          event.preventDefault();
          const nextScopeId = sessionSnapshot.document.nodes[activeScopeId]?.parentId ?? null;
          setActiveScopeId(nextScopeId);
          updateSelection(nextScopeId ? [nextScopeId] : [], nextScopeId);
        }

        return;
      }

      if (event.key === "Enter" && effectivePrimarySelectionId) {
        const node = sessionSnapshot.document.nodes[effectivePrimarySelectionId];

        if (node?.type === "text") {
          event.preventDefault();
          setActiveTextEdit({
            draft: node.content,
            nodeId: node.id
          });
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeInteraction,
    activeScopeId,
    activeTextEdit,
    effectivePrimarySelectionId,
    effectiveSelectedIds,
    props.page.id,
    sessionSnapshot.document
  ]);

  function updateSelection(nextSelectedIds: string[], nextPrimaryId: string | null) {
    selectedIdsRef.current = nextSelectedIds;
    primarySelectionIdRef.current = resolvePrimarySelectionId(nextSelectedIds, nextPrimaryId);
    setSelectedIds(nextSelectedIds);
    setPrimarySelectionId(resolvePrimarySelectionId(nextSelectedIds, nextPrimaryId));
  }

  function updateActiveInteraction(nextInteraction: ActiveInteraction | null) {
    activeInteractionRef.current = nextInteraction;
    setActiveInteraction(nextInteraction);
  }

  function readCanvasPoint(event: { clientX: number; clientY: number }) {
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

    if (!pagePoint) {
      return;
    }

    if (activeInteraction) {
      const current = activeInteractionRef.current;

      if (current) {
        updateActiveInteraction({
          ...current,
          currentPagePoint: pagePoint
        });
      }

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

    event.currentTarget.setPointerCapture(event.pointerId);

    if (event.button === 1 || event.button === 2 || event.altKey || event.metaKey || event.ctrlKey) {
      updateActiveInteraction({
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
      updateActiveInteraction({
        currentPagePoint: pagePoint,
        handle: handleHit.handle,
        originalDocument: sessionSnapshot.document,
        record: primaryScopedRecord,
        startPagePoint: pagePoint,
        type: "resize"
      });
      return;
    }

    if (!pagePoint) {
      return;
    }

    const hit = hitTestPaintRecords(scopedRecords, pagePoint, viewport.zoom);

    if (!hit) {
      setHoveredId(null);
      updateActiveInteraction({
        currentPagePoint: pagePoint,
        startPagePoint: pagePoint,
        startSelectedIds: event.shiftKey ? selectedIds : [],
        type: "marquee"
      });
      if (!event.shiftKey) {
        updateSelection([], null);
      }
      return;
    }

    if (event.shiftKey) {
      const nextSelectedIds = toggleSelectedIds(selectedIds, hit.node.id);
      updateSelection(nextSelectedIds, hit.node.id);
      return;
    }

    const nextSelectedIds = selectedIds.includes(hit.node.id) ? selectedIds : [hit.node.id];
    updateSelection(nextSelectedIds, hit.node.id);
    updateActiveInteraction({
      currentPagePoint: pagePoint,
      originalDocument: sessionSnapshot.document,
      startPagePoint: pagePoint,
      type: "move"
    });
  }

  function stopInteraction(event?: ReactPointerEvent<HTMLCanvasElement>) {
    const session = sessionRef.current;
    const currentInteraction = activeInteractionRef.current;

    if (!session || !currentInteraction) {
      updateActiveInteraction(null);
      return;
    }

    const pagePoint =
      currentInteraction.currentPagePoint ??
      (event ? readPagePoint(event) : null);

    if (currentInteraction.type === "move" && pagePoint) {
      const delta = {
        x: pagePoint.x - currentInteraction.startPagePoint.x,
        y: pagePoint.y - currentInteraction.startPagePoint.y
      };

      if (delta.x || delta.y) {
        session.commit({
          pageId: props.page.id,
          type: "move-node",
          updates: deriveMoveUpdates(
            currentInteraction.originalDocument,
            selectedIdsRef.current,
            delta
          )
        });
      }
    }

    if (currentInteraction.type === "resize" && pagePoint) {
      session.commit({
        nodeId: currentInteraction.record.node.id,
        pageId: props.page.id,
        type: "resize-node",
        updates: deriveResizeUpdates(
          currentInteraction.originalDocument,
          currentInteraction.record,
          currentInteraction.handle,
          pagePoint
        )
      });
    }

    if (currentInteraction.type === "marquee" && pagePoint) {
      const nextSelectedIds = selectPaintRecordsInMarquee(
        scopedRecords,
        currentInteraction.startPagePoint,
        pagePoint
      );

      updateSelection(
        Array.from(new Set([...currentInteraction.startSelectedIds, ...nextSelectedIds])),
        nextSelectedIds.at(-1) ?? currentInteraction.startSelectedIds.at(-1) ?? null
      );
    }

    updateActiveInteraction(null);
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

  function handleCanvasDoubleClick(event: ReactPointerEvent<HTMLCanvasElement>) {
    const hit = hitTestPaintRecords(scopedRecords, readPagePoint(event) ?? { x: 0, y: 0 }, viewport.zoom);

    if (!hit) {
      return;
    }

    if (hit.node.type === "text") {
      setActiveTextEdit({
        draft: hit.node.content,
        nodeId: hit.node.id
      });
      updateSelection([hit.node.id], hit.node.id);
      return;
    }

    if (hit.node.type === "frame" || hit.node.type === "group") {
      setActiveScopeId(hit.node.id);
      updateSelection([hit.node.id], hit.node.id);
    }
  }

  function createNode(type: "frame" | "rectangle" | "ellipse" | "line" | "text") {
    const session = sessionRef.current;
    const canvas = canvasRef.current;

    if (!session || !canvas) {
      return;
    }

    const targetParentId = getContainerInsertionTarget({
      activeScopeId,
      document: sessionSnapshot.document,
      primarySelectionId
    });
    const parentAbsolutePosition = targetParentId
      ? getNodeAbsolutePosition(sessionSnapshot.document, targetParentId) ?? { x: 0, y: 0 }
      : { x: 0, y: 0 };
    const centerPoint = screenPointToPagePoint(
      {
        x: canvas.clientWidth / 2,
        y: canvas.clientHeight / 2
      },
      viewport
    );
    const command = createNodeCommandForInsert({
      pageId: props.page.id,
      parentAbsolutePosition,
      parentId: targetParentId,
      point: centerPoint,
      type
    });

    session.commit(command);
    updateSelection([command.node.id], command.node.id);
  }

  function reorderNode(nodeId: string, delta: number) {
    const session = sessionRef.current;
    const node = sessionSnapshot.document.nodes[nodeId];

    if (!session || !node) {
      return;
    }

    const order = getLayerOrder(sessionSnapshot.document, node.parentId);
    const currentIndex = order.indexOf(nodeId);

    if (currentIndex === -1) {
      return;
    }

    session.commit({
      index: Math.max(0, Math.min(order.length - 1, currentIndex + delta)),
      nodeId,
      pageId: props.page.id,
      parentId: node.parentId,
      type: "reorder-node"
    });
  }

  function toggleNodeFlag(nodeId: string, patch: Partial<SceneGraphNode>) {
    const session = sessionRef.current;

    if (!session) {
      return;
    }

    session.commit({
      nodeId,
      pageId: props.page.id,
      patch,
      type: "update-node"
    });
  }

  function deleteNodes(nodeIds: string[]) {
    const session = sessionRef.current;

    if (!session || nodeIds.length === 0) {
      return;
    }

    session.commit({
      nodeIds,
      pageId: props.page.id,
      type: "delete-node"
    });
    const nextSelectedIds = selectedIdsRef.current.filter((nodeId) => !nodeIds.includes(nodeId));
    const nextPrimaryId =
      primarySelectionIdRef.current && nodeIds.includes(primarySelectionIdRef.current)
        ? null
        : primarySelectionIdRef.current;
    updateSelection(nextSelectedIds, nextPrimaryId);
  }

  function groupSelection() {
    const session = sessionRef.current;

    if (!session) {
      return;
    }

    const command = buildGroupCommand(sessionSnapshot.document, props.page.id, selectedIds);

    if (!command) {
      return;
    }

    session.commit(command);
    updateSelection([command.group.id], command.group.id);
  }

  function ungroupSelection() {
    const session = sessionRef.current;
    const nodeId = primarySelectionId;

    if (!session || !nodeId) {
      return;
    }

    session.commit({
      nodeId,
      pageId: props.page.id,
      type: "ungroup-node"
    });
    updateSelection([], null);
  }

  const textEditStyle = useMemo(() => {
    if (!textEditRecord || !activeTextNode || !canvasShellRef.current) {
      return null;
    }

    const topLeft = pagePointToScreenPoint(
      { x: textEditRecord.bounds.x, y: textEditRecord.bounds.y },
      viewport
    );

    return {
      fontFamily: activeTextNode.typography.fontFamily,
      fontSize: `${activeTextNode.typography.fontSize * viewport.zoom}px`,
      fontWeight: activeTextNode.typography.fontWeight,
      height: `${Math.max(36, textEditRecord.bounds.height * viewport.zoom)}px`,
      left: `${topLeft.x}px`,
      lineHeight: `${activeTextNode.typography.lineHeight * viewport.zoom}px`,
      top: `${topLeft.y}px`,
      width: `${Math.max(120, textEditRecord.bounds.width * viewport.zoom)}px`
    } as const;
  }, [activeTextNode, textEditRecord, viewport]);

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
              disabled={!sessionSnapshot.canRedo}
              onClick={() => sessionRef.current?.redo()}
              type="button"
            >
              Redo
            </button>
            <button
              className="button button-secondary"
              onClick={() => setViewport((current) => ({ ...current, zoom: clampZoom(current.zoom * 0.9) }))}
              type="button"
            >
              Zoom out
            </button>
            <button className="button button-secondary" onClick={() => setViewport(createInitialViewport())} type="button">
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
            onDoubleClick={handleCanvasDoubleClick}
            onPointerCancel={() => updateActiveInteraction(null)}
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
