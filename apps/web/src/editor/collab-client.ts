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

  const emitDocument = () => {
    onDocument(readPageDocument(doc, input.location.pageId));
  };

  const handleUpdate = () => {
    emitDocument();
  };

  doc.on("update", handleUpdate);
  emitDocument();

  return {
    connect() {
      if (destroyed) {
        return;
      }

      onStatus?.("connecting");
      socket = new WebSocket(
        buildPageCollabWebSocketUrl(
          input.collabWsUrl,
          input.collabWsPath,
          input.location
        )
      );
      socket.binaryType = "arraybuffer";

      socket.addEventListener("open", () => {
        if (!socket) {
          return;
        }

        onStatus?.("connected");
        socket.send(
          writeSyncMessage(documentName, doc, (encoder) => {
            syncProtocol.writeSyncStep1(encoder, doc);
          })
        );
      });

      socket.addEventListener("message", (event) => {
        void readBinaryMessage(
          event.data as Blob | ArrayBuffer | Uint8Array
        ).then((message) => {
          const decoder = decoding.createDecoder(message);
          const incomingDocumentName = decoding.readVarString(decoder);

          if (incomingDocumentName !== documentName) {
            return;
          }

          const messageType = decoding.readVarUint(decoder);

          if ((messageType !== MESSAGE_SYNC && messageType !== 4) || !socket) {
            return;
          }

          const encoder = encoding.createEncoder();
          encoding.writeVarString(encoder, documentName);
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, doc, null);

          if (encoding.length(encoder) > minSyncMessageLength) {
            socket.send(encoding.toUint8Array(encoder));
          }
        });
      });

      socket.addEventListener("close", () => {
        onStatus?.(destroyed ? "disconnected" : "error");
      });
      socket.addEventListener("error", () => {
        onStatus?.("error");
      });
    },
    destroy() {
      destroyed = true;
      onStatus?.("disconnected");
      doc.off("update", handleUpdate);
      socket?.close();
      socket = null;
      doc.destroy();
    }
  };
}
