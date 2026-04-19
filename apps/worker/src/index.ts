import { readWorkerEnv } from "@openmirage/config-env";
import {
  PgCollabPersistence,
  checkDatabaseConnection,
  checkMetadataStore,
  claimNextQueuedExportJob,
  createDatabasePool,
  createDerivedAssetRecord,
  createMetadataStoreContract,
  failStaleRunningExportJobs,
  findNextFileMissingThumbnail,
  findNextPageMissingThumbnail,
  getApplicationVersionInfo,
  listDeletedThumbnailAssetsForCleanup,
  listPagesForFileId,
  listRenderableAssetsForFile,
  markAssetDeleted,
  markExportJobFailed,
  markExportJobSucceeded,
  replaceFileThumbnailAsset,
  replacePageThumbnailAsset,
  hardDeleteAssetRecord
} from "@openmirage/db";
import {
  createErrorLogFields,
  createHttpMetrics,
  createMetricsRegistry,
  createRequestId,
  createServiceLogger,
  initErrorReporter,
  registerProcessErrorHandlers,
  registerServiceInfoMetrics,
  summarizeChecks
} from "@openmirage/observability";
import { createStorage, type StorageAdapter } from "@openmirage/storage";
import {
  hydratePageDocument,
  type AssetDto,
  type PageDocumentDto,
  type PageDto,
  type ServiceCheck,
  type StorageConfig,
  type WorkerHeartbeat
} from "@openmirage/types";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { renderSceneToPng, renderScenesToPdf, resolveBrowserExecutable } from "./render.js";

interface YDocLike {
  getMap(name: string): {
    toJSON(): unknown;
  };
}

function buildHeartbeat(uptimeSeconds: number): WorkerHeartbeat {
  const env = readWorkerEnv();

  return {
    service: "worker",
    environment: env.environment,
    ok: true,
    heartbeatIntervalMs: env.heartbeatIntervalMs,
    uptimeSeconds,
    timestamp: new Date().toISOString()
  };
}

function describeConfiguredStorage(storageConfig: StorageConfig): ServiceCheck {
  return {
    ok: true,
    summary: `configured for ${storageConfig.provider} storage bucket ${storageConfig.bucket}`
  };
}

