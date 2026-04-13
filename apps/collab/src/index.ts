import { Hocuspocus } from "@hocuspocus/server";
import {
  createSessionContract,
  readSessionTokenFromCookie
} from "@openmirage/auth";
import { readCollabEnv } from "@openmirage/config-env";
import {
  createErrorLogFields,
  createHttpMetrics,
  createMetricsRegistry,
  createRequestId,
  createServiceLogger,
  initErrorReporter,
  registerProcessErrorHandlers,
  registerServiceInfoMetrics
} from "@openmirage/observability";
import { type HealthStatus } from "@openmirage/types";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

function createCollabHealthStatus(
  documentsCount: number,
  connectionsCount: number
): HealthStatus {
  const env = readCollabEnv();
  const session = createSessionContract({
    sessionCookieName: env.sessionCookieName
  });

  return {
    service: "collab",
    ok: true,
    environment: env.environment,
    timestamp: new Date().toISOString(),
    details: {
      apiBaseUrl: env.apiBaseUrl,
      authPath: env.authPath,
      authMode: session.mode,
      sessionCookieName: session.sessionCookieName,
      websocketPath: env.wsPath,
      activeDocuments: String(documentsCount),
      activeConnections: String(connectionsCount)
    },
    checks: {
      env: {
        ok: true,
        summary: "environment loaded"
      },
      authBoundary: {
        ok: true,
        summary: `connection auth delegated to API/session layer at ${env.apiBaseUrl}`
      }
    }
  };
}

