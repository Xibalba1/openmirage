import {
  type ErrorReportingConfig,
  type LocalStorageConfig,
  type RuntimeEnvironment,
  runtimeEnvironments,
  type RuntimeUrls,
  type S3StorageConfig,
  type ServiceName,
  type StorageConfig,
  storageProviderKinds,
  type StorageProviderKind
} from "@openmirage/types";

export type ServiceEnvName = Exclude<ServiceName, "web"> | "web";

export interface BaseServiceEnv {
  service: ServiceEnvName;
  environment: RuntimeEnvironment;
  host: string;
  logLevel: "debug" | "info";
  sessionCookieName: string;
  appVersion: string;
  enableTestErrorRoutes: boolean;
  errorReporting: ErrorReportingConfig;
}

export interface ApiEnv extends BaseServiceEnv {
  service: "api";
  appBaseUrl: string;
  authDeliveryMode: "log";
  authMagicLinkTtlMinutes: number;
  authSessionTtlDays: number;
  devAuthExposeMagicLink: boolean;
  smokeTestSharedSecret: string | undefined;
  port: number;
  authPath: string;
  databaseUrl: string;
  sessionCookiePath: string;
  sessionCookieSameSite: "lax" | "strict" | "none";
  sessionCookieSecure: boolean;
  storage: StorageConfig;
}

export interface CollabEnv extends BaseServiceEnv {
  authPath: string;
  databaseUrl: string;
  service: "collab";
  port: number;
  apiBaseUrl: string;
  wsPath: string;
}

export interface WorkerEnv extends BaseServiceEnv {
  service: "worker";
  browserExecutablePath?: string | undefined;
  browserLaunchTimeoutMs: number;
  cleanupIntervalMs: number;
  cleanupRetentionMs: number;
  databaseUrl: string;
  exportConcurrency: number;
  exportPollIntervalMs: number;
  storage: StorageConfig;
  heartbeatIntervalMs: number;
  jobTimeoutMs: number;
  port: number;
  thumbnailPollIntervalMs: number;
}

