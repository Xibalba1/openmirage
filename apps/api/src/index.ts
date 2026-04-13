import cors from "@fastify/cors";
import {
  buildMagicLinkUrl,
  createClearSessionCookieHeader,
  createSessionContract,
  createSetSessionCookieHeader,
  isValidEmail,
  normalizeEmail,
  readSessionTokenFromCookie
} from "@openmirage/auth";
import { readApiEnv } from "@openmirage/config-env";
import {
  checkDatabaseConnection,
  checkMetadataStore,
  consumeMagicLinkToken,
  createDatabasePool,
  createMetadataStoreContract,
  deriveDisplayName,
  getAuthContextForSessionToken,
  getApplicationVersionInfo,
  issueMagicLinkForEmail,
  refreshSession,
  revokeSession
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
import { createStorage } from "@openmirage/storage";
import {
  type AuthContext,
  type HealthStatus,
  type ReadyStatus,
  type ServiceCheck,
  type StorageConfig
} from "@openmirage/types";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

interface StorageSmokeBody {
  bodyBase64: string;
  contentType?: string;
  key?: string;
}

interface MagicLinkRequestBody {
  displayName?: string;
  email?: string;
}

interface SessionQuerystring {
  workspaceId?: string;
}

function createAuthUnauthorizedReply(reply: FastifyReply) {
  reply.status(401);
  return {
    error: "unauthenticated"
  };
}

function createAuthForbiddenReply(reply: FastifyReply) {
  reply.status(403);
  return {
    error: "forbidden"
  };
}

function createSessionContractFromEnv() {
  const env = readApiEnv();

  return createSessionContract({
    sessionCookieMaxAgeSeconds: env.authSessionTtlDays * 24 * 60 * 60,
    sessionCookieName: env.sessionCookieName,
    sessionCookiePath: env.sessionCookiePath,
    sessionCookieSameSite: env.sessionCookieSameSite,
    sessionCookieSecure: env.sessionCookieSecure
  });
}

function getAuthRedirectTarget(
  env: ReturnType<typeof readApiEnv>,
  redirectTo: string | undefined
): string {
  if (!redirectTo) {
    return env.appBaseUrl;
  }

  try {
    const redirectUrl = new URL(redirectTo);
    const appBaseUrl = new URL(env.appBaseUrl);

    if (redirectUrl.origin !== appBaseUrl.origin) {
      return env.appBaseUrl;
    }

    return redirectUrl.toString();
  } catch {
    return env.appBaseUrl;
  }
}

async function readAuthContextFromRequest(
  request: FastifyRequest,
  databasePool: ReturnType<typeof createDatabasePool>,
  sessionContract = createSessionContractFromEnv()
): Promise<AuthContext | null> {
  const token = readSessionTokenFromCookie(
    request.headers.cookie,
    sessionContract
  );

  if (!token) {
    return null;
  }

  return getAuthContextForSessionToken(token, databasePool);
}

function hasWorkspaceMembership(
  authContext: AuthContext,
  workspaceId: string | undefined
): boolean {
  if (!workspaceId) {
    return true;
  }

  return authContext.memberships.some(
    (membership) => membership.workspaceId === workspaceId
  );
}

function describeConfiguredStorage(storageConfig: StorageConfig): ServiceCheck {
  return {
    ok: true,
    summary: `configured for ${storageConfig.provider} storage bucket ${storageConfig.bucket}`
  };
}

async function buildHealthStatus(): Promise<HealthStatus> {
  const env = readApiEnv();
  const session = createSessionContract({
    sessionCookieMaxAgeSeconds: env.authSessionTtlDays * 24 * 60 * 60,
    sessionCookieName: env.sessionCookieName,
    sessionCookiePath: env.sessionCookiePath,
    sessionCookieSameSite: env.sessionCookieSameSite,
    sessionCookieSecure: env.sessionCookieSecure
  });
  const metadataStore = createMetadataStoreContract();
  const checks = {
    env: {
      ok: true,
      summary: "environment loaded"
    },
    database: checkMetadataStore(env.databaseUrl),
    storage: describeConfiguredStorage(env.storage)
  };
  const ok = Object.values(checks).every((check) => check.ok);

  return {
    service: "api",
    ok,
    environment: env.environment,
    timestamp: new Date().toISOString(),
    details: {
      authMode: session.mode,
      authPath: env.authPath,
      metadataStore: metadataStore.kind,
      sessionCookieName: session.sessionCookieName,
      storageBucket: env.storage.bucket,
      storageProvider: env.storage.provider,
      ...summarizeChecks(checks)
    },
    checks
  };
}

async function inspectStorage(
  storage: ReturnType<typeof createStorage>,
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

async function buildReadyStatus(): Promise<ReadyStatus> {
  const env = readApiEnv();
  const session = createSessionContract({
    sessionCookieMaxAgeSeconds: env.authSessionTtlDays * 24 * 60 * 60,
    sessionCookieName: env.sessionCookieName,
    sessionCookiePath: env.sessionCookiePath,
    sessionCookieSameSite: env.sessionCookieSameSite,
    sessionCookieSecure: env.sessionCookieSecure
  });
  const metadataStore = createMetadataStoreContract();
  const storage = createStorage(env.storage);
  const checks = {
    env: {
      ok: true,
      summary: "environment loaded"
    },
    database: await checkDatabaseConnection(env.databaseUrl),
    storage: await inspectStorage(storage, env.storage)
  };
  const ok = Object.values(checks).every((check) => check.ok);

  return {
    service: "api",
    ok,
    ready: ok,
    environment: env.environment,
    timestamp: new Date().toISOString(),
    details: {
      authMode: session.mode,
      authPath: env.authPath,
      metadataStore: metadataStore.kind,
      sessionCookieName: session.sessionCookieName,
      storageBucket: env.storage.bucket,
      storageProvider: env.storage.provider,
      ...summarizeChecks(checks)
    },
    checks
  };
}

async function startApiServer(): Promise<void> {
  const env = readApiEnv();
  const sessionContract = createSessionContract({
    sessionCookieMaxAgeSeconds: env.authSessionTtlDays * 24 * 60 * 60,
    sessionCookieName: env.sessionCookieName,
    sessionCookiePath: env.sessionCookiePath,
    sessionCookieSameSite: env.sessionCookieSameSite,
    sessionCookieSecure: env.sessionCookieSecure
  });
  const logger = createServiceLogger({
    service: "api",
    environment: env.environment,
    version: env.appVersion,
    level: env.logLevel
  });
  const reporter = initErrorReporter(env.errorReporting, logger);
  const registry = createMetricsRegistry();
  const httpMetrics = createHttpMetrics(registry, "api");
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

  registerProcessErrorHandlers(logger, reporter);
  registerServiceInfoMetrics(
    registry,
    "api",
    env.environment,
    getApplicationVersionInfo(env.appVersion)
  );
  serviceHealth.set({ service: "api" }, 1);
  serviceReady.set({ service: "api" }, 0);

  const requestStartedAt = new WeakMap<object, bigint>();
  const storage = createStorage(env.storage);
  const databasePool = createDatabasePool(env.databaseUrl);

  const app = Fastify({
    disableRequestLogging: true,
    trustProxy: true,
    genReqId(request) {
      const header = request.headers["x-request-id"];
      return createRequestId(typeof header === "string" ? header : undefined);
    }
  });

  await app.register(cors, {
    origin: true,
    credentials: true
  });

  app.addHook("onRequest", async (request, reply) => {
    const startedAt = process.hrtime.bigint();
    requestStartedAt.set(request, startedAt);
    reply.header("x-request-id", request.id);

    logger.info("request started", {
      method: request.method,
      path: request.url,
      requestId: request.id
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestStartedAt.get(request);
    const durationMs =
      typeof startedAt === "bigint"
        ? Number(process.hrtime.bigint() - startedAt) / 1_000_000
        : undefined;
    const route = request.routeOptions.url ?? request.url;

    logger.info("request completed", {
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
      service: "api",
      status_code: reply.statusCode
    });

    if (durationMs !== undefined) {
      httpMetrics.requestDurationSeconds.observe(
        {
          method: request.method,
          route,
          service: "api",
          status_code: reply.statusCode
        },
        durationMs / 1_000
      );
    }
  });

  app.setErrorHandler(async (error, request, reply) => {
    logger.error(
      "request failed",
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

  app.get("/healthz", async () => buildHealthStatus());
  app.get("/readyz", async (_, reply) => {
    const ready = await buildReadyStatus();
    serviceReady.set({ service: "api" }, ready.ready ? 1 : 0);

    if (!ready.ready) {
      reply.status(503);
    }

    return ready;
  });
  app.get("/metrics", async (_request, reply) => {
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return registry.render();
  });
  app.get("/", async () => ({
    service: "api",
    status: "running"
  }));
  app.get(`${env.authPath}/entry`, async () => ({
    service: "api",
    mode: "magic-link-session",
    route: `${env.authPath}/entry`,
    status: "ready",
    endpoints: {
      consumeMagicLink: `${env.authPath}/magic-link/consume`,
      currentSession: `${env.authPath}/session`,
      logout: `${env.authPath}/logout`,
      requestMagicLink: `${env.authPath}/magic-link/request`,
      sessionRefresh: `${env.authPath}/session/refresh`
    }
  }));
  app.post<{ Body: MagicLinkRequestBody }>(
    `${env.authPath}/magic-link/request`,
    async (request, reply) => {
      const email = request.body?.email
        ? normalizeEmail(request.body.email)
        : "";

      if (!email || !isValidEmail(email)) {
        reply.status(400);
        return {
          error: "email is required"
        };
      }

      const displayName =
        request.body?.displayName?.trim() || deriveDisplayName(email);
      const issued = await issueMagicLinkForEmail(
        {
          displayName,
          email,
          ttlMinutes: env.authMagicLinkTtlMinutes
        },
        databasePool
      );
      const requestHost = request.headers.host ?? new URL(env.appBaseUrl).host;
      const magicLinkUrl = buildMagicLinkUrl({
        apiBaseUrl: `${request.protocol}://${requestHost}`,
        authPath: env.authPath,
        redirectTo: env.appBaseUrl,
        token: issued.magicLink.token
      });

      logger.info("magic link requested", {
        authDeliveryMode: env.authDeliveryMode,
        email,
        expiresAt: issued.magicLink.expiresAt,
        magicLinkUrl
      });

      return {
        delivery: env.authDeliveryMode,
        expiresAt: issued.magicLink.expiresAt,
        ok: true,
        ...(env.devAuthExposeMagicLink ? { magicLinkUrl } : {})
      };
    }
  );
  app.get<{
    Querystring: {
      redirectTo?: string;
      token?: string;
    };
  }>(`${env.authPath}/magic-link/consume`, async (request, reply) => {
    if (!request.query.token) {
      reply.status(400);
      return {
        error: "token is required"
      };
    }

    const consumedMagicLink = await consumeMagicLinkToken(
      request.query.token,
      env.authSessionTtlDays,
      databasePool
    );

    if (!consumedMagicLink) {
      reply.status(401);
      return {
        error: "invalid_or_expired_magic_link"
      };
    }

    reply.header(
      "set-cookie",
      createSetSessionCookieHeader(
        consumedMagicLink.sessionToken,
        sessionContract
      )
    );

    logger.info("magic link consumed", {
      sessionId: consumedMagicLink.authContext.session.id,
      userId: consumedMagicLink.authContext.user.id
    });

    const redirectTarget = new URL(
      getAuthRedirectTarget(env, request.query.redirectTo)
    );
    redirectTarget.searchParams.set("auth", "success");

    reply.redirect(redirectTarget.toString(), 302);
  });
  app.get<{ Querystring: SessionQuerystring }>(
    `${env.authPath}/session`,
    async (request, reply) => {
      const authContext = await readAuthContextFromRequest(
        request,
        databasePool,
        sessionContract
      );

      if (!authContext) {
        return createAuthUnauthorizedReply(reply);
      }

      if (!hasWorkspaceMembership(authContext, request.query.workspaceId)) {
        return createAuthForbiddenReply(reply);
      }

      return authContext;
    }
  );
  app.post<{ Querystring: SessionQuerystring }>(
    `${env.authPath}/session/refresh`,
    async (request, reply) => {
      const token = readSessionTokenFromCookie(
        request.headers.cookie,
        sessionContract
      );

      if (!token) {
        return createAuthUnauthorizedReply(reply);
      }

      const refreshedContext = await refreshSession(
        token,
        env.authSessionTtlDays,
        databasePool
      );

      if (!refreshedContext) {
        reply.header(
          "set-cookie",
          createClearSessionCookieHeader(sessionContract)
        );
        return createAuthUnauthorizedReply(reply);
      }

      if (
        !hasWorkspaceMembership(refreshedContext, request.query.workspaceId)
      ) {
        return createAuthForbiddenReply(reply);
      }

      reply.header(
        "set-cookie",
        createSetSessionCookieHeader(token, sessionContract)
      );

      return refreshedContext;
    }
  );
  app.get(`${env.authPath}/me`, async (request, reply) => {
    const authContext = await readAuthContextFromRequest(
      request,
      databasePool,
      sessionContract
    );

    if (!authContext) {
      return createAuthUnauthorizedReply(reply);
    }

    return authContext;
  });
  app.post(`${env.authPath}/logout`, async (request, reply) => {
    const token = readSessionTokenFromCookie(
      request.headers.cookie,
      sessionContract
    );

    if (token) {
      await revokeSession(token, databasePool);
    }

    reply.header("set-cookie", createClearSessionCookieHeader(sessionContract));

    return {
      ok: true
    };
  });
  app.get("/internal/storage/smoke", async () => {
    await storage.ensureBucket();

    return {
      provider: env.storage.provider,
      bucket: env.storage.bucket,
      objects: await storage.list("smoke/")
    };
  });
  app.post<{ Body: StorageSmokeBody }>(
    "/internal/storage/smoke",
    async (request, reply) => {
      await storage.ensureBucket();

      if (!request.body?.bodyBase64) {
        reply.status(400);
        return {
          error: "bodyBase64 is required"
        };
      }

      const key =
        request.body.key ??
        `smoke/${Date.now()}-${Math.random().toString(36).slice(2)}.bin`;
      const body = Buffer.from(request.body.bodyBase64, "base64");
      const object = await storage.put({
        key,
        body,
        ...(request.body.contentType
          ? { contentType: request.body.contentType }
          : {})
      });

      return {
        object,
        downloadUrl: await storage.resolveDownloadUrl(key)
      };
    }
  );
  app.delete<{ Querystring: { key: string } }>(
    "/internal/storage/smoke",
    async (request, reply) => {
      await storage.ensureBucket();

      if (!request.query.key) {
        reply.status(400);
        return {
          error: "key is required"
        };
      }

      return storage.delete(request.query.key);
    }
  );

  if (env.enableTestErrorRoutes) {
    app.get("/__diagnostics/error", async () => {
      throw new Error("Forced API observability test error");
    });
  }

  try {
    app.addHook("onClose", async () => {
      await databasePool.end();
    });

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

    logger.info("api server listening", {
      authPath: env.authPath,
      host: env.host,
      port: env.port,
      storageBucket: env.storage.bucket,
      storageProvider: env.storage.provider
    });
  } catch (error) {
    logger.error("api server failed to start", createErrorLogFields(error));
    reporter.captureException(error, {
      event: "startup"
    });
    await reporter.flush();
    process.exitCode = 1;
  }
}

void startApiServer();