async function startCollabServer(): Promise<void> {
  const env = readCollabEnv();
  const sessionContract = createSessionContract({
    sessionCookieName: env.sessionCookieName
  });
  const logger = createServiceLogger({
    service: "collab",
    environment: env.environment,
    version: env.appVersion,
    level: env.logLevel
  });
  const reporter = initErrorReporter(env.errorReporting, logger);
  const registry = createMetricsRegistry();
  const httpMetrics = createHttpMetrics(registry, "collab");
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
  const activeConnections = registry.gauge({
    name: "openmirage_collab_active_connections",
    help: "Current number of active collaboration websocket connections",
    labelNames: ["service"],
    type: "gauge"
  });
  const totalConnections = registry.counter({
    name: "openmirage_collab_connections_total",
    help: "Total collaboration websocket connections accepted",
    labelNames: ["service"],
    type: "counter"
  });
  const disconnectsTotal = registry.counter({
    name: "openmirage_collab_disconnects_total",
    help: "Total collaboration websocket disconnects",
    labelNames: ["service"],
    type: "counter"
  });
  const activeDocuments = registry.gauge({
    name: "openmirage_collab_active_documents",
    help: "Current number of active collaboration documents",
    labelNames: ["service"],
    type: "gauge"
  });

  registerProcessErrorHandlers(logger, reporter);
  registerServiceInfoMetrics(registry, "collab", env.environment, {
    release: env.appVersion,
    schemaVersion: "unmigrated"
  });
  serviceHealth.set({ service: "collab" }, 1);
  serviceReady.set({ service: "collab" }, 1);
  totalConnections.inc({ service: "collab" }, 0);
  disconnectsTotal.inc({ service: "collab" }, 0);

  const requestStartedAt = new WeakMap<object, bigint>();
  const socketConnectionIds = new WeakMap<object, string>();
  let activeSocketCount = 0;

  function syncRealtimeMetrics(): void {
    activeConnections.set({ service: "collab" }, activeSocketCount);
    activeDocuments.set({ service: "collab" }, hocuspocus.getDocumentsCount());
  }

  const app = Fastify({
    disableRequestLogging: true,
    genReqId(request) {
      const header = request.headers["x-request-id"];
      return createRequestId(typeof header === "string" ? header : undefined);
    }
  });

  const hocuspocus = new Hocuspocus({
    name: "openmirage-collab",
    quiet: true,
    async onConnect(data) {
      logger.info("collab session connecting", {
        documentName: data.documentName,
        socketId: data.socketId
      });
    },
    async connected(data) {
      syncRealtimeMetrics();
      logger.info("collab document session established", {
        documentName: data.documentName,
        socketId: data.socketId
      });
    },
    async onLoadDocument(data) {
      syncRealtimeMetrics();
      logger.info("collab document load requested", {
        documentName: data.documentName,
        socketId: data.socketId
      });
    },
    async onChange(data) {
      logger.debug("collab document changed", {
        clientsCount: data.clientsCount,
        documentName: data.documentName,
        socketId: data.socketId
      });
    },
    async onDisconnect(data) {
      syncRealtimeMetrics();
      logger.info("collab document session disconnected", {
        documentName: data.documentName,
        socketId: data.socketId
      });
    }
  });

  const websocketServer = new WebSocketServer({
    noServer: true
  });

  app.addHook("onRequest", async (request, reply) => {
    requestStartedAt.set(request, process.hrtime.bigint());
    reply.header("x-request-id", request.id);
    logger.info("http request started", {
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

    logger.info("http request completed", {
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
      service: "collab",
      status_code: reply.statusCode
    });

    if (durationMs !== undefined) {
      httpMetrics.requestDurationSeconds.observe(
        {
          method: request.method,
          route,
          service: "collab",
          status_code: reply.statusCode
        },
        durationMs / 1_000
      );
    }
  });

  app.setErrorHandler(async (error, request, reply) => {
    logger.error(
      "http request failed",
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

  app.get("/healthz", async () =>
    createCollabHealthStatus(
      hocuspocus.getDocumentsCount(),
      hocuspocus.getConnectionsCount()
    )
  );
  app.get("/metrics", async (_request, reply) => {
    syncRealtimeMetrics();
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return registry.render();
  });

  app.get("/", async () => ({
    service: "collab",
    status: "running",
    websocketPath: env.wsPath
  }));

  if (env.enableTestErrorRoutes) {
    app.get("/__diagnostics/error", async () => {
      throw new Error("Forced collab observability test error");
    });
  }

  app.server.on("upgrade", async (request, socket, head) => {
    const requestUrl = new URL(
      request.url ?? env.wsPath,
      `http://${request.headers.host ?? `${env.host}:${env.port}`}`
    );

    if (requestUrl.pathname !== env.wsPath) {
      socket.destroy();
      return;
    }

    const sessionToken = readSessionTokenFromCookie(
      request.headers.cookie,
      sessionContract
    );
    const documentName =
      requestUrl.searchParams.get("documentName") ?? "unknown";
    const workspaceId = requestUrl.searchParams.get("workspaceId") ?? undefined;

    if (!sessionToken) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      logger.warn("collab websocket rejected", {
        connectionReason: "missing-session-cookie",
        documentName,
        workspaceId
      });
      return;
    }

    const authCheckUrl = new URL(`${env.apiBaseUrl}${env.authPath}/session`);

    if (workspaceId) {
      authCheckUrl.searchParams.set("workspaceId", workspaceId);
    }

    let authResponse: Response;

    try {
      authResponse = await fetch(authCheckUrl, {
        headers: {
          cookie: request.headers.cookie ?? ""
        }
      });
    } catch (error) {
      socket.write(
        "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n"
      );
      socket.destroy();
      logger.error("collab websocket auth check failed", {
        documentName,
        error: error instanceof Error ? error.message : String(error),
        workspaceId
      });
      return;
    }

    if (!authResponse.ok) {
      socket.write(
        `HTTP/1.1 ${authResponse.status} ${
          authResponse.status === 403 ? "Forbidden" : "Unauthorized"
        }\r\nConnection: close\r\n\r\n`
      );
      socket.destroy();
      logger.warn("collab websocket rejected", {
        connectionReason:
          authResponse.status === 403
            ? "missing-workspace-membership"
            : "invalid-session",
        documentName,
        workspaceId
      });
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      const closableSocket = websocket as {
        once(event: "close", listener: () => void): void;
      };
      const connectionId = randomUUID();

      socketConnectionIds.set(websocket, connectionId);
      activeSocketCount += 1;
      totalConnections.inc({ service: "collab" });
      syncRealtimeMetrics();
      logger.info("collab websocket accepted", {
        authenticated: true,
        connectionId,
        documentName
      });

      closableSocket.once("close", () => {
        const closedConnectionId =
          socketConnectionIds.get(websocket) ?? connectionId;

        activeSocketCount = Math.max(activeSocketCount - 1, 0);
        disconnectsTotal.inc({ service: "collab" });
        syncRealtimeMetrics();
        logger.info("collab websocket closed", {
          connectionId: closedConnectionId,
          documentName
        });
      });

      hocuspocus.handleConnection(websocket, request, {
        connectedAt: new Date().toISOString()
      });
    });
  });

  try {
    await app.listen({
      host: env.host,
      port: env.port
    });

    logger.info("collab server listening", {
      apiBaseUrl: env.apiBaseUrl,
      authPath: env.authPath,
      host: env.host,
      port: env.port,
      websocketPath: env.wsPath
    });
  } catch (error) {
    logger.error("collab server failed to start", createErrorLogFields(error));
    reporter.captureException(error, {
      event: "startup"
    });
    await reporter.flush();
    process.exitCode = 1;
  }
}

void startCollabServer();
