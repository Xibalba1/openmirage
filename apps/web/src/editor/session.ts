import type {
  EditorCommand,
  PageDocumentDto,
  PresencePayload
} from "@openmirage/types";
import { createCollabDocumentName } from "@openmirage/types";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import {
  buildPageCollabSessionUrl,
  buildPageCollabWebSocketUrl,
  type PageCollabLocation
} from "../collab";
import { applyEditorCommand } from "./commands";
import {
  type EditorPresenceEntry,
  type EditorSession,
  type EditorPresenceIdentity,
  type EditorSessionSnapshot,
  type EditorSessionStatus,
  type HistoryEntry,
  type Point
} from "./types";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_AUTH = 2;
const MESSAGE_QUERY_AWARENESS = 3;
const MESSAGE_SYNC_REPLY = 4;
const MESSAGE_CLOSE = 7;
const AUTH_TOKEN = 0;
const AUTH_PERMISSION_DENIED = 1;
const AUTHENTICATED = 2;
const CURSOR_THROTTLE_MS = 50;
const RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 5_000;

interface CollabSessionPreflightSuccess {
  documentName: string;
}

interface CollabSessionPreflightFailure {
  reason: string;
  retryable: boolean;
}

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

function writeSyncUpdateMessage(
  documentName: string,
  update: Uint8Array
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

function writeAwarenessMessage(
  documentName: string,
  awareness: awarenessProtocol.Awareness,
  clientIds: number[]
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, clientIds)
  );
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
        apiBaseUrl?: string;
        collabWsPath: string;
        collabWsUrl: string;
        location: PageCollabLocation;
      }
    | undefined;
}

async function resolveCollabSessionPreflight(input: {
  apiBaseUrl: string;
  location: PageCollabLocation;
}): Promise<CollabSessionPreflightFailure | CollabSessionPreflightSuccess> {
  try {
    const response = await fetch(
      buildPageCollabSessionUrl(input.apiBaseUrl, input.location),
      {
        credentials: "include",
        method: "GET"
      }
    );

    if (response.ok) {
      const payload = (await response.json()) as { documentName?: string };
      return {
        documentName:
          typeof payload.documentName === "string"
            ? payload.documentName
            : createCollabDocumentName(input.location.pageId)
      };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };

    return {
      reason: payload.error ?? `http_${response.status}`,
      retryable: response.status >= 500
    };
  } catch {
    return {
      reason: "network_error",
      retryable: true
    };
  }
}

