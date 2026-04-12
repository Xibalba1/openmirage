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
