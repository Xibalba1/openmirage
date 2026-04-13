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
