import { Hocuspocus } from "@hocuspocus/server";
import { createSessionContract } from "@openmirage/auth";
import { readCollabEnv } from "@openmirage/config-env";
import { createServiceLogger } from "@openmirage/observability";
import { type HealthStatus } from "@openmirage/types";
import Fastify from "fastify";
import type WebSocket from "ws";
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
  const logger = createServiceLogger({
    service: "collab",
    environment: env.environment,
    level: env.logLevel
  });

  const app = Fastify({
    disableRequestLogging: true
  });

  const hocuspocus = new Hocuspocus({
    name: "openmirage-collab",
    quiet: true,
    async onConnect(data) {
      const hasSessionCookie = (data.requestHeaders.cookie ?? "").includes(
        `${env.sessionCookieName}=`
      );

      logger.info("collab client connected", {
        authenticated: hasSessionCookie,
        documentName: data.documentName,
        socketId: data.socketId
      });
    },
    async connected(data) {
      logger.info("collab connection established", {
        documentName: data.documentName,
        socketId: data.socketId
      });
    },
    async onLoadDocument(data) {
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
      logger.info("collab client disconnected", {
        documentName: data.documentName,
        socketId: data.socketId
      });
    }
  });

  const websocketServer = new WebSocketServer({
    noServer: true
  });

  app.addHook("onRequest", async (request) => {
    logger.info("http request started", {
      method: request.method,
      path: request.url,
      requestId: request.id
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    logger.info("http request completed", {
      method: request.method,
      path: request.url,
      requestId: request.id,
      statusCode: reply.statusCode
    });
  });

  app.get("/healthz", async () =>
    createCollabHealthStatus(
      hocuspocus.getDocumentsCount(),
      hocuspocus.getConnectionsCount()
    )
  );

  app.get("/", async () => ({
    service: "collab",
    status: "running",
    websocketPath: env.wsPath
  }));

  app.server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(
      request.url ?? env.wsPath,
      `http://${request.headers.host ?? `${env.host}:${env.port}`}`
    );

    if (requestUrl.pathname !== env.wsPath) {
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
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
      host: env.host,
      port: env.port,
      websocketPath: env.wsPath
    });
  } catch (error) {
    logger.error("collab server failed to start", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  }
}

void startCollabServer();