export interface WebEnv {
  service: "web";
  environment: RuntimeEnvironment;
  appVersion: string;
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

function readPositiveInteger(
  source: EnvSource,
  key: string,
  fallback: number
): number {
  const value = readNumber(source, key, fallback);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${key} must be a positive integer`);
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

function readBoolean(
  source: EnvSource,
  key: string,
  fallback: boolean
): boolean {
  const rawValue = source[key];

  if (rawValue === undefined) {
    return fallback;
  }

  if (rawValue === "true") {
    return true;
  }

  if (rawValue === "false") {
    return false;
  }

  throw new Error(`Environment variable ${key} must be true or false`);
}

function readLogLevel(source: EnvSource): "debug" | "info" {
  const value = source.LOG_LEVEL ?? "info";

  if (value === "debug" || value === "info") {
    return value;
  }

  throw new Error("Environment variable LOG_LEVEL must be debug or info");
}

function readStorageProvider(source: EnvSource): StorageProviderKind {
  const value = source.STORAGE_PROVIDER ?? "minio";

  if (storageProviderKinds.includes(value as StorageProviderKind)) {
    return value as StorageProviderKind;
  }

  throw new Error(
    `Environment variable STORAGE_PROVIDER must be one of ${storageProviderKinds.join(", ")}`
  );
}

function readUrlPath(source: EnvSource, key: string, fallback: string): string {
  const value = source[key] ?? fallback;

  if (!value.startsWith("/")) {
    throw new Error(`Environment variable ${key} must start with /`);
  }

  return value;
}

function readSameSitePolicy(
  source: EnvSource,
  key: string,
  fallback: "lax" | "strict" | "none"
): "lax" | "strict" | "none" {
  const value = source[key] ?? fallback;

  if (value === "lax" || value === "strict" || value === "none") {
    return value;
  }

  throw new Error(
    `Environment variable ${key} must be one of lax, strict, none`
  );
}

function readAppVersion(source: EnvSource): string {
  return source.APP_VERSION ?? "0.1.0";
}

function readErrorReportingConfig(
  source: EnvSource,
  environment: RuntimeEnvironment,
  release: string
): ErrorReportingConfig {
  const dsn = source.SENTRY_DSN;
  const sentryEnvironment = source.SENTRY_ENVIRONMENT;

  if (
    sentryEnvironment !== undefined &&
    !runtimeEnvironments.includes(sentryEnvironment as RuntimeEnvironment)
  ) {
    throw new Error(
      `Environment variable SENTRY_ENVIRONMENT must be one of ${runtimeEnvironments.join(", ")}`
    );
  }

  return {
    dsn,
    enabled:
      Boolean(dsn) &&
      (environment === "staging" || environment === "production"),
    environment:
      (sentryEnvironment as RuntimeEnvironment | undefined) ?? environment,
    release: source.SENTRY_RELEASE ?? release
  };
}

function readBaseServiceEnv(
  service: ServiceEnvName,
  source: EnvSource
): BaseServiceEnv {
  const environment = readRuntimeEnvironment(source);
  const appVersion = readAppVersion(source);

  return {
    service,
    environment,
    host: source.SERVICE_HOST ?? "0.0.0.0",
    logLevel: readLogLevel(source),
    sessionCookieName: source.SESSION_COOKIE_NAME ?? "openmirage_session",
    appVersion,
    enableTestErrorRoutes: readBoolean(
      source,
      "ENABLE_TEST_ERROR_ROUTES",
      false
    ),
    errorReporting: readErrorReportingConfig(source, environment, appVersion)
  };
}

export function readStorageConfig(
  source: EnvSource = process.env
): StorageConfig {
  const provider = readStorageProvider(source);
  const bucket = readRequiredString(
    source,
    "STORAGE_BUCKET",
    "openmirage-assets"
  );

  if (provider === "local") {
    const localConfig: LocalStorageConfig = {
      provider,
      bucket,
      rootDirectory: readRequiredString(
        source,
        "STORAGE_LOCAL_ROOT",
        ".openmirage/storage"
      )
    };

    return localConfig;
  }

  const s3Config: S3StorageConfig = {
    provider,
    bucket,
    endpoint: readRequiredString(
      source,
      "STORAGE_S3_ENDPOINT",
      "http://127.0.0.1:9000"
    ),
    region: readRequiredString(source, "STORAGE_S3_REGION", "us-east-1"),
    accessKeyId: readRequiredString(
      source,
      "STORAGE_S3_ACCESS_KEY_ID",
      "openmirage"
    ),
    secretAccessKey: readRequiredString(
      source,
      "STORAGE_S3_SECRET_ACCESS_KEY",
      "openmirage123"
    ),
    forcePathStyle: readBoolean(source, "STORAGE_S3_FORCE_PATH_STYLE", true),
    ...(source.STORAGE_PUBLIC_BASE_URL
      ? { publicBaseUrl: source.STORAGE_PUBLIC_BASE_URL }
      : {})
  };

  return s3Config;
}

export function readApiEnv(source: EnvSource = process.env): ApiEnv {
  const environment = readRuntimeEnvironment(source);

  return {
    ...readBaseServiceEnv("api", source),
    service: "api",
    appBaseUrl: readRequiredString(
      source,
      "APP_BASE_URL",
      "http://localhost:3000"
    ),
    authDeliveryMode: "log",
    authMagicLinkTtlMinutes: readPositiveInteger(
      source,
      "AUTH_MAGIC_LINK_TTL_MINUTES",
      15
    ),
    authSessionTtlDays: readPositiveInteger(
      source,
      "AUTH_SESSION_TTL_DAYS",
      30
    ),
    devAuthExposeMagicLink: readBoolean(
      source,
      "DEV_AUTH_EXPOSE_MAGIC_LINK",
      environment !== "production"
    ),
    smokeTestSharedSecret: source.SMOKE_TEST_SHARED_SECRET,
    port: readNumber(source, "API_PORT", 4000),
    authPath: readUrlPath(source, "AUTH_PATH", "/auth"),
    databaseUrl: readRequiredString(
      source,
      "DATABASE_URL",
      "postgres://openmirage:openmirage@localhost:5432/openmirage"
    ),
    sessionCookiePath: readUrlPath(source, "SESSION_COOKIE_PATH", "/"),
    sessionCookieSameSite: readSameSitePolicy(
      source,
      "SESSION_COOKIE_SAME_SITE",
      "lax"
    ),
    sessionCookieSecure: readBoolean(
      source,
      "SESSION_COOKIE_SECURE",
      environment === "staging" || environment === "production"
    ),
    storage: readStorageConfig(source)
  };
}

export function readCollabEnv(source: EnvSource = process.env): CollabEnv {
  return {
    ...readBaseServiceEnv("collab", source),
    authPath: readUrlPath(source, "AUTH_PATH", "/auth"),
    databaseUrl: readRequiredString(
      source,
      "DATABASE_URL",
      "postgres://openmirage:openmirage@localhost:5432/openmirage"
    ),
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
    browserExecutablePath: source.WORKER_BROWSER_EXECUTABLE,
    browserLaunchTimeoutMs: readPositiveInteger(
      source,
      "WORKER_BROWSER_LAUNCH_TIMEOUT_MS",
      15_000
    ),
    cleanupIntervalMs: readPositiveInteger(
      source,
      "WORKER_CLEANUP_INTERVAL_MS",
      60_000
    ),
    cleanupRetentionMs: readPositiveInteger(
      source,
      "WORKER_CLEANUP_RETENTION_MS",
      60 * 60 * 1000
    ),
    port: readNumber(source, "WORKER_PORT", 4200),
    databaseUrl: readRequiredString(
      source,
      "DATABASE_URL",
      "postgres://openmirage:openmirage@localhost:5432/openmirage"
    ),
    exportConcurrency: readPositiveInteger(
      source,
      "WORKER_EXPORT_CONCURRENCY",
      1
    ),
    exportPollIntervalMs: readPositiveInteger(
      source,
      "WORKER_EXPORT_POLL_INTERVAL_MS",
      2_000
    ),
    storage: readStorageConfig(source),
    heartbeatIntervalMs: readNumber(
      source,
      "WORKER_HEARTBEAT_INTERVAL_MS",
      5000
    ),
    jobTimeoutMs: readPositiveInteger(
      source,
      "WORKER_JOB_TIMEOUT_MS",
      120_000
    ),
    thumbnailPollIntervalMs: readPositiveInteger(
      source,
      "WORKER_THUMBNAIL_POLL_INTERVAL_MS",
      30_000
    )
  };
}

export function readWebEnv(source: EnvSource): WebEnv {
  const environment = readRuntimeEnvironment(source);

  return {
    service: "web",
    environment,
    appVersion: readAppVersion(source),
    port: readNumber(source, "WEB_PORT", 3000),
    urls: {
      apiBaseUrl: readRequiredString(
        source,
        "VITE_API_BASE_URL",
        "http://localhost"
      ),
      collabHttpUrl: readRequiredString(
        source,
        "VITE_COLLAB_HTTP_URL",
        "http://localhost/collab"
      ),
      collabWsUrl: readRequiredString(
        source,
        "VITE_COLLAB_WS_URL",
        "ws://localhost/collab"
      ),
      collabWsPath: readUrlPath(source, "VITE_COLLAB_WS_PATH", "/collab"),
      authPath: readUrlPath(source, "VITE_AUTH_PATH", "/auth"),
      workerHttpUrl: readRequiredString(
        source,
        "VITE_WORKER_HTTP_URL",
        "http://localhost/worker"
      )
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
