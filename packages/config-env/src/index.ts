import {
  type RuntimeEnvironment,
  runtimeEnvironments,
  type RuntimeUrls,
  type ServiceName
} from "@openmirage/types";

export type ServiceEnvName = Exclude<ServiceName, "web"> | "web";
export type StorageProvider = "minio" | "s3-compatible" | "local";

export interface BaseServiceEnv {
  service: ServiceEnvName;
  environment: RuntimeEnvironment;
  host: string;
  logLevel: "debug" | "info";
  sessionCookieName: string;
}

export interface ApiEnv extends BaseServiceEnv {
  service: "api";
  port: number;
  authPath: string;
  databaseUrl: string;
  storageProvider: StorageProvider;
}

export interface CollabEnv extends BaseServiceEnv {
  service: "collab";
  port: number;
  apiBaseUrl: string;
  wsPath: string;
}

export interface WorkerEnv extends BaseServiceEnv {
  service: "worker";
  port: number;
  databaseUrl: string;
  storageProvider: StorageProvider;
  heartbeatIntervalMs: number;
}

export interface WebEnv {
  service: "web";
  environment: RuntimeEnvironment;
  port: number;
  urls: RuntimeUrls;
}

export interface EnvSource {
  [key: string]: string | undefined;
}

function readRequiredString(
  source: EnvSource,
  key: string,
  fallback?: string
): string {
  const value = source[key] ?? fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function readNumber(source: EnvSource, key: string, fallback: number): number {
  const rawValue = source[key];

  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${key} must be a finite number`);
  }

  return value;
}

function readRuntimeEnvironment(source: EnvSource): RuntimeEnvironment {
  const value = source.OPENMIRAGE_ENV ?? "development";

  if (runtimeEnvironments.includes(value as RuntimeEnvironment)) {
    return value as RuntimeEnvironment;
  }

  throw new Error(
    `Environment variable OPENMIRAGE_ENV must be one of ${runtimeEnvironments.join(", ")}`
  );
}

function readLogLevel(source: EnvSource): "debug" | "info" {
  const value = source.LOG_LEVEL ?? "info";

  if (value === "debug" || value === "info") {
    return value;
  }

  throw new Error("Environment variable LOG_LEVEL must be debug or info");
}

function readStorageProvider(source: EnvSource): StorageProvider {
  const value = source.STORAGE_PROVIDER ?? "minio";

  if (
    value === "minio" ||
    value === "s3-compatible" ||
    value === "local"
  ) {
    return value;
  }

  throw new Error(
    "Environment variable STORAGE_PROVIDER must be minio, s3-compatible, or local"
  );
}

function readUrlPath(source: EnvSource, key: string, fallback: string): string {
  const value = source[key] ?? fallback;

  if (!value.startsWith("/")) {
    throw new Error(`Environment variable ${key} must start with /`);
  }

  return value;
}

function readBaseServiceEnv(
  service: ServiceEnvName,
  source: EnvSource
): BaseServiceEnv {
  return {
    service,
    environment: readRuntimeEnvironment(source),
    host: source.SERVICE_HOST ?? "0.0.0.0",
    logLevel: readLogLevel(source),
    sessionCookieName: source.SESSION_COOKIE_NAME ?? "openmirage_session"
  };
}

export function readApiEnv(source: EnvSource = process.env): ApiEnv {
  return {
    ...readBaseServiceEnv("api", source),
    service: "api",
    port: readNumber(source, "API_PORT", 4000),
    authPath: readUrlPath(source, "AUTH_PATH", "/auth"),
    databaseUrl: readRequiredString(
      source,
      "DATABASE_URL",
      "postgres://openmirage:openmirage@localhost:5432/openmirage"
    ),
    storageProvider: readStorageProvider(source)
  };
}

export function readCollabEnv(source: EnvSource = process.env): CollabEnv {
  return {
    ...readBaseServiceEnv("collab", source),
    service: "collab",
    port: readNumber(source, "COLLAB_PORT", 4100),
    apiBaseUrl: readRequiredString(
      source,
      "API_BASE_URL",
      "http://localhost:4000"
    ),
    wsPath: readUrlPath(source, "COLLAB_WS_PATH", "/collab")
  };
}

export function readWorkerEnv(source: EnvSource = process.env): WorkerEnv {
  return {
    ...readBaseServiceEnv("worker", source),
    service: "worker",
    port: readNumber(source, "WORKER_PORT", 4200),
    databaseUrl: readRequiredString(
      source,
      "DATABASE_URL",
      "postgres://openmirage:openmirage@localhost:5432/openmirage"
    ),
    storageProvider: readStorageProvider(source),
    heartbeatIntervalMs: readNumber(source, "WORKER_HEARTBEAT_INTERVAL_MS", 5000)
  };
}

export function readWebEnv(source: EnvSource): WebEnv {
  const environment = readRuntimeEnvironment(source);

  return {
    service: "web",
    environment,
    port: readNumber(source, "WEB_PORT", 3000),
    urls: {
      apiBaseUrl: readRequiredString(
        source,
        "VITE_API_BASE_URL",
        "http://localhost:4000"
      ),
      collabHttpUrl: readRequiredString(
        source,
        "VITE_COLLAB_HTTP_URL",
        "http://localhost:4100"
      ),
      collabWsUrl: readRequiredString(
        source,
        "VITE_COLLAB_WS_URL",
        "ws://localhost:4100/collab"
      ),
      collabWsPath: readUrlPath(source, "VITE_COLLAB_WS_PATH", "/collab"),
      authPath: readUrlPath(source, "VITE_AUTH_PATH", "/auth")
    }
  };
}

export function readServiceEnv(
  service: ServiceEnvName,
  source: EnvSource = process.env
): ApiEnv | CollabEnv | WorkerEnv | WebEnv {
  switch (service) {
    case "api":
      return readApiEnv(source);
    case "collab":
      return readCollabEnv(source);
    case "worker":
      return readWorkerEnv(source);
    case "web":
      return readWebEnv(source);
  }
}
