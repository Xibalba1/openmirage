export const serviceNames = ["web", "api", "collab", "worker"] as const;

export type ServiceName = (typeof serviceNames)[number];

export const runtimeEnvironments = [
  "development",
  "test",
  "staging",
  "production"
] as const;

export type RuntimeEnvironment = (typeof runtimeEnvironments)[number];

export interface ServiceDescriptor {
  name: ServiceName;
  summary: string;
}

export interface RuntimeUrls {
  apiBaseUrl: string;
  collabHttpUrl: string;
  collabWsUrl: string;
  collabWsPath: string;
  authPath: string;
  workerHttpUrl: string;
}

export const membershipRoles = ["owner", "editor", "viewer"] as const;

export type MembershipRole = (typeof membershipRoles)[number];

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface WorkspaceMembershipSummary {
  id: string;
  workspaceId: string;
  role: MembershipRole;
}

export const assetKinds = ["image", "font", "export", "thumbnail"] as const;

export type AssetKind = (typeof assetKinds)[number];

export const exportJobFormats = ["png", "jpeg", "svg", "pdf"] as const;

export type ExportJobFormat = (typeof exportJobFormats)[number];

export const exportJobStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
] as const;

export type ExportJobStatus = (typeof exportJobStatuses)[number];

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ProjectDto {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface FileDto {
  id: string;
  projectId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PageDto {
  id: string;
  fileId: string;
  name: string;
  orderIndex: number;
  width: number | null;
  height: number | null;
  background: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetDto {
  id: string;
  workspaceId: string;
  fileId: string | null;
  uploadedByUserId: string;
  kind: AssetKind;
  filename: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CommentDto {
  id: string;
  fileId: string;
  pageId: string | null;
  nodeId: string | null;
  authorUserId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  deletedAt: string | null;
}

export interface ShareLinkDto {
  id: string;
  fileId: string;
  createdByUserId: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface ExportJobDto {
  id: string;
  fileId: string;
  pageId: string | null;
  requestedByUserId: string;
  format: ExportJobFormat;
  status: ExportJobStatus;
  outputAssetId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export const sceneGraphNodeTypes = [
  "frame",
  "group",
  "rectangle",
  "ellipse",
  "line",
  "text",
  "image"
] as const;

export type SceneGraphNodeType = (typeof sceneGraphNodeTypes)[number];

export interface ColorValue {
  hex: string;
  alpha: number;
}

export interface FillStyle {
  color: ColorValue;
}

export interface StrokeStyle {
  color: ColorValue;
  width: number;
}

export interface ShadowStyle {
  blur: number;
  color: ColorValue;
  offsetX: number;
  offsetY: number;
}

export interface TypographyStyle {
  color: ColorValue;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  textAlign: "left" | "center" | "right" | "justify";
}

export interface SceneGraphNodeBase {
  id: string;
  type: SceneGraphNodeType;
  pageId: string;
  parentId: string | null;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  zIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface FrameNode extends SceneGraphNodeBase {
  type: "frame";
  background: FillStyle | null;
  stroke: StrokeStyle | null;
  cornerRadius: number;
  clipsContent: boolean;
  childIds: string[];
}

export interface GroupNode extends SceneGraphNodeBase {
  type: "group";
  childIds: string[];
}

export interface RectangleNode extends SceneGraphNodeBase {
  type: "rectangle";
  fill: FillStyle | null;
  stroke: StrokeStyle | null;
  cornerRadius: number;
  shadow: ShadowStyle | null;
}

export interface EllipseNode extends SceneGraphNodeBase {
  type: "ellipse";
  fill: FillStyle | null;
  stroke: StrokeStyle | null;
  shadow: ShadowStyle | null;
}

export interface LineNode extends SceneGraphNodeBase {
  type: "line";
  stroke: StrokeStyle;
  x2: number;
  y2: number;
}

export interface TextNode extends SceneGraphNodeBase {
  type: "text";
  content: string;
  typography: TypographyStyle;
}

export interface ImageNode extends SceneGraphNodeBase {
  type: "image";
  assetId: string;
  fitMode: "fill" | "contain" | "cover";
}

export type SceneGraphNode =
  | FrameNode
  | GroupNode
  | RectangleNode
  | EllipseNode
  | LineNode
  | TextNode
  | ImageNode;

export interface PageDocumentDto {
  pageId: string;
  rootNodeIds: string[];
  nodes: Record<string, SceneGraphNode>;
}

export const editorCommandTypes = [
  "create-node",
  "update-node",
  "delete-node",
  "move-node",
  "resize-node",
  "reorder-node",
  "group-nodes",
  "ungroup-node",
  "set-selection"
] as const;

export type EditorCommandType = (typeof editorCommandTypes)[number];

export interface CreateNodeCommand {
  type: "create-node";
  pageId: string;
  node: SceneGraphNode;
  parentId: string | null;
  index: number | null;
}

export interface UpdateNodeCommand {
  type: "update-node";
  pageId: string;
  nodeId: string;
  patch: Partial<SceneGraphNode>;
}

export interface DeleteNodeCommand {
  type: "delete-node";
  pageId: string;
  nodeId: string;
}

export interface MoveNodeCommand {
  type: "move-node";
  pageId: string;
  nodeId: string;
  x: number;
  y: number;
}

export interface ResizeNodeCommand {
  type: "resize-node";
  pageId: string;
  nodeId: string;
  width: number;
  height: number;
}

export interface ReorderNodeCommand {
  type: "reorder-node";
  pageId: string;
  nodeId: string;
  parentId: string | null;
  index: number;
}

export interface GroupNodesCommand {
  type: "group-nodes";
  pageId: string;
  nodeIds: string[];
  group: GroupNode;
}

export interface UngroupNodeCommand {
  type: "ungroup-node";
  pageId: string;
  nodeId: string;
}

export interface SetSelectionCommand {
  type: "set-selection";
  pageId: string;
  selection: SelectionPayload;
}

export type EditorCommand =
  | CreateNodeCommand
  | UpdateNodeCommand
  | DeleteNodeCommand
  | MoveNodeCommand
  | ResizeNodeCommand
  | ReorderNodeCommand
  | GroupNodesCommand
  | UngroupNodeCommand
  | SetSelectionCommand;

export interface SelectionPayload {
  pageId: string;
  nodeIds: string[];
}

export interface PresenceCursor {
  x: number;
  y: number;
}

export const presenceStatuses = [
  "active",
  "idle",
  "offline"
] as const;

export type PresenceStatus = (typeof presenceStatuses)[number];

export interface PresenceParticipant {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  color: string;
}

export interface PresencePayload {
  pageId: string;
  participant: PresenceParticipant;
  status: PresenceStatus;
  cursor: PresenceCursor | null;
  selection: SelectionPayload | null;
  updatedAt: string;
}

export interface AuthenticatedSession {
  id: string;
  expiresAt: string;
}

export interface AuthContext {
  session: AuthenticatedSession;
  user: AuthenticatedUser;
  memberships: WorkspaceMembershipSummary[];
}

export interface ServiceCheck {
  ok: boolean;
  summary: string;
}

export interface ErrorReportingConfig {
  dsn: string | undefined;
  enabled: boolean;
  environment: RuntimeEnvironment;
  release: string;
}

export interface ApplicationVersionInfo {
  release: string;
  schemaVersion: string;
}

export const storageProviderKinds = [
  "minio",
  "s3-compatible",
  "local"
] as const;

export type StorageProviderKind = (typeof storageProviderKinds)[number];

export interface StorageObjectDescriptor {
  key: string;
  size: number;
  etag?: string;
  lastModified?: string;
}

export interface StoragePutInput {
  body: Uint8Array;
  contentType?: string;
  key: string;
}

export interface StorageDeleteResult {
  key: string;
}

export interface StorageHealthStatus {
  bucket: string;
  ok: boolean;
  provider: StorageProviderKind;
  summary: string;
}

export interface StorageCommonConfig {
  bucket: string;
  provider: StorageProviderKind;
}

export interface S3StorageConfig extends StorageCommonConfig {
  accessKeyId: string;
  endpoint: string;
  provider: "minio" | "s3-compatible";
  publicBaseUrl?: string;
  region: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface LocalStorageConfig extends StorageCommonConfig {
  provider: "local";
  rootDirectory: string;
}

export type StorageConfig = S3StorageConfig | LocalStorageConfig;
export interface HealthStatus {
  service: ServiceName;
  ok: boolean;
  environment: RuntimeEnvironment;
  timestamp: string;
  details: Record<string, string>;
  checks?: Record<string, ServiceCheck>;
}

export interface ReadyStatus extends HealthStatus {
  ready: boolean;
}

export interface WorkerHeartbeat {
  service: "worker";
  environment: RuntimeEnvironment;
  ok: boolean;
  heartbeatIntervalMs: number;
  uptimeSeconds: number;
  timestamp: string;
}

export interface WebRuntimeSnapshot {
  environment: RuntimeEnvironment;
  urls: RuntimeUrls;
}
