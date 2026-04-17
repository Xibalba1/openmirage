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

export const editorAccessModes = ["writable", "read-only"] as const;

export type EditorAccessMode = (typeof editorAccessModes)[number];

export const editorAccessSources = ["membership", "share-link"] as const;

export type EditorAccessSource = (typeof editorAccessSources)[number];

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

export const assetScopes = ["file", "workspace"] as const;

export type AssetScope = (typeof assetScopes)[number];

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

export interface WorkspaceDetailDto extends WorkspaceDto {
  membershipId: string;
  role: MembershipRole;
}

export interface EditorAccessDto {
  canComment: boolean;
  canManageShareLinks: boolean;
  canMutate: boolean;
  mode: EditorAccessMode;
  role: MembershipRole | null;
  source: EditorAccessSource;
}

export function canWriteMembershipRole(
  role: MembershipRole | null | undefined
): role is Exclude<MembershipRole, "viewer"> {
  return role === "owner" || role === "editor";
}

export function createEditorAccess(input: {
  role: MembershipRole | null;
  source: EditorAccessSource;
}): EditorAccessDto {
  const canMutate = input.source === "membership" && canWriteMembershipRole(input.role);

  return {
    canComment: canMutate,
    canManageShareLinks: canMutate,
    canMutate,
    mode: canMutate ? "writable" : "read-only",
    role: input.role,
    source: input.source
  };
}

export interface ProjectListResponse {
  projects: ProjectDto[];
  workspace: WorkspaceDetailDto;
}

export interface FileListResponse {
  files: FileDto[];
  project: ProjectDto;
  workspace: WorkspaceDetailDto;
}

export interface PageListResponse {
  file: FileDto;
  pages: PageDto[];
  project: ProjectDto;
  workspace: WorkspaceDetailDto;
}

export interface CreateProjectInput {
  name: string;
}

export interface RenameProjectInput {
  name: string;
}

export interface CreateFilePageInput {
  name: string;
}

export interface CreateFileInput {
  initialPages: CreateFilePageInput[];
  name: string;
}

export interface RenameFileInput {
  name: string;
}

export interface CreatePageInput {
  name: string;
}

export interface RenamePageInput {
  name: string;
}

export interface FileOpenResponse {
  access: EditorAccessDto;
  defaultPageId: string | null;
  file: FileDto;
  pages: PageDto[];
  project: ProjectDto;
  workspace: WorkspaceDetailDto;
}

export interface CollabPageSessionDto {
  access: EditorAccessDto;
  documentName: string;
  fileId: string;
  pageId: string;
  user: AuthenticatedUser;
  workspaceId: string;
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

export interface AssetRecordDto extends AssetDto {
  contentUrl: string;
}

export interface CreateAssetInput {
  byteSize: number;
  filename: string;
  height?: number | null;
  id?: string;
  kind: AssetKind;
  mimeType: string;
  scope: AssetScope;
  storageKey: string;
  width?: number | null;
}

export interface ListAssetsInput {
  fileId: string;
  includeWorkspaceAssets?: boolean;
}

export interface ListAssetsResponse {
  assets: AssetRecordDto[];
}

export interface CommentDto {
  id: string;
  fileId: string;
  pageId: string | null;
  nodeId: string | null;
  authorUserId: string;
  author: CommentAuthorSummary;
  body: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  deletedAt: string | null;
}

export interface CommentAuthorSummary {
  avatarUrl: string | null;
  displayName: string;
  id: string;
}

export type CommentTarget =
  | {
      fileId: string;
      type: "file";
    }
  | {
      fileId: string;
      pageId: string;
      type: "page";
    }
  | {
      fileId: string;
      nodeId: string;
      pageId: string;
      type: "node";
    };

export interface CreateCommentInput {
  body: string;
  target: CommentTarget;
}

export interface ListCommentsInput {
  fileId: string;
  includeResolved?: boolean;
  pageId?: string;
}

export interface ResolveCommentInput {
  commentId: string;
  fileId: string;
}

export interface CommentListResponse {
  comments: CommentDto[];
}

export interface ShareLinkDto {
  id: string;
  fileId: string;
  createdByUserId: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface ShareLinkRecordDto extends ShareLinkDto {
  shareUrl: string | null;
}

export interface CreateShareLinkInput {
  expiresAt?: string | null;
}

export interface ShareLinkListResponse {
  shareLinks: ShareLinkRecordDto[];
}

export interface CreatedShareLinkResponse {
  shareLink: ShareLinkRecordDto;
  token: string;
}

export interface PublicShareLinkDto {
  fileId: string;
  id: string;
}

export interface SharedFileOpenResponse {
  access: EditorAccessDto;
  defaultPageId: string | null;
  file: FileDto;
  pages: PageDto[];
  project: ProjectDto;
  shareLink: PublicShareLinkDto;
  workspace: WorkspaceDto;
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
  "ungroup-node"
] as const;

export type EditorCommandType = (typeof editorCommandTypes)[number];

export interface NodeGeometryUpdate {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  x2?: number | null;
  y2?: number | null;
}

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
  nodeIds: string[];
}

export interface MoveNodeCommand {
  type: "move-node";
  pageId: string;
  updates: NodeGeometryUpdate[];
}

export interface ResizeNodeCommand {
  type: "resize-node";
  pageId: string;
  nodeId: string;
  updates: NodeGeometryUpdate[];
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
  index: number | null;
}

export interface UngroupNodeCommand {
  type: "ungroup-node";
  pageId: string;
  nodeId: string;
}

export type EditorCommand =
  | CreateNodeCommand
  | UpdateNodeCommand
  | DeleteNodeCommand
  | MoveNodeCommand
  | ResizeNodeCommand
  | ReorderNodeCommand
  | GroupNodesCommand
  | UngroupNodeCommand;

export interface SelectionPayload {
  pageId: string;
  nodeIds: string[];
}

export interface PresenceCursor {
  x: number;
  y: number;
}

export const presenceStatuses = ["active", "idle", "offline"] as const;

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

export function createCollabDocumentName(pageId: string): string {
  return `page:${pageId}`;
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

export interface StorageReadResult {
  body: Uint8Array;
  contentType?: string;
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