export function createEditorSession(
  input: SessionInput,
  onStatus?: (status: EditorSessionStatus) => void
): EditorSession {
  const doc = input.doc ?? new Y.Doc();
  const documentName = createCollabDocumentName(input.pageId);
  const minSyncMessageLength = getFramedSyncMessageLength(documentName);
  const awareness = new awarenessProtocol.Awareness(doc);
  const listeners = new Set<(snapshot: EditorSessionSnapshot) => void>();
  const past: HistoryEntry[] = [];
  const future: HistoryEntry[] = [];
  let socket: WebSocket | null = null;
  let destroyed = false;
  let cursorFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingCursor: Point | null | undefined;
  let isSocketAuthenticated = false;
  let isBootstrapping = false;
  let authDenied = false;
  let attemptCount = 0;
  let lastFailureReason: string | null = null;
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

  const emitStatus = (state: EditorSessionStatus["state"]) => {
    onStatus?.({
      attemptCount,
      lastFailureReason,
      state
    });
  };

  const handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (
      origin !== "remote" &&
      socket &&
      socket.readyState === WebSocket.OPEN &&
      isSocketAuthenticated
    ) {
      socket.send(writeSyncUpdateMessage(documentName, update));
    }

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
      socket.readyState === WebSocket.OPEN &&
      isSocketAuthenticated
    ) {
      socket.send(
        writeAwarenessMessage(documentName, awareness, changedClients)
      );
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

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (destroyed || !input.transport || reconnectTimer !== null || authDenied) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, Math.min(RECONNECT_DELAY_MS * Math.max(attemptCount, 1), MAX_RECONNECT_DELAY_MS));
  }

  function sendInitialSync(activeSocket: WebSocket): void {
    if (!isSocketAuthenticated || activeSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (awareness.getLocalState()) {
      activeSocket.send(
        writeAwarenessMessage(documentName, awareness, [doc.clientID])
      );
    }
    activeSocket.send(
      writeSyncMessage(documentName, doc, (encoder) => {
        syncProtocol.writeSyncStep1(encoder, doc);
      })
    );
  }

  function connect(): void {
    if (destroyed || !input.transport || socket || isBootstrapping) {
      return;
    }

    const transport = input.transport;
    clearReconnectTimer();
    authDenied = false;
    isSocketAuthenticated = false;
    attemptCount += 1;
    emitStatus(attemptCount === 1 ? "connecting" : "retrying");
    isBootstrapping = true;

    void (async () => {
      const preflight =
        transport.apiBaseUrl
          ? await resolveCollabSessionPreflight({
              apiBaseUrl: transport.apiBaseUrl,
              location: transport.location
            })
          : {
              documentName
            };

      if (destroyed) {
        isBootstrapping = false;
        return;
      }

      if ("reason" in preflight) {
        isBootstrapping = false;
        lastFailureReason = preflight.reason;

        if (preflight.retryable) {
          emitStatus("retrying");
          scheduleReconnect();
          return;
        }

        emitStatus("error");
        return;
      }

      let activeSocket: WebSocket;

      try {
        activeSocket = new WebSocket(
          buildPageCollabWebSocketUrl(
            transport.collabWsUrl,
            transport.collabWsPath,
            transport.location
          )
        );
      } catch {
        isBootstrapping = false;
        socket = null;
        lastFailureReason = "websocket_construction_failed";
        emitStatus("retrying");
        scheduleReconnect();
        return;
      }

      socket = activeSocket;
      isBootstrapping = false;
      activeSocket.binaryType = "arraybuffer";

      activeSocket.addEventListener("open", () => {
        if (socket !== activeSocket) {
          return;
        }

        activeSocket.send(writeAuthMessage(preflight.documentName));
      });

      activeSocket.addEventListener("message", (event) => {
        void readBinaryMessage(event.data as Blob | ArrayBuffer | Uint8Array)
          .then((message) => {
            try {
              const decoder = decoding.createDecoder(message);
              const incomingDocumentName = decoding.readVarString(decoder);

              if (incomingDocumentName !== preflight.documentName) {
                return;
              }

              const messageType = decoding.readVarUint(decoder);

              if (messageType === MESSAGE_AUTH && socket === activeSocket) {
                const authType = decoding.readVarUint(decoder);

                if (authType === AUTH_TOKEN) {
                  activeSocket.send(writeAuthMessage(preflight.documentName));
                  return;
                }

                if (authType === AUTH_PERMISSION_DENIED) {
                  authDenied = true;
                  lastFailureReason = "websocket_auth_denied";
                  emitStatus("error");
                  activeSocket.close();
                  return;
                }

                if (authType === AUTHENTICATED) {
                  isSocketAuthenticated = true;
                  lastFailureReason = null;
                  emitStatus("connected");
                  sendInitialSync(activeSocket);
                }
                return;
              }

              if (
                (messageType === MESSAGE_SYNC ||
                  messageType === MESSAGE_SYNC_REPLY) &&
                socket === activeSocket
              ) {
                const encoder = encoding.createEncoder();
                encoding.writeVarString(encoder, documentName);
                encoding.writeVarUint(encoder, MESSAGE_SYNC);
                syncProtocol.readSyncMessage(decoder, encoder, doc, "remote");

                if (encoding.length(encoder) > minSyncMessageLength) {
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
                return;
              }

              if (
                messageType === MESSAGE_QUERY_AWARENESS &&
                socket === activeSocket &&
                awareness.getLocalState()
              ) {
                activeSocket.send(
                  writeAwarenessMessage(preflight.documentName, awareness, [
                    doc.clientID
                  ])
                );
                return;
              }

              if (messageType === MESSAGE_CLOSE) {
                authDenied = true;
                lastFailureReason = "websocket_closed";
                emitStatus("error");
                activeSocket.close();
              }
            } catch {
              // Ignore malformed websocket frames instead of breaking the session loop.
            }
          })
          .catch(() => undefined);
      });

      activeSocket.addEventListener("close", () => {
        if (socket === activeSocket) {
          socket = null;
        }
        isSocketAuthenticated = false;
        clearRemotePresence();
        if (destroyed) {
          emitStatus("disconnected");
          return;
        }

        if (authDenied) {
          emitStatus("error");
          return;
        }

        lastFailureReason ??= "websocket_closed";
        emitStatus("retrying");
        scheduleReconnect();
      });
      activeSocket.addEventListener("error", () => {
        lastFailureReason = "websocket_error";
      });
    })();
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
      isBootstrapping = false;
      emitStatus("disconnected");
      doc.off("update", handleDocUpdate);
      awareness.off("update", handleAwarenessUpdate);
      clearReconnectTimer();
      if (cursorFlushTimer !== null) {
        clearTimeout(cursorFlushTimer);
      }
      const activeSocket = socket;
      socket = null;
      isSocketAuthenticated = false;
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
