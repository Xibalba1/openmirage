import {
  type AssetRecordDto,
  type AuthenticatedUser,
  type CommentDto,
  type CommentListResponse,
  type CreatedShareLinkResponse,
  type CreateCommentInput,
  type CreateExportJobInput,
  type EditorAccessDto,
  type ExportJobDto,
  type FileDto,
  type GroupNode,
  type GroupNodesCommand,
  type ListAssetsResponse,
  type PageDocumentDto,
  type PageDto,
  type PresenceParticipant,
  type ProjectDto,
  type RuntimeUrls,
  type SceneGraphNode,
  type ShareLinkDto,
  type ShareLinkRecordDto,
  type ShareLinkListResponse,
  type WorkspaceDetailDto,
  type WorkspaceDto
} from "@openmirage/types";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { buildJsonRequestHeaders } from "../http";
import {
  applyEditorCommand,
  getNodeAbsolutePosition,
  getTopLevelNodeIds,
  isContainerNode
} from "./commands";
import {
  hitTestPaintRecords,
  hitTestResizeHandle,
  selectPaintRecordsInMarquee
} from "./hit-test";
import {
  createEmptyDocument,
  createImageNodeCommandForInsert,
  createNodeCommandForInsert,
  deriveMoveUpdates,
  deriveResizeUpdates,
  getContainerInsertionTarget
} from "./interactions";
import {
  createImageLoadManager,
  type ImageLoadManager,
  type ImageResourceState
} from "./image-load-manager";
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
import { getMissingAssetRefreshKey } from "./asset-resolution";
import { deriveInspectDetails } from "./inspect";
import {
  canCreateExportJobs,
  describeExportJobState,
  isExportActionDisabled,
  isTerminalExportJobStatus,
  shouldPollExportJob,
  type ExportJobState
} from "./export-jobs";
import {
  type ActiveInteraction,
  type ActiveTextEdit,
  type EditorSession,
  type EditorSessionSnapshot,
  type EditorSessionStatus,
  type Point,
  type ViewportState
} from "./types";

interface AppPageRoute {
  fileId: string;
  pageId: string;
  projectId: string;
  workspaceId: string;
}

type CommentLoadState =
  | { comments: CommentDto[]; status: "loaded" }
  | { comments: CommentDto[]; status: "loading" }
  | { comments: CommentDto[]; message: string; status: "error" };

type AssetLoadState =
  | { assets: AssetRecordDto[]; status: "loaded" }
  | { assets: AssetRecordDto[]; status: "loading" }
  | {
      assets: AssetRecordDto[];
      message: string;
      requestId?: string;
      status: "error";
    };

type ShareLinkLoadState =
  | { shareLinks: ShareLinkRecordDto[]; status: "loaded" }
  | { shareLinks: ShareLinkRecordDto[]; status: "loading" }
  | { message: string; shareLinks: ShareLinkRecordDto[]; status: "error" };

const PRESENCE_COLORS = [
  "#f97316",
  "#06b6d4",
  "#84cc16",
  "#f43f5e",
  "#eab308",
  "#8b5cf6",
  "#14b8a6",
  "#ef4444"
] as const;

function createApiUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

function buildBrowserShareUrl(token: string): string | null {
  try {
    return new URL(`/share/${encodeURIComponent(token)}`, window.location.origin).toString();
  } catch {
    return null;
  }
}

function resolveInsertedImageSize(asset: AssetRecordDto): {
  height: number;
  width: number;
} {
  const fallback = {
    height: 240,
    width: 320
  };
  const width = asset.width ?? fallback.width;
  const height = asset.height ?? fallback.height;

  if (width <= 0 || height <= 0) {
    return fallback;
  }

  const scale = Math.min(1, 480 / Math.max(width, height));

  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale))
  };
}

async function fetchEditorJson<T>(
  apiBaseUrl: string,
  path: string,
  init?: RequestInit,
  credentials: RequestCredentials = "include"
): Promise<T> {
  const response = await fetch(createApiUrl(apiBaseUrl, path), {
    credentials,
    ...init,
    headers: buildJsonRequestHeaders(init)
  });

  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    const error = new Error(
      failure.error ?? `Request failed with HTTP ${response.status}`
    ) as Error & {
      code?: string;
      requestId?: string;
      status?: number;
    };

    if (failure.error) {
      error.code = failure.error;
    }
    const requestId = response.headers.get("x-request-id");
    if (requestId) {
      error.requestId = requestId;
    }
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as T;
}

async function fetchPublicEditorJson<T>(
  apiBaseUrl: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  return fetchEditorJson<T>(apiBaseUrl, path, init, "same-origin");
}

async function uploadEditorAsset(
  apiBaseUrl: string,
  path: string,
  file: File
): Promise<AssetRecordDto> {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("scope", "file");

  const response = await fetch(createApiUrl(apiBaseUrl, path), {
    body: formData,
    credentials: "include",
    method: "POST"
  });

  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    const error = new Error(
      failure.error ?? `Request failed with HTTP ${response.status}`
    ) as Error & {
      code?: string;
      requestId?: string;
      status?: number;
    };

    if (failure.error) {
      error.code = failure.error;
    }
    const requestId = response.headers.get("x-request-id");
    if (requestId) {
      error.requestId = requestId;
    }
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as AssetRecordDto;
}

async function fetchEditorAssets(
  apiBaseUrl: string,
  route: Pick<AppPageRoute, "fileId" | "projectId" | "workspaceId">,
  shareToken?: string | null
): Promise<ListAssetsResponse> {
  if (shareToken) {
    return fetchPublicEditorJson<ListAssetsResponse>(
      apiBaseUrl,
      `/v1/share-links/${encodeURIComponent(shareToken)}/assets`,
      {
        method: "GET"
      }
    );
  }

  return fetchEditorJson<ListAssetsResponse>(
    apiBaseUrl,
    `/v1/workspaces/${encodeURIComponent(route.workspaceId)}/projects/${encodeURIComponent(route.projectId)}/files/${encodeURIComponent(route.fileId)}/assets?includeWorkspaceAssets=true`,
    {
      method: "GET"
    }
  );
}

async function fetchFileShareLinks(
  apiBaseUrl: string,
  route: Pick<AppPageRoute, "fileId" | "projectId" | "workspaceId">
): Promise<ShareLinkListResponse> {
  return fetchEditorJson<ShareLinkListResponse>(
    apiBaseUrl,
    `/v1/workspaces/${encodeURIComponent(route.workspaceId)}/projects/${encodeURIComponent(route.projectId)}/files/${encodeURIComponent(route.fileId)}/share-links`,
    {
      method: "GET"
    }
  );
}

async function createFileShareLink(
  apiBaseUrl: string,
  route: Pick<AppPageRoute, "fileId" | "projectId" | "workspaceId">
): Promise<CreatedShareLinkResponse> {
  return fetchEditorJson<CreatedShareLinkResponse>(
    apiBaseUrl,
    `/v1/workspaces/${encodeURIComponent(route.workspaceId)}/projects/${encodeURIComponent(route.projectId)}/files/${encodeURIComponent(route.fileId)}/share-links`,
    {
      method: "POST"
    }
  );
}

async function revokeFileShareLink(
  apiBaseUrl: string,
  route: Pick<AppPageRoute, "fileId" | "projectId" | "workspaceId">,
  shareLinkId: string
): Promise<ShareLinkDto> {
  return fetchEditorJson<ShareLinkDto>(
    apiBaseUrl,
    `/v1/workspaces/${encodeURIComponent(route.workspaceId)}/projects/${encodeURIComponent(route.projectId)}/files/${encodeURIComponent(route.fileId)}/share-links/${encodeURIComponent(shareLinkId)}/revoke`,
    {
      method: "POST"
    }
  );
}

