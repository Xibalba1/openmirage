import {
  createCollabDocumentName,
  type PageDocumentDto
} from "@openmirage/types";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import {
  buildPageCollabWebSocketUrl,
  type PageCollabLocation
} from "../collab";

const MESSAGE_SYNC = 0;
const MESSAGE_AUTH = 2;
const MESSAGE_SYNC_REPLY = 4;
const AUTH_TOKEN = 0;
const AUTH_PERMISSION_DENIED = 1;
const AUTHENTICATED = 2;
const RECONNECT_DELAY_MS = 1_000;

function readBinaryMessage(
  data: Blob | ArrayBuffer | Uint8Array
): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    return Promise.resolve(data);
  }

  if (data instanceof ArrayBuffer) {
    return Promise.resolve(new Uint8Array(data));
  }

  return data.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function writeSyncMessage(
  documentName: string,
  doc: Y.Doc,
  write: (encoder: encoding.Encoder) => void
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

function writeAuthMessage(documentName: string, token = ""): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, MESSAGE_AUTH);
  encoding.writeVarUint(encoder, AUTH_TOKEN);
  encoding.writeVarString(encoder, token);
  return encoding.toUint8Array(encoder);
}

function getFramedSyncMessageLength(documentName: string): number {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  return encoding.length(encoder);
}

function readPageDocument(doc: Y.Doc, pageId: string): PageDocumentDto {
  const pageMap = doc.getMap<unknown>("page");
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

export interface PageDocumentSubscription {
  connect(): void;
  destroy(): void;
}

export function subscribeToPageDocument(
  input: {
    collabWsPath: string;
    collabWsUrl: string;
    location: PageCollabLocation;
  },
  onDocument: (document: PageDocumentDto) => void,
  onStatus?: (
    status: "connecting" | "connected" | "disconnected" | "error"
  ) => void
): PageDocumentSubscription {
  const doc = new Y.Doc();
  const documentName = createCollabDocumentName(input.location.pageId);
  const minSyncMessageLength = getFramedSyncMessageLength(documentName);
  let socket: WebSocket | null = null;
  let destroyed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let isSocketAuthenticated = false;
  let authDenied = false;

  const emitDocument = () => {
    onDocument(readPageDocument(doc, input.location.pageId));
  };

  const handleUpdate = () => {
    emitDocument();
  };

  doc.on("update", handleUpdate);
  emitDocument();

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (destroyed || reconnectTimer !== null || authDenied) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  function connect(): void {
    if (destroyed || socket) {
      return;
    }

    clearReconnectTimer();
    authDenied = false;
    isSocketAuthenticated = false;
    onStatus?.("connecting");
    const activeSocket = new WebSocket(
      buildPageCollabWebSocketUrl(
        input.collabWsUrl,
        input.collabWsPath,
        input.location
      )
    );
    socket = activeSocket;
    activeSocket.binaryType = "arraybuffer";

    activeSocket.addEventListener("open", () => {
      if (socket !== activeSocket) {
        return;
      }

      activeSocket.send(writeAuthMessage(documentName));
    });

    activeSocket.addEventListener("message", (event) => {
      void readBinaryMessage(
        event.data as Blob | ArrayBuffer | Uint8Array
      ).then((message) => {
        const decoder = decoding.createDecoder(message);
        const incomingDocumentName = decoding.readVarString(decoder);

        if (incomingDocumentName !== documentName) {
          return;
        }

        const messageType = decoding.readVarUint(decoder);

        if (messageType === MESSAGE_AUTH && socket === activeSocket) {
          const authType = decoding.readVarUint(decoder);

          if (authType === AUTH_TOKEN) {
            activeSocket.send(writeAuthMessage(documentName));
            return;
          }

          if (authType === AUTH_PERMISSION_DENIED) {
            authDenied = true;
            onStatus?.("error");
            activeSocket.close();
            return;
          }

          if (authType === AUTHENTICATED) {
            isSocketAuthenticated = true;
            onStatus?.("connected");
            activeSocket.send(
              writeSyncMessage(documentName, doc, (encoder) => {
                syncProtocol.writeSyncStep1(encoder, doc);
              })
            );
          }
          return;
        }

        if (
          (messageType !== MESSAGE_SYNC && messageType !== MESSAGE_SYNC_REPLY) ||
          socket !== activeSocket
        ) {
          return;
        }

        const encoder = encoding.createEncoder();
        encoding.writeVarString(encoder, documentName);
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, null);

        if (
          isSocketAuthenticated &&
          encoding.length(encoder) > minSyncMessageLength
        ) {
          activeSocket.send(encoding.toUint8Array(encoder));
        }
      });
    });

    activeSocket.addEventListener("close", () => {
      if (socket === activeSocket) {
        socket = null;
      }
      isSocketAuthenticated = false;
      if (destroyed) {
        onStatus?.("disconnected");
        return;
      }

      onStatus?.("error");
      scheduleReconnect();
    });
    activeSocket.addEventListener("error", () => {
      onStatus?.("error");
    });
  }

  return {
    connect,
    destroy() {
      destroyed = true;
      onStatus?.("disconnected");
      clearReconnectTimer();
      doc.off("update", handleUpdate);
      socket?.close();
      socket = null;
      isSocketAuthenticated = false;
      doc.destroy();
    }
  };
}