async function inspectStorage(
  storage: StorageAdapter,
  storageConfig: StorageConfig
): Promise<ServiceCheck> {
  try {
    await storage.ensureBucket();
    const storageHealth = await storage.healthCheck();

    return {
      ok: storageHealth.ok,
      summary: storageHealth.summary
    };
  } catch (error) {
    return {
      ok: false,
      summary: `storage ${storageConfig.provider} bootstrap failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }
}

function readPageDocument(doc: YDocLike, pageId: string): PageDocumentDto {
  const pageMap = doc.getMap("page");
  const raw = pageMap.toJSON() as Partial<PageDocumentDto>;

  return {
    nodes:
      typeof raw.nodes === "object" && raw.nodes
        ? (raw.nodes as PageDocumentDto["nodes"])
        : {},
    pageId,
    rootNodeIds: Array.isArray(raw.rootNodeIds)
      ? raw.rootNodeIds.filter(
          (value): value is string => typeof value === "string"
        )
      : []
  };
}

function sanitizeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "artifact"
  );
}

function toBase64DataUrl(mimeType: string, body: Uint8Array): string {
  return `data:${mimeType};base64,${Buffer.from(body).toString("base64")}`;
}

function buildExportStorageKey(input: {
  fileId: string;
  filename: string;
  jobId: string;
  workspaceId: string;
}): string {
  return `workspaces/${input.workspaceId}/files/${input.fileId}/exports/${input.jobId}/${sanitizeFilename(input.filename)}`;
}

function buildThumbnailStorageKey(input: {
  fileId: string;
  filename: string;
  scope: "file" | "page";
  pageId?: string;
  workspaceId: string;
}): string {
  if (input.scope === "page") {
    return `workspaces/${input.workspaceId}/files/${input.fileId}/thumbnails/pages/${input.pageId}/${sanitizeFilename(input.filename)}`;
  }

  return `workspaces/${input.workspaceId}/files/${input.fileId}/thumbnails/files/${sanitizeFilename(input.filename)}`;
}

function getPngFilename(fileName: string, pageName: string): string {
  return `${sanitizeFilename(fileName)}-${sanitizeFilename(pageName)}.png`;
}

function getPdfFilename(fileName: string): string {
  return `${sanitizeFilename(fileName)}.pdf`;
}

function computeThumbnailScale(width: number, height: number): number {
  return Math.min(1, 320 / Math.max(width, height, 1));
}

async function buildSceneAssetMap(input: {
  assets: AssetDto[];
  fileId: string;
  page: PageDto;
  persistence: PgCollabPersistence;
  storage: StorageAdapter;
}): Promise<{
  scene: ReturnType<typeof hydratePageDocument>;
  sources: Record<string, string>;
}> {
  const loaded = await input.persistence.loadPageDocument(input.page.id);
  const document = readPageDocument(loaded.document, input.page.id);
  const scene = hydratePageDocument(input.page, document);
  const referencedAssetIds = [
    ...new Set(
      Object.values(scene.document.nodes)
        .filter(
          (
            node
          ): node is Extract<(typeof scene.document.nodes)[string], { type: "image" }> =>
            node.type === "image"
        )
        .map((node) => node.assetId)
    )
  ];
  const assetsById = new Map(input.assets.map((asset) => [asset.id, asset] as const));
  const sources: Record<string, string> = {};

  for (const assetId of referencedAssetIds) {
    const asset = assetsById.get(assetId);

    if (!asset) {
      continue;
    }

    const stored = await input.storage.read(asset.storageKey);
    sources[assetId] = toBase64DataUrl(
      asset.mimeType || stored.contentType || "application/octet-stream",
      stored.body
    );
  }

  return {
    scene,
    sources
  };
}

async function createThumbnailAsset(input: {
  browserPath: string;
  file: {
    createdByUserId: string;
    id: string;
    name: string;
    workspaceId: string;
  };
  purpose: "file" | "page";
  page: PageDto;
  persistence: PgCollabPersistence;
  storage: StorageAdapter;
  timeoutMs: number;
}): Promise<AssetDto> {
  const assets = await listRenderableAssetsForFile(input.file.id);
  const rendered = await buildSceneAssetMap({
    assets,
    fileId: input.file.id,
    page: input.page,
    persistence: input.persistence,
    storage: input.storage
  });
  const scale = computeThumbnailScale(rendered.scene.width, rendered.scene.height);
  const body = await renderSceneToPng({
    browserPath: input.browserPath,
    height: rendered.scene.height,
    images: rendered.sources,
    scale,
    scene: rendered.scene,
    timeoutMs: input.timeoutMs,
    width: rendered.scene.width
  });
  const width = Math.max(1, Math.round(rendered.scene.width * scale));
  const height = Math.max(1, Math.round(rendered.scene.height * scale));
  const filename =
    input.purpose === "page"
      ? `${sanitizeFilename(input.file.name)}-${sanitizeFilename(input.page.name)}-thumbnail.png`
      : `${sanitizeFilename(input.file.name)}-file-thumbnail.png`;
  const storageKey = buildThumbnailStorageKey(
    input.purpose === "page"
      ? {
          fileId: input.file.id,
          filename,
          pageId: input.page.id,
          scope: "page",
          workspaceId: input.file.workspaceId
        }
      : {
          fileId: input.file.id,
          filename,
          scope: "file",
          workspaceId: input.file.workspaceId
        }
  );

  await input.storage.put({
    body,
    contentType: "image/png",
    key: storageKey
  });

  return createDerivedAssetRecord({
    byteSize: body.byteLength,
    fileId: input.file.id,
    filename,
    height,
    kind: "thumbnail",
    mimeType: "image/png",
    storageKey,
    uploadedByUserId: input.file.createdByUserId,
    width,
    workspaceId: input.file.workspaceId
  });
}

async function reconcilePageThumbnail(input: {
  browserPath: string;
  candidate: {
    file: {
      createdByUserId: string;
      id: string;
      name: string;
      workspaceId: string;
    };
    page: PageDto;
  };
  persistence: PgCollabPersistence;
  storage: StorageAdapter;
  timeoutMs: number;
}): Promise<void> {
  const asset = await createThumbnailAsset({
    browserPath: input.browserPath,
    file: input.candidate.file,
    page: input.candidate.page,
    purpose: "page",
    persistence: input.persistence,
    storage: input.storage,
    timeoutMs: input.timeoutMs
  });
  const previousAssetId = await replacePageThumbnailAsset(
    input.candidate.page.id,
    asset.id
  );

  if (previousAssetId) {
    await markAssetDeleted(previousAssetId);
  }
}

async function reconcileFileThumbnail(input: {
  browserPath: string;
  candidate: {
    coverPage: PageDto;
    file: {
      createdByUserId: string;
      id: string;
      name: string;
      workspaceId: string;
    };
  };
  persistence: PgCollabPersistence;
  storage: StorageAdapter;
  timeoutMs: number;
}): Promise<void> {
  const asset = await createThumbnailAsset({
    browserPath: input.browserPath,
    file: input.candidate.file,
    page: input.candidate.coverPage,
    purpose: "file",
    persistence: input.persistence,
    storage: input.storage,
    timeoutMs: input.timeoutMs
  });
  const previousAssetId = await replaceFileThumbnailAsset(
    input.candidate.file.id,
    asset.id
  );

  if (previousAssetId) {
    await markAssetDeleted(previousAssetId);
  }
}

async function processExportJob(input: {
  browserPath: string;
  persistence: PgCollabPersistence;
  storage: StorageAdapter;
  timeoutMs: number;
}): Promise<boolean> {
  const claimed = await claimNextQueuedExportJob();

  if (!claimed) {
    return false;
  }

  try {
    const pages = await listPagesForFileId(claimed.file.id);
    const assets = await listRenderableAssetsForFile(claimed.file.id);

    if (claimed.job.format === "png") {
      const page = pages.find((candidate) => candidate.id === claimed.job.pageId);

      if (!page) {
        throw new Error("export page not found");
      }

      const rendered = await buildSceneAssetMap({
        assets,
        fileId: claimed.file.id,
        page,
        persistence: input.persistence,
        storage: input.storage
      });
      const body = await renderSceneToPng({
        browserPath: input.browserPath,
        height: rendered.scene.height,
        images: rendered.sources,
        scene: rendered.scene,
        timeoutMs: input.timeoutMs,
        width: rendered.scene.width
      });
      const filename = getPngFilename(claimed.file.name, page.name);
      const storageKey = buildExportStorageKey({
        fileId: claimed.file.id,
        filename,
        jobId: claimed.job.id,
        workspaceId: claimed.workspaceId
      });

      await input.storage.put({
        body,
        contentType: "image/png",
        key: storageKey
      });
      const outputAsset = await createDerivedAssetRecord({
        byteSize: body.byteLength,
        fileId: claimed.file.id,
        filename,
        height: rendered.scene.height,
        kind: "export",
        mimeType: "image/png",
        storageKey,
        uploadedByUserId: claimed.job.requestedByUserId,
        width: rendered.scene.width,
        workspaceId: claimed.workspaceId
      });

      await markExportJobSucceeded(claimed.job.id, outputAsset.id);
      await reconcilePageThumbnail({
        browserPath: input.browserPath,
        candidate: {
          file: claimed.file,
          page
        },
        persistence: input.persistence,
        storage: input.storage,
        timeoutMs: input.timeoutMs
      });
      await reconcileFileThumbnail({
        browserPath: input.browserPath,
        candidate: {
          coverPage: pages[0] ?? page,
          file: claimed.file
        },
        persistence: input.persistence,
        storage: input.storage,
        timeoutMs: input.timeoutMs
      });
    } else {
      if (pages.length === 0) {
        throw new Error("file has no pages to export");
      }

      const scenes = await Promise.all(
        pages.map(async (page) => {
          const rendered = await buildSceneAssetMap({
            assets,
            fileId: claimed.file.id,
            page,
            persistence: input.persistence,
            storage: input.storage
          });

          return {
            images: rendered.sources,
            scene: rendered.scene
          };
        })
      );
      const body = await renderScenesToPdf({
        browserPath: input.browserPath,
        imagesByPage: Object.fromEntries(
          scenes.map((rendered) => [rendered.scene.page.id, rendered.images] as const)
        ),
        scenes: scenes.map((rendered) => rendered.scene),
        timeoutMs: input.timeoutMs
      });
      const filename = getPdfFilename(claimed.file.name);
      const storageKey = buildExportStorageKey({
        fileId: claimed.file.id,
        filename,
        jobId: claimed.job.id,
        workspaceId: claimed.workspaceId
      });

      await input.storage.put({
        body,
        contentType: "application/pdf",
        key: storageKey
      });
      const outputAsset = await createDerivedAssetRecord({
        byteSize: body.byteLength,
        fileId: claimed.file.id,
        filename,
        kind: "export",
        mimeType: "application/pdf",
        storageKey,
        uploadedByUserId: claimed.job.requestedByUserId,
        workspaceId: claimed.workspaceId
      });

      await markExportJobSucceeded(claimed.job.id, outputAsset.id);
      await reconcilePageThumbnail({
        browserPath: input.browserPath,
        candidate: {
          file: claimed.file,
          page: pages[0] as PageDto
        },
        persistence: input.persistence,
        storage: input.storage,
        timeoutMs: input.timeoutMs
      });
      await reconcileFileThumbnail({
        browserPath: input.browserPath,
        candidate: {
          coverPage: pages[0] as PageDto,
          file: claimed.file
        },
        persistence: input.persistence,
        storage: input.storage,
        timeoutMs: input.timeoutMs
      });
    }
  } catch (error) {
    await markExportJobFailed(
      claimed.job.id,
      error instanceof Error ? error.message : String(error)
    );
  }

  return true;
}

async function cleanupDeletedThumbnails(input: {
  retentionMs: number;
  storage: StorageAdapter;
}): Promise<number> {
  const deletedAssets = await listDeletedThumbnailAssetsForCleanup(
    new Date(Date.now() - input.retentionMs),
    20
  );

  for (const asset of deletedAssets) {
    await input.storage.delete(asset.storageKey).catch(() => undefined);
    await hardDeleteAssetRecord(asset.id);
  }

  return deletedAssets.length;
}

async function startWorker(): Promise<void> {
  const env = readWorkerEnv();
  const logger = createServiceLogger({
    service: "worker",
    environment: env.environment,
    version: env.appVersion,
    level: env.logLevel
  });
  const reporter = initErrorReporter(env.errorReporting, logger);
  const metadataStore = createMetadataStoreContract();
  const storage = createStorage(env.storage);
  const browserPath = await resolveBrowserExecutable(env.browserExecutablePath);

  const startedAt = Date.now();
  const bootId = randomUUID();
  const registry = createMetricsRegistry();
  const httpMetrics = createHttpMetrics(registry, "worker");
  const serviceHealth = registry.gauge({
    name: "openmirage_service_health",
    help: "Current health state for the service",
    labelNames: ["service"],
    type: "gauge"
  });
  const serviceReady = registry.gauge({
    name: "openmirage_service_ready",
    help: "Current readiness state for the service",
    labelNames: ["service"],
    type: "gauge"
  });
  const heartbeatUnixtime = registry.gauge({
    name: "openmirage_worker_heartbeat_unixtime",
    help: "Unix timestamp for the latest worker heartbeat",
    labelNames: ["service"],
    type: "gauge"
  });
  const uptimeSeconds = registry.gauge({
    name: "openmirage_worker_uptime_seconds",
    help: "Worker process uptime in seconds",
    labelNames: ["service"],
    type: "gauge"
  });
  const jobsTotal = registry.counter({
    name: "openmirage_worker_jobs_total",
    help: "Total worker jobs observed",
    labelNames: ["service", "job_type", "job_state"],
    type: "counter"
  });
  const jobsInProgress = registry.gauge({
    name: "openmirage_worker_jobs_in_progress",
    help: "Current worker jobs in progress",
    labelNames: ["service", "job_type"],
    type: "gauge"
  });

  const databasePool = createDatabasePool(env.databaseUrl);
  const persistence = new PgCollabPersistence(databasePool);
  const activeJobs = {
    cleanup: 0,
    export: 0,
    thumbnail: 0
  };

  function setJobInProgress(jobType: keyof typeof activeJobs, value: number): void {
    activeJobs[jobType] = value;
    jobsInProgress.set(
      {
        job_type: jobType,
        service: "worker"
      },
      value
    );
  }

  function recordJobState(
    jobType: keyof typeof activeJobs,
    jobState: "failed" | "running" | "succeeded"
  ): void {
    jobsTotal.inc({
      job_state: jobState,
      job_type: jobType,
      service: "worker"
    });
  }

  registerProcessErrorHandlers(logger, reporter);
  registerServiceInfoMetrics(
    registry,
    "worker",
    env.environment,
    getApplicationVersionInfo(env.appVersion)
  );
  serviceHealth.set({ service: "worker" }, 1);
  serviceReady.set({ service: "worker" }, 0);
  setJobInProgress("cleanup", 0);
  setJobInProgress("export", 0);
  setJobInProgress("thumbnail", 0);

  function syncWorkerMetrics(): void {
    heartbeatUnixtime.set(
      { service: "worker" },
      Math.floor(Date.now() / 1_000)
    );
    uptimeSeconds.set(
      { service: "worker" },
      Math.floor((Date.now() - startedAt) / 1_000)
    );
  }

  const requestStartedAt = new WeakMap<object, bigint>();
  const app = Fastify({
    disableRequestLogging: true,
    genReqId(request) {
      const header = request.headers["x-request-id"];
      return createRequestId(typeof header === "string" ? header : undefined);
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    requestStartedAt.set(request, process.hrtime.bigint());
    reply.header("x-request-id", request.id);
    logger.info("worker http request started", {
      method: request.method,
      path: request.url,
      requestId: request.id
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAtNs = requestStartedAt.get(request);
    const durationMs =
      typeof startedAtNs === "bigint"
        ? Number(process.hrtime.bigint() - startedAtNs) / 1_000_000
        : undefined;
    const route = request.routeOptions.url ?? request.url;

    logger.info("worker http request completed", {
      durationMs:
        durationMs === undefined ? undefined : Number(durationMs.toFixed(2)),
      method: request.method,
      path: request.url,
      requestId: request.id,
      statusCode: reply.statusCode
    });
    httpMetrics.requestsTotal.inc({
      method: request.method,
      route,
      service: "worker",
      status_code: reply.statusCode
    });

    if (durationMs !== undefined) {
      httpMetrics.requestDurationSeconds.observe(
        {
          method: request.method,
          route,
          service: "worker",
          status_code: reply.statusCode
        },
        durationMs / 1_000
      );
    }
  });

  app.setErrorHandler(async (error, request, reply) => {
    logger.error(
      "worker http request failed",
      createErrorLogFields(error, {
        method: request.method,
        path: request.url,
        requestId: request.id,
        statusCode: reply.statusCode >= 400 ? reply.statusCode : 500
      })
    );
    reporter.captureException(error, {
      requestId: request.id,
      route: request.routeOptions.url
    });

    if (!reply.sent) {
      reply.status(500).send({
        error: "internal_error"
      });
    }
  });

  app.get("/healthz", async () => {
    const checks = {
      browser: {
        ok: Boolean(browserPath),
        summary: browserPath
          ? `browser executable ready at ${browserPath}`
          : "browser executable not found"
      },
      env: {
        ok: true,
        summary: "environment loaded"
      },
      database: checkMetadataStore(env.databaseUrl),
      storage: describeConfiguredStorage(env.storage)
    };

    return {
      ...buildHeartbeat(Math.floor((Date.now() - startedAt) / 1000)),
      ok: Object.values(checks).every((check) => check.ok),
      details: {
        browserPath: browserPath ?? "unavailable",
        metadataStore: metadataStore.kind,
        storageBucket: env.storage.bucket,
        storageProvider: env.storage.provider,
        ...summarizeChecks(checks)
      },
      checks
    };
  });
  app.get("/readyz", async (_, reply) => {
    const checks = {
      browser: {
        ok: Boolean(browserPath),
        summary: browserPath
          ? `browser executable ready at ${browserPath}`
          : "browser executable not found"
      },
      env: {
        ok: true,
        summary: "environment loaded"
      },
      database: await checkDatabaseConnection(env.databaseUrl),
      storage: await inspectStorage(storage, env.storage)
    };
    const ready = Object.values(checks).every((check) => check.ok);

    serviceReady.set({ service: "worker" }, ready ? 1 : 0);

    if (!ready) {
      reply.status(503);
    }

    return {
      ...buildHeartbeat(Math.floor((Date.now() - startedAt) / 1000)),
      ok: ready,
      ready,
      details: {
        browserPath: browserPath ?? "unavailable",
        metadataStore: metadataStore.kind,
        storageBucket: env.storage.bucket,
        storageProvider: env.storage.provider,
        ...summarizeChecks(checks)
      },
      checks
    };
  });

  app.get("/status", async () => ({
    ...buildHeartbeat(Math.floor((Date.now() - startedAt) / 1000)),
    activeJobs
  }));
  app.get("/metrics", async (_request, reply) => {
    syncWorkerMetrics();
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return registry.render();
  });

  if (env.enableTestErrorRoutes) {
    app.get("/__diagnostics/error", async () => {
      throw new Error("Forced worker observability test error");
    });
  }

  let exportLoopBusy = false;
  let thumbnailLoopBusy = false;
  let cleanupLoopBusy = false;

  async function runExportLoop(): Promise<void> {
    if (exportLoopBusy || !browserPath) {
      return;
    }

    exportLoopBusy = true;
    setJobInProgress("export", 1);

    try {
      for (let index = 0; index < env.exportConcurrency; index += 1) {
        recordJobState("export", "running");
        const processed = await processExportJob({
          browserPath,
          persistence,
          storage,
          timeoutMs: env.browserLaunchTimeoutMs
        });

        if (!processed) {
          break;
        }

        recordJobState("export", "succeeded");
      }
    } catch (error) {
      recordJobState("export", "failed");
      logger.error("worker export loop failed", createErrorLogFields(error));
      reporter.captureException(error, {
        event: "worker_export_loop"
      });
    } finally {
      setJobInProgress("export", 0);
      exportLoopBusy = false;
    }
  }

  async function runThumbnailLoop(): Promise<void> {
    if (thumbnailLoopBusy || !browserPath) {
      return;
    }

    thumbnailLoopBusy = true;
    setJobInProgress("thumbnail", 1);

    try {
      const pageCandidate = await findNextPageMissingThumbnail();

      if (pageCandidate) {
        recordJobState("thumbnail", "running");
        await reconcilePageThumbnail({
          browserPath,
          candidate: {
            file: pageCandidate.file,
            page: pageCandidate.page
          },
          persistence,
          storage,
          timeoutMs: env.browserLaunchTimeoutMs
        });
        recordJobState("thumbnail", "succeeded");
      }

      const fileCandidate = await findNextFileMissingThumbnail();

      if (fileCandidate) {
        recordJobState("thumbnail", "running");
        await reconcileFileThumbnail({
          browserPath,
          candidate: {
            coverPage: fileCandidate.coverPage,
            file: fileCandidate.file
          },
          persistence,
          storage,
          timeoutMs: env.browserLaunchTimeoutMs
        });
        recordJobState("thumbnail", "succeeded");
      }
    } catch (error) {
      recordJobState("thumbnail", "failed");
      logger.error("worker thumbnail loop failed", createErrorLogFields(error));
      reporter.captureException(error, {
        event: "worker_thumbnail_loop"
      });
    } finally {
      setJobInProgress("thumbnail", 0);
      thumbnailLoopBusy = false;
    }
  }

  async function runCleanupLoop(): Promise<void> {
    if (cleanupLoopBusy) {
      return;
    }

    cleanupLoopBusy = true;
    setJobInProgress("cleanup", 1);

    try {
      recordJobState("cleanup", "running");
      await failStaleRunningExportJobs(
        new Date(Date.now() - env.jobTimeoutMs)
      );
      await cleanupDeletedThumbnails({
        retentionMs: env.cleanupRetentionMs,
        storage
      });
      recordJobState("cleanup", "succeeded");
    } catch (error) {
      recordJobState("cleanup", "failed");
      logger.error("worker cleanup loop failed", createErrorLogFields(error));
      reporter.captureException(error, {
        event: "worker_cleanup_loop"
      });
    } finally {
      setJobInProgress("cleanup", 0);
      cleanupLoopBusy = false;
    }
  }

  const heartbeat = setInterval(() => {
    syncWorkerMetrics();
    logger.info("worker heartbeat", {
      bootId,
      cleanupJobs: activeJobs.cleanup,
      exportJobs: activeJobs.export,
      heartbeatIntervalMs: env.heartbeatIntervalMs,
      thumbnailJobs: activeJobs.thumbnail,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
    });
  }, env.heartbeatIntervalMs);

  try {
    try {
      await storage.ensureBucket();
    } catch (error) {
      logger.warn("storage bootstrap failed during startup", {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    await app.listen({
      host: env.host,
      port: env.port
    });

    logger.info("worker server listening", {
      bootId,
      browserPath: browserPath ?? "unavailable",
      host: env.host,
      port: env.port,
      storageBucket: env.storage.bucket,
      storageProvider: env.storage.provider
    });

    void runCleanupLoop();
    void runThumbnailLoop();
    void runExportLoop();
    setInterval(() => void runCleanupLoop(), env.cleanupIntervalMs);
    setInterval(() => void runThumbnailLoop(), env.thumbnailPollIntervalMs);
    setInterval(() => void runExportLoop(), env.exportPollIntervalMs);
  } catch (error) {
    clearInterval(heartbeat);
    logger.error("worker failed to start", createErrorLogFields(error));
    reporter.captureException(error, {
      event: "startup"
    });
    await reporter.flush();
    process.exitCode = 1;
  }
}

void startWorker();