async function createExportJob(
  apiBaseUrl: string,
  route: Pick<AppPageRoute, "fileId" | "projectId" | "workspaceId">,
  input: CreateExportJobInput
): Promise<ExportJobDto> {
  return fetchEditorJson<ExportJobDto>(
    apiBaseUrl,
    `/v1/workspaces/${encodeURIComponent(route.workspaceId)}/projects/${encodeURIComponent(route.projectId)}/files/${encodeURIComponent(route.fileId)}/export-jobs`,
    {
      body: JSON.stringify(input),
      method: "POST"
    }
  );
}

async function fetchExportJob(
  apiBaseUrl: string,
  route: Pick<AppPageRoute, "fileId" | "projectId" | "workspaceId">,
  jobId: string
): Promise<ExportJobDto> {
  return fetchEditorJson<ExportJobDto>(
    apiBaseUrl,
    `/v1/workspaces/${encodeURIComponent(route.workspaceId)}/projects/${encodeURIComponent(route.projectId)}/files/${encodeURIComponent(route.fileId)}/export-jobs/${encodeURIComponent(jobId)}`,
    {
      method: "GET"
    }
  );
}

function buildExportJobDownloadUrl(
  apiBaseUrl: string,
  route: Pick<AppPageRoute, "fileId" | "projectId" | "workspaceId">,
  jobId: string
): string {
  return createApiUrl(
    apiBaseUrl,
    `/v1/workspaces/${encodeURIComponent(route.workspaceId)}/projects/${encodeURIComponent(route.projectId)}/files/${encodeURIComponent(route.fileId)}/export-jobs/${encodeURIComponent(jobId)}/download`
  );
}

function readEditorRequestId(error: unknown): string | undefined {
  return error instanceof Error &&
    typeof (error as Error & { requestId?: string }).requestId === "string"
    ? (error as Error & { requestId?: string }).requestId
    : undefined;
}

function formatAssetErrorMessage(
  error: unknown,
  fallback: string
): string {
  const code =
    error instanceof Error &&
    typeof (error as Error & { code?: string }).code === "string"
      ? (error as Error & { code?: string }).code
      : null;

  if (
    code === "internal_error" ||
    code === "storage_unavailable" ||
    code === "upload_persist_failed"
  ) {
    return fallback;
  }

  return error instanceof Error ? error.message : String(error);
}

function createAssetErrorState(
  assets: AssetRecordDto[],
  message: string,
  requestId?: string
): Extract<AssetLoadState, { status: "error" }> {
  return requestId
    ? {
        assets,
        message,
        requestId,
        status: "error"
      }
    : {
        assets,
        message,
        status: "error"
      };
}

