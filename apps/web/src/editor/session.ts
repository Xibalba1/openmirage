import type {
  EditorCommand,
  PageDocumentDto,
  PresencePayload
} from "@openmirage/types";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import {
  buildPageCollabWebSocketUrl,
  type PageCollabLocation
} from "../collab";
import { applyEditorCommand } from "./commands";
import {
  type EditorPresenceEntry,
  type EditorSession,
  type EditorPresenceIdentity,
  type EditorSessionSnapshot,
  type HistoryEntry,
  type Point
} from "./types";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const CURSOR_THROTTLE_MS = 50;

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
  doc: Y.Doc,
  write: (encoder: encoding.Encoder) => void
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

function writeAwarenessMessage(
  awareness: awarenessProtocol.Awareness,
  clientIds: number[]
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, clientIds)
  );
  return encoding.toUint8Array(encoder);
}

function isPresencePayload(
  value: unknown,
  pageId: string
): value is PresencePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<PresencePayload>;

  return (
    payload.pageId === pageId &&
    typeof payload.updatedAt === "string" &&
    payload.participant !== null &&
    typeof payload.participant === "object" &&
    typeof payload.participant?.userId === "string" &&
    typeof payload.participant?.displayName === "string" &&
    typeof payload.participant?.color === "string" &&
    (payload.participant?.avatarUrl === null ||
      typeof payload.participant?.avatarUrl === "string") &&
    (payload.status === "active" ||
      payload.status === "idle" ||
      payload.status === "offline") &&
    (payload.cursor === null ||
      (typeof payload.cursor === "object" &&
        typeof payload.cursor?.x === "number" &&
        typeof payload.cursor?.y === "number")) &&
    (payload.selection === null ||
      (typeof payload.selection === "object" &&
        payload.selection?.pageId === pageId &&
        Array.isArray(payload.selection?.nodeIds)))
  );
}

function readPresenceEntries(
  awareness: awarenessProtocol.Awareness,
  pageId: string
): EditorPresenceEntry[] {
  const entries: EditorPresenceEntry[] = [];

  for (const [clientId, state] of awareness.getStates().entries()) {
    if (!isPresencePayload(state, pageId)) {
      continue;
    }

    entries.push({
      clientId,
      payload: {
        ...state,
        selection: state.selection
          ? {
              ...state.selection,
              nodeIds: state.selection.nodeIds.filter(
                (nodeId): nodeId is string => typeof nodeId === "string"
              )
            }
          : null
      }
    });
  }

  return entries.sort((left, right) =>
    left.payload.participant.displayName.localeCompare(
      right.payload.participant.displayName
    )
  );
}

