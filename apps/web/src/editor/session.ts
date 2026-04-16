import type { EditorCommand, PageDocumentDto } from "@openmirage/types";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { buildPageCollabWebSocketUrl, type PageCollabLocation } from "../collab";
import { applyEditorCommand } from "./commands";
import {
  type EditorSession,
  type EditorSessionSnapshot,
  type HistoryEntry
} from "./types";

const MESSAGE_SYNC = 0;

function readBinaryMessage(data: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    return Promise.resolve(data);
  }

  if (data instanceof ArrayBuffer) {
    return Promise.resolve(new Uint8Array(data));
  }

  return data.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function writeSyncMessage(
  doc: Y.Doc,
  write: (encoder: encoding.Encoder) => void
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

export function readPageDocument(doc: Y.Doc, pageId: string): PageDocumentDto {
  const pageMap = doc.getMap<unknown>("page");
  const raw = pageMap.toJSON() as Partial<PageDocumentDto>;

  return {
    nodes: typeof raw.nodes === "object" && raw.nodes ? (raw.nodes as PageDocumentDto["nodes"]) : {},
    pageId,
    rootNodeIds: Array.isArray(raw.rootNodeIds)
      ? raw.rootNodeIds.filter((value): value is string => typeof value === "string")
      : []
  };
}

export function writePageDocument(doc: Y.Doc, document: PageDocumentDto): void {
  const pageMap = doc.getMap<unknown>("page");

  doc.transact(() => {
    pageMap.set("rootNodeIds", document.rootNodeIds);
    pageMap.set("nodes", document.nodes);
  });
}

interface SessionInput {
  doc?: Y.Doc;
  pageId: string;
  transport?:
    | {
        collabWsPath: string;
        collabWsUrl: string;
        location: PageCollabLocation;
      }
    | undefined;
}

export function createEditorSession(
  input: SessionInput,
  onStatus?: (status: "connecting" | "connected" | "disconnected" | "error") => void
): EditorSession {
  const doc = input.doc ?? new Y.Doc();
  const listeners = new Set<(snapshot: EditorSessionSnapshot) => void>();
  const past: HistoryEntry[] = [];
  const future: HistoryEntry[] = [];
  let socket: WebSocket | null = null;
  let destroyed = false;
  let snapshot: EditorSessionSnapshot = {
    canRedo: false,
    canUndo: false,
    document: readPageDocument(doc, input.pageId)
  };

  const emit = () => {
    snapshot = {
      canRedo: future.length > 0,
      canUndo: past.length > 0,
      document: readPageDocument(doc, input.pageId)
    };

    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const handleDocUpdate = () => {
    emit();
  };

  doc.on("update", handleDocUpdate);

  function connect(): void {
    if (destroyed || !input.transport) {
      return;
    }

    onStatus?.("connecting");
    socket = new WebSocket(
      buildPageCollabWebSocketUrl(
        input.transport.collabWsUrl,
        input.transport.collabWsPath,
        input.transport.location
      )
    );
    socket.binaryType = "arraybuffer";

    socket.addEventListener("open", () => {
      if (!socket) {
        return;
      }

      onStatus?.("connected");
      socket.send(
        writeSyncMessage(doc, (encoder) => {
          syncProtocol.writeSyncStep1(encoder, doc);
        })
      );
    });

    socket.addEventListener("message", (event) => {
      void readBinaryMessage(event.data as Blob | ArrayBuffer | Uint8Array).then(
        (message) => {
          const decoder = decoding.createDecoder(message);
          const messageType = decoding.readVarUint(decoder);

          if (messageType !== MESSAGE_SYNC || !socket) {
            return;
          }

          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, doc, null);

          if (encoding.length(encoder) > 1) {
            socket.send(encoding.toUint8Array(encoder));
          }
        }
      );
    });

    socket.addEventListener("close", () => {
      onStatus?.(destroyed ? "disconnected" : "error");
    });
    socket.addEventListener("error", () => {
      onStatus?.("error");
    });
  }

  function commit(command: EditorCommand): boolean {
    const before = snapshot.document;
    const after = applyEditorCommand(before, command);

    if (after === before) {
      return false;
    }

    past.push({
      after,
      before,
      command
    });
    future.length = 0;
    writePageDocument(doc, after);
    return true;
  }

  function undo(): boolean {
    const entry = past.pop();

    if (!entry) {
      return false;
    }

    future.push(entry);
    writePageDocument(doc, entry.before);
    return true;
  }

  function redo(): boolean {
    const entry = future.pop();

    if (!entry) {
      return false;
    }

    past.push(entry);
    writePageDocument(doc, entry.after);
    return true;
  }

  return {
    commit,
    connect,
    destroy() {
      destroyed = true;
      onStatus?.("disconnected");
      doc.off("update", handleDocUpdate);
      socket?.close();
      socket = null;
      doc.destroy();
      listeners.clear();
    },
    getSnapshot() {
      return snapshot;
    },
    redo,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => {
        listeners.delete(listener);
      };
    },
    undo
  };
}