function createPresenceParticipant(
  user: AuthenticatedUser
): PresenceParticipant {
  let hash = 0;

  for (const character of user.id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return {
    avatarUrl: user.avatarUrl,
    color: PRESENCE_COLORS[hash % PRESENCE_COLORS.length] ?? PRESENCE_COLORS[0],
    displayName: user.displayName,
    userId: user.id
  };
}

function useCanvasResizeVersion(
  canvasRef: React.RefObject<HTMLCanvasElement | null>
) {
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
        updates: deriveMoveUpdates(
          interaction.originalDocument,
          selectedIds,
          delta
        )
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

function resolvePrimarySelectionId(
  selectedIds: string[],
  preferredId: string | null
): string | null {
  if (preferredId && selectedIds.includes(preferredId)) {
    return preferredId;
  }

  return selectedIds.at(-1) ?? null;
}

function getLayerOrder(
  document: PageDocumentDto,
  parentId: string | null
): string[] {
  if (!parentId) {
    return document.rootNodeIds;
  }

  const parent = document.nodes[parentId];
  return parent && isContainerNode(parent) ? parent.childIds : [];
}

function flattenLayerTree(
  document: PageDocumentDto,
  parentId: string | null,
  depth = 0
): Array<{ depth: number; node: SceneGraphNode }> {
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
  access: EditorAccessDto;
  collab: RuntimeUrls;
  currentUser: AuthenticatedUser;
  file: FileDto;
  onCreatePage: (name: string) => Promise<void>;
  onNavigatePage: (pageId: string) => void;
  onRenameFile: (fileId: string, name: string) => Promise<void>;
  onRenamePage: (pageId: string, name: string) => Promise<void>;
  page: PageDto;
  pages: PageDto[];
  project: ProjectDto;
  route: AppPageRoute;
  shareToken: string | null;
  workspace: WorkspaceDetailDto | WorkspaceDto;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasShellRef = useRef<HTMLDivElement | null>(null);
  const imageLoadManagerRef = useRef<ImageLoadManager<HTMLImageElement> | null>(
    null
  );
  const imageUploadInputRef = useRef<HTMLInputElement | null>(null);
  const requestedMissingAssetKeyRef = useRef<string | null>(null);
  const sessionRef = useRef<EditorSession | null>(null);
  const [sessionSnapshot, setSessionSnapshot] = useState<EditorSessionSnapshot>(
    {
      canRedo: false,
      canUndo: false,
      document: createEmptyDocument(props.page.id),
      localClientId: 0,
      presenceEntries: []
    }
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [primarySelectionId, setPrimarySelectionId] = useState<string | null>(
    null
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ViewportState>(
    createInitialViewport
  );
  const [collabStatus, setCollabStatus] = useState<EditorSessionStatus>({
    attemptCount: 0,
    lastFailureReason: null,
    state: "connecting"
  });
  const [activeScopeId, setActiveScopeId] = useState<string | null>(null);
  const [activeTextEdit, setActiveTextEdit] = useState<ActiveTextEdit | null>(
    null
  );
  const [activeInteraction, setActiveInteraction] =
    useState<ActiveInteraction | null>(null);
  const [commentLoadState, setCommentLoadState] = useState<CommentLoadState>({
    comments: [],
    status: "loading"
  });
  const [assetLoadState, setAssetLoadState] = useState<AssetLoadState>({
    assets: [],
    status: "loading"
  });
  const [imageResources, setImageResources] = useState<ImageResourceState>({});
  const [commentDraft, setCommentDraft] = useState("");
  const [commentTargetType, setCommentTargetType] = useState<
    "file" | "node" | "page"
  >("page");
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [resolvingCommentId, setResolvingCommentId] = useState<string | null>(
    null
  );
  const [shareLinkLoadState, setShareLinkLoadState] =
    useState<ShareLinkLoadState>({
      shareLinks: [],
      status: "loading"
    });
  const [copiedShareLinkId, setCopiedShareLinkId] = useState<string | null>(
    null
  );
  const [isCreatingShareLink, setIsCreatingShareLink] = useState(false);
  const [revokingShareLinkId, setRevokingShareLinkId] = useState<string | null>(
    null
  );
  const [exportJobState, setExportJobState] = useState<ExportJobState>({
    job: null,
    status: "idle"
  });
  const canMutate = props.access.canMutate;
  const canViewComments = !props.shareToken;
  const canComment = props.access.canComment && canViewComments;
  const canManageShareLinks = props.access.canManageShareLinks && !props.shareToken;
  const canCreateExports = canCreateExportJobs(props.shareToken);

  if (!imageLoadManagerRef.current) {
    imageLoadManagerRef.current = createImageLoadManager({
      createImage: () => new Image(),
      updateResources: setImageResources
    });
  }

  const resizeVersion = useCanvasResizeVersion(canvasRef);
  const presenceParticipant = useMemo(
    () => createPresenceParticipant(props.currentUser),
    [props.currentUser]
  );

  useEffect(() => {
    imageLoadManagerRef.current?.clear();
    setSessionSnapshot({
      canRedo: false,
      canUndo: false,
      document: createEmptyDocument(props.page.id),
      localClientId: 0,
      presenceEntries: []
    });
    setSelectedIds([]);
    setPrimarySelectionId(null);
    setHoveredId(null);
    setViewport(createInitialViewport());
    setActiveScopeId(null);
    setActiveTextEdit(null);
    setActiveInteraction(null);
    setCollabStatus({
      attemptCount: 0,
      lastFailureReason: null,
      state: "connecting"
    });
    setAssetLoadState({
      assets: [],
      status: "loading"
    });
    setImageResources({});
    setExportJobState({
      job: null,
      status: "idle"
    });

    const session = createEditorSession(
      {
        accessMode: props.access.mode,
        pageId: props.page.id,
        presence: {
          participant: presenceParticipant
        },
        transport: {
          apiBaseUrl: props.collab.apiBaseUrl,
          collabWsPath: props.collab.collabWsPath,
          collabWsUrl: props.collab.collabWsUrl,
          location: {
            fileId: props.route.fileId,
            projectId: props.route.projectId,
            pageId: props.route.pageId,
            ...(props.shareToken ? { shareToken: props.shareToken } : {}),
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
      imageLoadManagerRef.current?.clear();
      unsubscribe();
      session.destroy();
      sessionRef.current = null;
    };
  }, [
    props.collab.apiBaseUrl,
    props.collab.collabWsPath,
    props.collab.collabWsUrl,
    props.access.mode,
    props.page.id,
    presenceParticipant,
    props.route.fileId,
    props.route.projectId,
    props.route.pageId,
    props.shareToken,
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
    if (
      activeInteraction?.type !== "marquee" ||
      !activeInteraction.currentPagePoint
    ) {
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
          new Set([...activeInteraction.startSelectedIds, ...marqueeSelection])
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
  const assetsById = useMemo(
    () =>
      Object.fromEntries(
        assetLoadState.assets.map((asset) => [asset.id, asset] as const)
      ),
    [assetLoadState.assets]
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
  const availableCommentTargetTypes = useMemo(
    () =>
      effectivePrimarySelectionId &&
      Boolean(sessionSnapshot.document.nodes[effectivePrimarySelectionId])
        ? (["node", "page", "file"] as const)
        : (["page", "file"] as const),
    [effectivePrimarySelectionId, sessionSnapshot.document.nodes]
  );
  const visiblePresenceEntries = useMemo(
    () =>
      sessionSnapshot.presenceEntries.filter(
        (entry) => entry.clientId !== sessionSnapshot.localClientId
      ),
    [sessionSnapshot.localClientId, sessionSnapshot.presenceEntries]
  );
  const remoteCursorEntries = useMemo(
    () =>
      visiblePresenceEntries.filter((entry) => entry.payload.cursor !== null),
    [visiblePresenceEntries]
  );
  const referencedAssetIds = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(sessionSnapshot.document.nodes)
            .filter(
              (node): node is Extract<SceneGraphNode, { type: "image" }> =>
                node.type === "image"
            )
            .map((node) => node.assetId)
        )
      ),
    [sessionSnapshot.document.nodes]
  );
  const missingAssetRefreshKey = useMemo(
    () =>
      getMissingAssetRefreshKey(referencedAssetIds, Object.keys(assetsById)),
    [assetsById, referencedAssetIds]
  );
  const remoteSelectionEntries = useMemo(
    () =>
      visiblePresenceEntries
        .map((entry) => ({
          color: entry.payload.participant.color,
          displayName: entry.payload.participant.displayName,
          nodeRecords: (entry.payload.selection?.nodeIds ?? [])
            .map((nodeId) => getNodePaintRecord(scopedRecords, nodeId))
            .filter(
              (record): record is NonNullable<typeof record> => record !== null
            )
        }))
        .filter((entry) => entry.nodeRecords.length > 0),
    [scopedRecords, visiblePresenceEntries]
  );
  const inspectDetails = useMemo(
    () =>
      effectivePrimarySelectionId
        ? deriveInspectDetails(sessionSnapshot.document, effectivePrimarySelectionId)
        : null,
    [effectivePrimarySelectionId, sessionSnapshot.document]
  );
  const sortedComments = useMemo(
    () =>
      [...commentLoadState.comments].sort((left, right) => {
        if (left.resolvedAt && !right.resolvedAt) {
          return 1;
        }

        if (!left.resolvedAt && right.resolvedAt) {
          return -1;
        }

        return (
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime()
        );
      }),
    [commentLoadState.comments]
  );
  const loadedImages = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(imageResources).map(([assetId, resource]) => [
          assetId,
          resource.status === "loaded" ? resource.image : null
        ])
      ),
    [imageResources]
  );

  useEffect(() => {
    if (!primarySelectionId || previewDocument.nodes[primarySelectionId]) {
      return;
    }

    setPrimarySelectionId(null);
    setSelectedIds([]);
  }, [previewDocument.nodes, primarySelectionId]);

  useEffect(() => {
    if (activeScopeId && !previewDocument.nodes[activeScopeId]) {
      setActiveScopeId(null);
    }
  }, [activeScopeId, previewDocument.nodes]);

  useEffect(() => {
    sessionRef.current?.setPresenceSelection(effectiveSelectedIds);
  }, [effectiveSelectedIds]);

  useEffect(() => {
    if (
      !availableCommentTargetTypes.some(
        (targetType) => targetType === commentTargetType
      )
    ) {
      setCommentTargetType(availableCommentTargetTypes[0]);
    }
  }, [availableCommentTargetTypes, commentTargetType]);

  useEffect(() => {
    if (!canViewComments) {
      setCommentLoadState({
        comments: [],
        status: "loaded"
      });
      return;
    }

    let cancelled = false;

    async function loadAssets() {
      setAssetLoadState((current) => ({
        assets: current.assets,
        status: "loading"
      }));

      try {
        const payload = await fetchEditorAssets(
          props.collab.apiBaseUrl,
          props.route,
          props.shareToken
        );

        if (cancelled) {
          return;
        }

        setAssetLoadState({
          assets: payload.assets,
          status: "loaded"
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setAssetLoadState((current) =>
          createAssetErrorState(
            current.assets,
            formatAssetErrorMessage(
              error,
              "Assets couldn't be loaded. Refresh to retry."
            ),
            readEditorRequestId(error)
          )
        );
      }
    }

    void loadAssets();

    return () => {
      cancelled = true;
    };
  }, [
      props.collab.apiBaseUrl,
      props.route.fileId,
      props.route.projectId,
      props.shareToken,
      props.route.workspaceId
    ]);

  useEffect(() => {
    requestedMissingAssetKeyRef.current = null;
  }, [
    props.page.id,
    props.route.fileId,
    props.route.projectId,
    props.route.workspaceId
  ]);

  useEffect(() => {
    if (!missingAssetRefreshKey) {
      requestedMissingAssetKeyRef.current = null;
      return;
    }

    if (requestedMissingAssetKeyRef.current === missingAssetRefreshKey) {
      return;
    }

    requestedMissingAssetKeyRef.current = missingAssetRefreshKey;
    let cancelled = false;

    void fetchEditorAssets(props.collab.apiBaseUrl, props.route, props.shareToken)
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setAssetLoadState({
          assets: payload.assets,
          status: "loaded"
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setAssetLoadState((current) =>
          createAssetErrorState(
            current.assets,
            formatAssetErrorMessage(
              error,
              "Assets couldn't be loaded. Refresh to retry."
            ),
            readEditorRequestId(error)
          )
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    missingAssetRefreshKey,
    props.collab.apiBaseUrl,
    props.route.fileId,
    props.route.projectId,
    props.shareToken,
    props.route.workspaceId
  ]);

  useEffect(() => {
    imageLoadManagerRef.current?.sync({
      assetsById,
      imageResources,
      referencedAssetIds
    });
  }, [assetsById, referencedAssetIds]);

  useEffect(() => {
    let cancelled = false;

    async function loadComments() {
      setCommentLoadState((current) => ({
        comments: current.comments,
        status: "loading"
      }));

      try {
        const payload = await fetchEditorJson<CommentListResponse>(
          props.collab.apiBaseUrl,
          `/v1/workspaces/${encodeURIComponent(props.route.workspaceId)}/projects/${encodeURIComponent(props.route.projectId)}/files/${encodeURIComponent(props.route.fileId)}/comments?pageId=${encodeURIComponent(props.page.id)}&includeResolved=true`,
          {
            method: "GET"
          }
        );

        if (cancelled) {
          return;
        }

        setCommentLoadState({
          comments: payload.comments,
          status: "loaded"
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setCommentLoadState((current) => ({
          comments: current.comments,
          message: error instanceof Error ? error.message : String(error),
          status: "error"
        }));
      }
    }

    void loadComments();

    return () => {
      cancelled = true;
    };
  }, [
      props.collab.apiBaseUrl,
      canViewComments,
      props.page.id,
      props.route.fileId,
      props.route.projectId,
      props.route.workspaceId
    ]);

  useEffect(() => {
    if (!canManageShareLinks) {
      setShareLinkLoadState({
        shareLinks: [],
        status: "loaded"
      });
      return;
    }

    let cancelled = false;

    async function loadShareLinks() {
      setShareLinkLoadState((current) => ({
        shareLinks: current.shareLinks,
        status: "loading"
      }));

      try {
        const payload = await fetchFileShareLinks(
          props.collab.apiBaseUrl,
          props.route
        );

        if (cancelled) {
          return;
        }

        setShareLinkLoadState({
          shareLinks: payload.shareLinks,
          status: "loaded"
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setShareLinkLoadState((current) => ({
          message: error instanceof Error ? error.message : String(error),
          shareLinks: current.shareLinks,
          status: "error"
        }));
      }
    }

    void loadShareLinks();

    return () => {
      cancelled = true;
    };
  }, [
    canManageShareLinks,
    props.collab.apiBaseUrl,
    props.route.fileId,
    props.route.projectId,
    props.route.workspaceId
  ]);

  useEffect(() => {
    if (canCreateExports) {
      return;
    }

    setExportJobState({
      job: null,
      status: "idle"
    });
  }, [canCreateExports]);

  useEffect(() => {
    if (!shouldPollExportJob(exportJobState)) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (!exportJobState.job) {
        return;
      }

      try {
        const nextJob = await fetchExportJob(
          props.collab.apiBaseUrl,
          props.route,
          exportJobState.job.id
        );

        if (cancelled) {
          return;
        }

        if (nextJob.status === "succeeded") {
          setExportJobState({
            job: nextJob,
            status: "succeeded"
          });
          return;
        }

        if (nextJob.status === "failed" || nextJob.status === "cancelled") {
          setExportJobState({
            job: nextJob,
            message: nextJob.errorMessage ?? `Export ${nextJob.status}.`,
            status: "failed"
          });
          return;
        }

        setExportJobState({
          job: nextJob,
          status: "polling"
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setExportJobState((current) => ({
          job: current.job,
          message: error instanceof Error ? error.message : String(error),
          status: "failed"
        }));
      }
    }, exportJobState.status === "submitting" ? 250 : 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [exportJobState, props.collab.apiBaseUrl, props.route]);

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
      loadedImages,
      {
        hoveredId,
        marquee:
          activeInteraction?.type === "marquee" &&
          activeInteraction.currentPagePoint
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
    loadedImages,
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
        if (!canMutate) {
          return;
        }

        event.preventDefault();

        if (event.shiftKey) {
          session.redo();
          return;
        }

        session.undo();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        if (!canMutate) {
          return;
        }

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
        if (!canMutate) {
          return;
        }

        if (effectiveSelectedIds.length === 0) {
          return;
        }

        event.preventDefault();
        session.commit({
          nodeIds: effectiveSelectedIds,
          pageId: props.page.id,
          type: "delete-node"
        });
        setSelectedIds([]);
        setPrimarySelectionId(null);
        return;
      }

      if (event.key === "Escape") {
        if (activeInteraction) {
          event.preventDefault();
          setActiveInteraction(null);
          return;
        }

        if (activeScopeId) {
          event.preventDefault();
          const nextScopeId =
            sessionSnapshot.document.nodes[activeScopeId]?.parentId ?? null;
          setActiveScopeId(nextScopeId);
          setSelectedIds(nextScopeId ? [nextScopeId] : []);
          setPrimarySelectionId(nextScopeId);
        }

        return;
      }

      if (event.key === "Enter" && effectivePrimarySelectionId) {
        if (!canMutate) {
          return;
        }

        const node =
          sessionSnapshot.document.nodes[effectivePrimarySelectionId];

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
    canMutate,
    effectivePrimarySelectionId,
    effectiveSelectedIds,
    props.page.id,
    sessionSnapshot.document
  ]);

  function updateSelection(
    nextSelectedIds: string[],
    nextPrimaryId: string | null
  ) {
    setSelectedIds(nextSelectedIds);
    setPrimarySelectionId(
      resolvePrimarySelectionId(nextSelectedIds, nextPrimaryId)
    );
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

  function readPagePoint(event: {
    clientX: number;
    clientY: number;
  }): Point | null {
    const screenPoint = readCanvasPoint(event);

    if (!screenPoint) {
      return null;
    }

    return screenPointToPagePoint(screenPoint, viewport);
  }

  function commitTextEdit() {
    const session = sessionRef.current;

    if (!session || !activeTextEdit || !activeTextNode || !canMutate) {
      setActiveTextEdit(null);
      return;
    }

    session.commit({
      nodeId: activeTextNode.id,
      pageId: props.page.id,
      patch: {
        content: activeTextEdit.draft,
        height: activeTextNode.height,
        width: activeTextNode.width
      } as Partial<SceneGraphNode>,
      type: "update-node"
    });
    setActiveTextEdit(null);
  }

  async function refreshComments() {
    if (!canViewComments) {
      setCommentLoadState({
        comments: [],
        status: "loaded"
      });
      return;
    }

    const payload = await fetchEditorJson<CommentListResponse>(
      props.collab.apiBaseUrl,
      `/v1/workspaces/${encodeURIComponent(props.route.workspaceId)}/projects/${encodeURIComponent(props.route.projectId)}/files/${encodeURIComponent(props.route.fileId)}/comments?pageId=${encodeURIComponent(props.page.id)}&includeResolved=true`,
      {
        method: "GET"
      }
    );

    setCommentLoadState({
      comments: payload.comments,
      status: "loaded"
    });
  }

  async function refreshAssets() {
    const payload = await fetchEditorAssets(
      props.collab.apiBaseUrl,
      props.route,
      props.shareToken
    );

    setAssetLoadState({
      assets: payload.assets,
      status: "loaded"
    });
  }

  async function handleCreateShareLink() {
    if (!canManageShareLinks) {
      return;
    }

    setIsCreatingShareLink(true);

    try {
      const payload = await createFileShareLink(props.collab.apiBaseUrl, props.route);
      const shareUrl = payload.shareLink.shareUrl ?? buildBrowserShareUrl(payload.token);
      setShareLinkLoadState((current) => ({
        shareLinks: [
          {
            ...payload.shareLink,
            shareUrl
          },
          ...current.shareLinks.filter(
            (shareLink) => shareLink.id !== payload.shareLink.id
          )
        ],
        status: "loaded"
      }));
      if (navigator.clipboard?.writeText && shareUrl) {
        await navigator.clipboard.writeText(shareUrl);
        setCopiedShareLinkId(payload.shareLink.id);
      }
    } catch (error) {
      setShareLinkLoadState((current) => ({
        message: error instanceof Error ? error.message : String(error),
        shareLinks: current.shareLinks,
        status: "error"
      }));
    } finally {
      setIsCreatingShareLink(false);
    }
  }

  async function handleCopyShareLink(shareLink: ShareLinkRecordDto) {
    if (!navigator.clipboard?.writeText || !shareLink.shareUrl) {
      return;
    }

    await navigator.clipboard.writeText(shareLink.shareUrl);
    setCopiedShareLinkId(shareLink.id);
  }

  async function handleRevokeShareLink(shareLinkId: string) {
    if (!canManageShareLinks) {
      return;
    }

    setRevokingShareLinkId(shareLinkId);

    try {
      const revoked = await revokeFileShareLink(
        props.collab.apiBaseUrl,
        props.route,
        shareLinkId
      );
      setShareLinkLoadState((current) => ({
        shareLinks: current.shareLinks.map((shareLink) =>
          shareLink.id === shareLinkId
            ? {
                ...revoked,
                shareUrl: shareLink.shareUrl
              }
            : shareLink
        ),
        status: "loaded"
      }));
    } catch (error) {
      setShareLinkLoadState((current) => ({
        message: error instanceof Error ? error.message : String(error),
        shareLinks: current.shareLinks,
        status: "error"
      }));
    } finally {
      setRevokingShareLinkId(null);
    }
  }

  async function handleCreateExportJob(input: CreateExportJobInput) {
    if (!canCreateExports) {
      return;
    }

    setExportJobState((current) => ({
      job: current.job,
      status: "submitting"
    }));

    try {
      const job = await createExportJob(props.collab.apiBaseUrl, props.route, input);
      setExportJobState(
        isTerminalExportJobStatus(job.status)
          ? job.status === "succeeded"
            ? {
                job,
                status: "succeeded"
              }
            : {
                job,
                message: job.errorMessage ?? `Export ${job.status}.`,
                status: "failed"
              }
          : {
              job,
              status: "polling"
            }
      );
    } catch (error) {
      setExportJobState({
        job: null,
        message: error instanceof Error ? error.message : String(error),
        status: "failed"
      });
    }
  }

  function handleDismissExportJob() {
    setExportJobState({
      job: null,
      status: "idle"
    });
  }

  function insertImageAsset(asset: AssetRecordDto) {
    const session = sessionRef.current;
    const canvas = canvasRef.current;

    if (!session || !canvas || !canMutate) {
      return;
    }

    const targetParentId = getContainerInsertionTarget({
      activeScopeId,
      document: sessionSnapshot.document,
      primarySelectionId
    });
    const parentAbsolutePosition = targetParentId
      ? (getNodeAbsolutePosition(sessionSnapshot.document, targetParentId) ?? {
          x: 0,
          y: 0
        })
      : { x: 0, y: 0 };
    const centerPoint = screenPointToPagePoint(
      {
        x: canvas.clientWidth / 2,
        y: canvas.clientHeight / 2
      },
      viewport
    );
    const size = resolveInsertedImageSize(asset);
    const command = createImageNodeCommandForInsert({
      assetId: asset.id,
      fitMode: "cover",
      height: size.height,
      pageId: props.page.id,
      parentAbsolutePosition,
      parentId: targetParentId,
      point: centerPoint,
      width: size.width
    });

    session.commit(command);
    updateSelection([command.node.id], command.node.id);
  }

  async function handleImageFile(file: File) {
    if (!canMutate) {
      return;
    }

    setIsUploadingAsset(true);

    try {
      const asset = await uploadEditorAsset(
        props.collab.apiBaseUrl,
        `/v1/workspaces/${encodeURIComponent(props.route.workspaceId)}/projects/${encodeURIComponent(props.route.projectId)}/files/${encodeURIComponent(props.route.fileId)}/assets`,
        file
      );
      setAssetLoadState((current) => ({
        assets: [
          asset,
          ...current.assets.filter((existingAsset) => existingAsset.id !== asset.id)
        ],
        status: "loaded"
      }));
      insertImageAsset(asset);
      await refreshAssets();
    } catch (error) {
      setAssetLoadState((current) =>
        createAssetErrorState(
          current.assets,
          formatAssetErrorMessage(error, "Image upload failed. Please retry."),
          readEditorRequestId(error)
        )
      );
    } finally {
      setIsUploadingAsset(false);
      if (imageUploadInputRef.current) {
        imageUploadInputRef.current.value = "";
      }
    }
  }

  async function handleSubmitComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canComment) {
      return;
    }

    const trimmedBody = commentDraft.trim();

    if (!trimmedBody) {
      return;
    }

    const target: CreateCommentInput["target"] =
      commentTargetType === "file"
        ? {
            fileId: props.file.id,
            type: "file"
          }
        : commentTargetType === "node" && effectivePrimarySelectionId
          ? {
              fileId: props.file.id,
              nodeId: effectivePrimarySelectionId,
              pageId: props.page.id,
              type: "node"
            }
          : {
              fileId: props.file.id,
              pageId: props.page.id,
              type: "page"
            };

    setIsSubmittingComment(true);

    try {
      await fetchEditorJson<CommentDto>(
        props.collab.apiBaseUrl,
        `/v1/workspaces/${encodeURIComponent(props.route.workspaceId)}/projects/${encodeURIComponent(props.route.projectId)}/files/${encodeURIComponent(props.route.fileId)}/comments`,
        {
          body: JSON.stringify({
            body: trimmedBody,
            target
          } satisfies CreateCommentInput),
          method: "POST"
        }
      );
      setCommentDraft("");
      await refreshComments();
    } catch (error) {
      setCommentLoadState((current) => ({
        comments: current.comments,
        message: error instanceof Error ? error.message : String(error),
        status: "error"
      }));
    } finally {
      setIsSubmittingComment(false);
    }
  }

  async function handleResolveComment(commentId: string) {
    if (!canComment) {
      return;
    }

    setResolvingCommentId(commentId);

    try {
      await fetchEditorJson<CommentDto>(
        props.collab.apiBaseUrl,
        `/v1/workspaces/${encodeURIComponent(props.route.workspaceId)}/projects/${encodeURIComponent(props.route.projectId)}/files/${encodeURIComponent(props.route.fileId)}/comments/${encodeURIComponent(commentId)}/resolve`,
        {
          method: "POST"
        }
      );
      await refreshComments();
    } catch (error) {
      setCommentLoadState((current) => ({
        comments: current.comments,
        message: error instanceof Error ? error.message : String(error),
        status: "error"
      }));
    } finally {
      setResolvingCommentId(null);
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const session = sessionRef.current;
    const screenPoint = readCanvasPoint(event);
    const pagePoint = readPagePoint(event);

    if (pagePoint) {
      session?.setPresenceCursor(pagePoint);
      session?.setPresenceSelection(effectiveSelectedIds);
    }

    if (activeInteraction?.type === "pan") {
      if (!screenPoint) {
        return;
      }

      setViewport({
        ...activeInteraction.startViewport,
        panX:
          activeInteraction.startViewport.panX +
          screenPoint.x -
          activeInteraction.startScreenPoint.x,
        panY:
          activeInteraction.startViewport.panY +
          screenPoint.y -
          activeInteraction.startScreenPoint.y
      });
      return;
    }

    if (!pagePoint) {
      return;
    }

    if (activeInteraction) {
      setActiveInteraction((current) =>
        current
          ? {
              ...current,
              currentPagePoint: pagePoint
            }
          : current
      );
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

    if (
      event.button === 1 ||
      event.button === 2 ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey
    ) {
      setActiveInteraction({
        startScreenPoint: screenPoint,
        startViewport: viewport,
        type: "pan"
      });
      return;
    }

    const primaryScopedRecord =
      primaryRecord &&
      scopedRecords.some((record) => record.node.id === primaryRecord.node.id)
        ? primaryRecord
        : null;
    const handleHit = pagePoint
      ? hitTestResizeHandle(primaryScopedRecord, pagePoint, viewport.zoom)
      : null;

    if (canMutate && handleHit && primaryScopedRecord && pagePoint) {
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

    if (!pagePoint) {
      return;
    }

    const hit = hitTestPaintRecords(scopedRecords, pagePoint, viewport.zoom);

    if (!hit) {
      setHoveredId(null);
      setActiveInteraction({
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

    const nextSelectedIds = selectedIds.includes(hit.node.id)
      ? selectedIds
      : [hit.node.id];
    updateSelection(nextSelectedIds, hit.node.id);
    if (canMutate) {
      setActiveInteraction({
        currentPagePoint: pagePoint,
        originalDocument: sessionSnapshot.document,
        startPagePoint: pagePoint,
        type: "move"
      });
    }
  }

  function stopInteraction(event?: ReactPointerEvent<HTMLCanvasElement>) {
    const session = sessionRef.current;

    if (!session || !activeInteraction) {
      setActiveInteraction(null);
      return;
    }

    const pagePoint =
      activeInteraction.currentPagePoint ??
      (event ? readPagePoint(event) : null);

    if (canMutate && activeInteraction.type === "move" && pagePoint) {
      const delta = {
        x: pagePoint.x - activeInteraction.startPagePoint.x,
        y: pagePoint.y - activeInteraction.startPagePoint.y
      };

      if (delta.x || delta.y) {
        session.commit({
          pageId: props.page.id,
          type: "move-node",
          updates: deriveMoveUpdates(
            activeInteraction.originalDocument,
            selectedIds,
            delta
          )
        });
      }
    }

    if (canMutate && activeInteraction.type === "resize" && pagePoint) {
      session.commit({
        nodeId: activeInteraction.record.node.id,
        pageId: props.page.id,
        type: "resize-node",
        updates: deriveResizeUpdates(
          activeInteraction.originalDocument,
          activeInteraction.record,
          activeInteraction.handle,
          pagePoint
        )
      });
    }

    if (activeInteraction.type === "marquee" && pagePoint) {
      const nextSelectedIds = selectPaintRecordsInMarquee(
        scopedRecords,
        activeInteraction.startPagePoint,
        pagePoint
      );

      updateSelection(
        Array.from(
          new Set([...activeInteraction.startSelectedIds, ...nextSelectedIds])
        ),
        nextSelectedIds.at(-1) ??
          activeInteraction.startSelectedIds.at(-1) ??
          null
      );
    }

    setActiveInteraction(null);
  }

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const screenPoint = readCanvasPoint(event);

    if (!screenPoint) {
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      const nextZoom = viewport.zoom * (event.deltaY < 0 ? 1.1 : 0.9);
      setViewport((current) =>
        zoomViewportAtPoint(current, nextZoom, screenPoint)
      );
      return;
    }

    setViewport((current) => ({
      ...current,
      panX: current.panX - event.deltaX,
      panY: current.panY - event.deltaY
    }));
  }

  function handleCanvasDoubleClick(
    event: ReactPointerEvent<HTMLCanvasElement>
  ) {
    const hit = hitTestPaintRecords(
      scopedRecords,
      readPagePoint(event) ?? { x: 0, y: 0 },
      viewport.zoom
    );

    if (!hit) {
      return;
    }

    if (canMutate && hit.node.type === "text") {
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

  function createNode(
    type: "frame" | "rectangle" | "ellipse" | "line" | "text"
  ) {
    const session = sessionRef.current;
    const canvas = canvasRef.current;

    if (!session || !canvas || !canMutate) {
      return;
    }

    const targetParentId = getContainerInsertionTarget({
      activeScopeId,
      document: sessionSnapshot.document,
      primarySelectionId
    });
    const parentAbsolutePosition = targetParentId
      ? (getNodeAbsolutePosition(sessionSnapshot.document, targetParentId) ?? {
          x: 0,
          y: 0
        })
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

    if (!session || !node || !canMutate) {
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

    if (!session || !canMutate) {
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

    if (!session || nodeIds.length === 0 || !canMutate) {
      return;
    }

    session.commit({
      nodeIds,
      pageId: props.page.id,
      type: "delete-node"
    });
    setSelectedIds((current) =>
      current.filter((nodeId) => !nodeIds.includes(nodeId))
    );
    setPrimarySelectionId((current) =>
      current && nodeIds.includes(current) ? null : current
    );
  }

  function groupSelection() {
    const session = sessionRef.current;

    if (!session || !canMutate) {
      return;
    }

    const command = buildGroupCommand(
      sessionSnapshot.document,
      props.page.id,
      selectedIds
    );

    if (!command) {
      return;
    }

    session.commit(command);
    updateSelection([command.group.id], command.group.id);
  }

  function ungroupSelection() {
    const session = sessionRef.current;
    const nodeId = primarySelectionId;

    if (!session || !nodeId || !canMutate) {
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
          {canMutate
            ? "Command-backed editing with collab persistence and inspect-ready values."
            : "Read-only handoff mode with page navigation, selection, and inspect values."}
        </p>
        {canMutate ? (
          <div className="action-strip">
            <InlineRenameForm
              label="Rename file"
              onSubmit={(name) => props.onRenameFile(props.file.id, name)}
            />
            <CreatePageForm onCreate={props.onCreatePage} />
          </div>
        ) : (
          <div className="inline-alert">This file is open in read-only mode.</div>
        )}
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
                    onClick={() => props.onNavigatePage(page.id)}
                    type="button"
                  >
                    <strong>{page.name}</strong>
                    <span>Order {page.orderIndex + 1}</span>
                  </button>
                  {canMutate ? (
                    <InlineRenameForm
                      label="Rename page"
                      onSubmit={(name) => props.onRenamePage(page.id, name)}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="editor-sidebar-section">
          <p className="eyebrow">Layers</p>
          <div className="layer-list">
            {layerItems.map(({ depth, node }) => {
              const order = getLayerOrder(
                sessionSnapshot.document,
                node.parentId
              );
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
                  {canMutate ? (
                    <div className="layer-actions">
                      <button
                        className="button button-secondary button-icon"
                        onClick={() => reorderNode(node.id, -1)}
                        type="button"
                      >
                        ↑
                      </button>
                      <button
                        className="button button-secondary button-icon"
                        onClick={() => reorderNode(node.id, 1)}
                        type="button"
                      >
                        ↓
                      </button>
                      <button
                        className="button button-secondary button-icon"
                        onClick={() =>
                          toggleNodeFlag(node.id, {
                            locked: !node.locked
                          } as Partial<SceneGraphNode>)
                        }
                        type="button"
                      >
                        {node.locked ? "Unlock" : "Lock"}
                      </button>
                      <button
                        className="button button-secondary button-icon"
                        onClick={() =>
                          toggleNodeFlag(node.id, {
                            visible: !node.visible
                          } as Partial<SceneGraphNode>)
                        }
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
                  ) : null}
                  <span className="layer-order">#{index + 1}</span>
                </div>
              );
            })}
          </div>
        </div>
        {canViewComments ? (
          <div className="editor-sidebar-section">
            <p className="eyebrow">Comments</p>
            {canComment ? (
              <form className="comment-form" onSubmit={handleSubmitComment}>
                <label className="comment-field">
                  <span>Anchor</span>
                  <select
                    className="input"
                    onChange={(event) =>
                      setCommentTargetType(
                        event.target.value as "file" | "node" | "page"
                      )
                    }
                    value={commentTargetType}
                  >
                    {availableCommentTargetTypes.map((targetType) => (
                      <option key={targetType} value={targetType}>
                        {targetType === "node"
                          ? "Selected node"
                          : targetType === "page"
                            ? "Current page"
                            : "Whole file"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="comment-field">
                  <span>Comment</span>
                  <textarea
                    className="input comment-textarea"
                    onChange={(event) => setCommentDraft(event.target.value)}
                    placeholder="Leave lightweight review context"
                    rows={4}
                    value={commentDraft}
                  />
                </label>
                <button
                  className="button button-secondary"
                  disabled={isSubmittingComment || commentDraft.trim().length === 0}
                  type="submit"
                >
                  {isSubmittingComment ? "Saving..." : "Add comment"}
                </button>
              </form>
            ) : (
              <p className="muted">Comments are visible but read-only in this mode.</p>
            )}
            {commentLoadState.status === "error" ? (
              <p className="muted">{commentLoadState.message}</p>
            ) : null}
            <div className="comment-list">
              {sortedComments.map((comment) => {
                const nodeMissing =
                  comment.nodeId !== null &&
                  !sessionSnapshot.document.nodes[comment.nodeId];
                const targetLabel =
                  comment.nodeId !== null
                    ? nodeMissing
                      ? "Node (missing)"
                      : "Node"
                    : comment.pageId !== null
                      ? "Page"
                      : "File";

                return (
                  <article
                    className={`comment-card ${comment.resolvedAt ? "comment-card-resolved" : ""}`}
                    key={comment.id}
                  >
                    <div className="comment-card-header">
                      <div>
                        <strong>{comment.author.displayName}</strong>
                        <p className="muted">
                          {new Date(comment.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <span className="presence-chip comment-target-chip">
                        {targetLabel}
                      </span>
                    </div>
                    <p>{comment.body}</p>
                    <div className="comment-card-footer">
                      <span>
                        {comment.resolvedAt
                          ? `Resolved ${new Date(comment.resolvedAt).toLocaleString()}`
                          : "Open"}
                      </span>
                      {!comment.resolvedAt && canComment ? (
                        <button
                          className="button button-secondary button-icon"
                          disabled={resolvingCommentId === comment.id}
                          onClick={() => void handleResolveComment(comment.id)}
                          type="button"
                        >
                          {resolvingCommentId === comment.id ? "..." : "Resolve"}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
              {sortedComments.length === 0 &&
              commentLoadState.status !== "loading" ? (
                <p className="muted">No comments on this file/page yet.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </aside>

      <section className="panel editor-panel">
        <div className="editor-toolbar">
          <div>
            <p className="eyebrow">Page</p>
            <h2>{props.page.name}</h2>
          </div>
          <input
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];

              if (file) {
                void handleImageFile(file);
              }
            }}
            ref={imageUploadInputRef}
            type="file"
          />
          <div className="toolbar-strip">
            {canMutate ? (
              <>
                <button
                  className="button button-secondary"
                  onClick={() => createNode("frame")}
                  type="button"
                >
                  Frame
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => createNode("rectangle")}
                  type="button"
                >
                  Rectangle
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => createNode("ellipse")}
                  type="button"
                >
                  Ellipse
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => createNode("line")}
                  type="button"
                >
                  Line
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => createNode("text")}
                  type="button"
                >
                  Text
                </button>
                <button
                  className="button button-secondary"
                  disabled={isUploadingAsset}
                  onClick={() => imageUploadInputRef.current?.click()}
                  type="button"
                >
                  {isUploadingAsset ? "Uploading..." : "Image"}
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
                  disabled={
                    sessionSnapshot.document.nodes[primarySelectionId ?? ""]
                      ?.type !== "group"
                  }
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
              </>
            ) : null}
            <button
              className="button button-secondary"
              onClick={() =>
                setViewport((current) => ({
                  ...current,
                  zoom: clampZoom(current.zoom * 0.9)
                }))
              }
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
              onClick={() =>
                setViewport((current) => ({
                  ...current,
                  zoom: clampZoom(current.zoom * 1.1)
                }))
              }
              type="button"
            >
              Zoom in
            </button>
          </div>
        </div>

        <div className="editor-meta">
          <span>Access: {props.access.mode}</span>
          <span>Collab: {collabStatus.state}</span>
          <span>
            Assets:{" "}
            {assetLoadState.status === "error"
              ? "error"
              : assetLoadState.status === "loading"
                ? "loading"
                : assetLoadState.assets.length}
          </span>
          <span>
            Viewport: {viewport.zoom.toFixed(2)}x · pan{" "}
            {Math.round(viewport.panX)}/{Math.round(viewport.panY)}
          </span>
          <span>Nodes: {paintRecords.length}</span>
          <span>Selection: {effectivePrimarySelectionId ?? "None"}</span>
          <span>Scope: {activeScopeId ?? "Root"}</span>
          <div className="presence-strip">
            <span className="presence-chip presence-chip-self">
              You · {props.currentUser.displayName}
            </span>
            {visiblePresenceEntries.map((entry) => (
              <span
                className="presence-chip"
                key={entry.clientId}
                style={{ borderColor: `${entry.payload.participant.color}80` }}
              >
                <span
                  className="presence-dot"
                  style={{ backgroundColor: entry.payload.participant.color }}
                />
                {entry.payload.participant.displayName}
              </span>
            ))}
          </div>
        </div>
        {assetLoadState.status === "error" ? (
          <p className="muted">
            {assetLoadState.message}
            {assetLoadState.requestId
              ? ` Request ID: ${assetLoadState.requestId}`
              : ""}
          </p>
        ) : null}

        <div className="editor-canvas-shell" ref={canvasShellRef}>
          <canvas
            aria-label="Editor canvas"
            className="editor-canvas"
            data-testid="editor-canvas"
            onDoubleClick={handleCanvasDoubleClick}
            onPointerCancel={() => setActiveInteraction(null)}
            onPointerDown={handlePointerDown}
            onPointerLeave={() => {
              setHoveredId(null);
              sessionRef.current?.clearPresence();
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={stopInteraction}
            onWheel={handleWheel}
            ref={canvasRef}
          />
          {remoteSelectionEntries.map((entry) =>
            entry.nodeRecords.map((record) => {
              const topLeft = pagePointToScreenPoint(
                { x: record.bounds.x, y: record.bounds.y },
                viewport
              );

              return (
                <div
                  className="remote-selection-overlay"
                  data-participant-name={entry.displayName}
                  data-testid="remote-selection"
                  key={`${entry.displayName}-${record.node.id}`}
                  style={{
                    borderColor: entry.color,
                    color: entry.color,
                    height: `${record.bounds.height * viewport.zoom}px`,
                    left: `${topLeft.x}px`,
                    top: `${topLeft.y}px`,
                    width: `${record.bounds.width * viewport.zoom}px`
                  }}
                >
                  <span
                    className="remote-selection-label"
                    style={{ backgroundColor: entry.color }}
                  >
                    {entry.displayName}
                  </span>
                </div>
              );
            })
          )}
          {remoteCursorEntries.map((entry) => {
            const cursor = entry.payload.cursor;

            if (!cursor) {
              return null;
            }

            const screenPoint = pagePointToScreenPoint(cursor, viewport);

            return (
              <div
                className="remote-cursor"
                data-participant-name={entry.payload.participant.displayName}
                data-testid="remote-cursor"
                key={`cursor-${entry.clientId}`}
                style={{
                  left: `${screenPoint.x}px`,
                  top: `${screenPoint.y}px`
                }}
              >
                <span
                  className="remote-cursor-dot"
                  style={{ backgroundColor: entry.payload.participant.color }}
                />
                <span
                  className="remote-cursor-label"
                  style={{ backgroundColor: entry.payload.participant.color }}
                >
                  {entry.payload.participant.displayName}
                </span>
              </div>
            );
          })}
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

      <aside className="panel editor-inspect-panel">
        <div className="editor-sidebar-section">
          <p className="eyebrow">Inspect</p>
          {inspectDetails ? (
            <div className="inspect-sections">
              {inspectDetails.sections.map((section) => (
                <section className="inspect-section" key={section.title}>
                  <h3>{section.title}</h3>
                  <dl className="inspect-grid">
                    {section.fields.map((field) => (
                      <div key={field.label}>
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          ) : (
            <p className="muted">
              Select a supported node to inspect dimensions, spacing, color,
              typography, and metadata.
            </p>
          )}
        </div>

        <div className="editor-sidebar-section">
          <p className="eyebrow">Export</p>
          {canCreateExports ? (
            <>
              <div className="share-link-actions">
                <button
                  className="button button-secondary"
                  disabled={isExportActionDisabled(exportJobState)}
                  onClick={() =>
                    void handleCreateExportJob({
                      format: "png",
                      pageId: props.page.id
                    })
                  }
                  type="button"
                >
                  Export page PNG
                </button>
                <button
                  className="button button-secondary"
                  disabled={isExportActionDisabled(exportJobState)}
                  onClick={() =>
                    void handleCreateExportJob({
                      format: "pdf",
                      pageId: null
                    })
                  }
                  type="button"
                >
                  Export file PDF
                </button>
              </div>
              {exportJobState.job ? (
                <article className="share-link-card">
                  <div>
                    <strong>
                      {exportJobState.job.format === "pdf"
                        ? "File PDF export"
                        : "Page PNG export"}
                    </strong>
                    <p className="muted">
                      Requested{" "}
                      {new Date(exportJobState.job.createdAt).toLocaleString()}
                    </p>
                    {describeExportJobState(exportJobState) ? (
                      <p className="muted">
                        Status: {describeExportJobState(exportJobState)}
                      </p>
                    ) : null}
                  </div>
                  <div className="share-link-actions">
                    {exportJobState.status === "succeeded" ? (
                      <a
                        className="button button-secondary button-icon"
                        href={buildExportJobDownloadUrl(
                          props.collab.apiBaseUrl,
                          props.route,
                          exportJobState.job.id
                        )}
                      >
                        Download
                      </a>
                    ) : null}
                    {exportJobState.status === "failed" ||
                    exportJobState.status === "succeeded" ? (
                      <button
                        className="button button-secondary button-icon"
                        onClick={handleDismissExportJob}
                        type="button"
                      >
                        Dismiss
                      </button>
                    ) : null}
                  </div>
                </article>
              ) : describeExportJobState(exportJobState) ? (
                <p className="muted">{describeExportJobState(exportJobState)}</p>
              ) : (
                <p className="muted">
                  Export the current page as a PNG or the whole file as a PDF.
                  Jobs run in the background so editing and collaboration stay
                  responsive.
                </p>
              )}
            </>
          ) : (
            <p className="muted">
              Export creation is unavailable from read-only share-link access.
            </p>
          )}
        </div>

        <div className="editor-sidebar-section">
          <p className="eyebrow">Share</p>
          {props.shareToken ? (
            <p className="muted">
              This session is running from a read-only share link. Document
              changes are disabled in the UI and blocked server-side.
            </p>
          ) : canManageShareLinks ? (
            <>
              <button
                className="button button-secondary"
                disabled={isCreatingShareLink}
                onClick={() => void handleCreateShareLink()}
                type="button"
              >
                {isCreatingShareLink ? "Creating..." : "Create share link"}
              </button>
              {shareLinkLoadState.status === "error" ? (
                <p className="muted">{shareLinkLoadState.message}</p>
              ) : null}
              <div className="share-link-list">
                {shareLinkLoadState.shareLinks.map((shareLink) => (
                  <article
                    className="share-link-card"
                    data-share-url={shareLink.shareUrl ?? ""}
                    data-testid="share-link-card"
                    key={shareLink.id}
                  >
                    <div>
                      <strong>{shareLink.revokedAt ? "Revoked link" : "Active link"}</strong>
                      <p className="muted">
                        Created {new Date(shareLink.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="share-link-actions">
                      <button
                        className="button button-secondary button-icon"
                        disabled={!shareLink.shareUrl}
                        onClick={() => void handleCopyShareLink(shareLink)}
                        type="button"
                      >
                        {copiedShareLinkId === shareLink.id ? "Copied" : "Copy"}
                      </button>
                      <button
                        className="button button-secondary button-icon"
                        disabled={
                          Boolean(shareLink.revokedAt) ||
                          revokingShareLinkId === shareLink.id
                        }
                        onClick={() => void handleRevokeShareLink(shareLink.id)}
                        type="button"
                      >
                        {revokingShareLinkId === shareLink.id ? "..." : "Revoke"}
                      </button>
                    </div>
                  </article>
                ))}
                {shareLinkLoadState.shareLinks.length === 0 &&
                shareLinkLoadState.status !== "loading" ? (
                  <p className="muted">
                    No share links yet. Create one for lightweight review or
                    handoff.
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <p className="muted">
              Share management is unavailable in read-only member access.
            </p>
          )}
        </div>
      </aside>
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
    <form
      className="inline-form compact-inline-form"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <input
        onChange={(event) => setValue(event.target.value)}
        placeholder={props.label}
        value={value}
      />
      <button
        className="button button-secondary"
        disabled={isSubmitting}
        type="submit"
      >
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
    <form
      className="inline-form compact-inline-form"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <input
        onChange={(event) => setValue(event.target.value)}
        placeholder="New page name"
        value={value}
      />
      <button
        className="button button-primary"
        disabled={isSubmitting}
        type="submit"
      >
        Add page
      </button>
    </form>
  );
}