export function readPageDocument(doc: Y.Doc, pageId: string): PageDocumentDto {
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
  presence?: EditorPresenceIdentity | undefined;
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
  onStatus?: (
    status: "connecting" | "connected" | "disconnected" | "error"
  ) => void
): EditorSession {
  const doc = input.doc ?? new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const listeners = new Set<(snapshot: EditorSessionSnapshot) => void>();
  const past: HistoryEntry[] = [];
  const future: HistoryEntry[] = [];
  let socket: WebSocket | null = null;
  let destroyed = false;
  let cursorFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingCursor: Point | null | undefined;
  let snapshot: EditorSessionSnapshot = {
    canRedo: false,
    canUndo: false,
    document: readPageDocument(doc, input.pageId),
    localClientId: doc.clientID,
    presenceEntries: []
  };

  const emit = () => {
    snapshot = {
      canRedo: future.length > 0,
      canUndo: past.length > 0,
      document: readPageDocument(doc, input.pageId),
      localClientId: doc.clientID,
      presenceEntries: readPresenceEntries(awareness, input.pageId)
    };

    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const handleDocUpdate = () => {
    emit();
  };
  const handleAwarenessUpdate = (
    {
      added,
      removed,
      updated
    }: {
      added: number[];
      removed: number[];
      updated: number[];
    },
    origin: unknown
  ) => {
    const changedClients = added.concat(updated, removed);

    if (
      changedClients.length > 0 &&
      origin !== "remote" &&
      socket &&
      socket.readyState === WebSocket.OPEN
    ) {
      socket.send(writeAwarenessMessage(awareness, changedClients));
    }

    emit();
  };

  doc.on("update", handleDocUpdate);
  awareness.on("update", handleAwarenessUpdate);

  function buildPresencePayload(
    patch: Partial<
      Omit<PresencePayload, "pageId" | "participant" | "status">
    > & {
      cursor?: PresencePayload["cursor"];
      selection?: PresencePayload["selection"];
    }
  ): PresencePayload | null {
    if (!input.presence) {
      return null;
    }

    const currentState = awareness.getLocalState();
    const currentPayload = isPresencePayload(currentState, input.pageId)
      ? currentState
      : null;

    return {
      cursor:
        patch.cursor !== undefined
          ? patch.cursor
          : (currentPayload?.cursor ?? null),
      pageId: input.pageId,
      participant: input.presence.participant,
      selection:
        patch.selection !== undefined
          ? patch.selection
          : (currentPayload?.selection ?? null),
      status: "active",
      updatedAt: new Date().toISOString()
    };
  }

  function setLocalPresence(
    patch: Partial<
      Omit<PresencePayload, "pageId" | "participant" | "status">
    > & {
      cursor?: PresencePayload["cursor"];
      selection?: PresencePayload["selection"];
    }
  ): void {
    const payload = buildPresencePayload(patch);

    if (!payload) {
      return;
    }

    awareness.setLocalState(payload);
  }

  function flushPendingCursor(): void {
    cursorFlushTimer = null;

    if (pendingCursor === undefined) {
      return;
    }

    const cursor = pendingCursor;
    pendingCursor = undefined;
    setLocalPresence({
      cursor: cursor ? { x: cursor.x, y: cursor.y } : null
    });
  }

  function clearRemotePresence(): void {
    const remoteClientIds = Array.from(awareness.getStates().keys()).filter(
      (clientId) => clientId !== doc.clientID
    );

    if (remoteClientIds.length > 0) {
      awarenessProtocol.removeAwarenessStates(
        awareness,
        remoteClientIds,
        "remote"
      );
    }
  }

  if (input.presence) {
    setLocalPresence({
      cursor: null,
      selection: null
    });
  }

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
      if (awareness.getLocalState()) {
        socket.send(writeAwarenessMessage(awareness, [doc.clientID]));
      }
      socket.send(
        writeSyncMessage(doc, (encoder) => {
          syncProtocol.writeSyncStep1(encoder, doc);
        })
      );
    });

    socket.addEventListener("message", (event) => {
      void readBinaryMessage(
        event.data as Blob | ArrayBuffer | Uint8Array
      ).then((message) => {
        const decoder = decoding.createDecoder(message);
        const messageType = decoding.readVarUint(decoder);

        if (messageType === MESSAGE_SYNC && socket) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, doc, null);

          if (encoding.length(encoder) > 1) {
            socket.send(encoding.toUint8Array(encoder));
          }
          return;
        }

        if (messageType === MESSAGE_AWARENESS) {
          awarenessProtocol.applyAwarenessUpdate(
            awareness,
            decoding.readVarUint8Array(decoder),
            "remote"
          );
        }
      });
    });

    socket.addEventListener("close", () => {
      socket = null;
      clearRemotePresence();
      awareness.setLocalState(null);
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
    clearPresence() {
      if (cursorFlushTimer !== null) {
        clearTimeout(cursorFlushTimer);
        cursorFlushTimer = null;
      }
      pendingCursor = undefined;
      setLocalPresence({
        cursor: null,
        selection: null
      });
    },
    commit,
    connect,
    destroy() {
      destroyed = true;
      onStatus?.("disconnected");
      doc.off("update", handleDocUpdate);
      awareness.off("update", handleAwarenessUpdate);
      if (cursorFlushTimer !== null) {
        clearTimeout(cursorFlushTimer);
      }
      const activeSocket = socket;
      socket = null;
      awareness.setLocalState(null);
      clearRemotePresence();
      activeSocket?.close();
      awareness.destroy();
      doc.destroy();
      listeners.clear();
    },
    getSnapshot() {
      return snapshot;
    },
    setPresenceCursor(cursor) {
      pendingCursor = cursor;

      if (cursorFlushTimer !== null) {
        return;
      }

      cursorFlushTimer = setTimeout(flushPendingCursor, CURSOR_THROTTLE_MS);
    },
    setPresenceSelection(nodeIds) {
      setLocalPresence({
        selection:
          nodeIds.length > 0
            ? {
                nodeIds,
                pageId: input.pageId
              }
            : null
      });
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
