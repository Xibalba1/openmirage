import assert from "node:assert/strict";
import test from "node:test";
import * as awarenessProtocol from "y-protocols/awareness";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { createEditorSession, writePageDocument } from "./session";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_AUTH = 2;
const MESSAGE_SYNC_REPLY = 4;
const AUTH_TOKEN = 0;
const AUTHENTICATED = 2;

function createDocument() {
  return {
    nodes: {
      rect: {
        cornerRadius: 8,
        createdAt: "2026-04-15T00:00:00.000Z",
        fill: {
          color: { alpha: 1, hex: "#f5a24a" }
        },
        height: 80,
        id: "rect",
        locked: false,
        name: "Rectangle",
        opacity: 1,
        pageId: "page-1",
        parentId: null,
        rotation: 0,
        shadow: null,
        stroke: null,
        type: "rectangle" as const,
        updatedAt: "2026-04-15T00:00:00.000Z",
        visible: true,
        width: 120,
        x: 20,
        y: 30,
        zIndex: 0
      }
    },
    pageId: "page-1",
    rootNodeIds: ["rect"]
  };
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static rooms = new Map<string, FakeRoom>();

  static resetRooms() {
    for (const room of FakeWebSocket.rooms.values()) {
      room.destroy();
    }

    FakeWebSocket.rooms.clear();
  }

  static disconnectAll() {
    for (const room of FakeWebSocket.rooms.values()) {
      room.disconnectAll();
    }
  }

  readonly CLOSED = FakeWebSocket.CLOSED;
  readonly CLOSING = FakeWebSocket.CLOSING;
  readonly CONNECTING = FakeWebSocket.CONNECTING;
  readonly OPEN = FakeWebSocket.OPEN;
  binaryType = "blob";
  readyState = FakeWebSocket.CONNECTING;
  private listeners = new Map<
    string,
    Array<(event?: { data?: Uint8Array }) => void>
  >();

  constructor(private readonly url: string) {
    const room = FakeWebSocket.rooms.get(url) ?? new FakeRoom(url);
    room.add(this);
    FakeWebSocket.rooms.set(url, room);

    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatch("open");
    });
  }

  addEventListener(
    event: string,
    listener: (event?: { data?: Uint8Array }) => void
  ) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }

    this.readyState = FakeWebSocket.CLOSED;
    FakeWebSocket.rooms.get(this.url)?.remove(this);
    this.dispatch("close");
  }

  dispatch(event: string, payload?: { data?: Uint8Array }) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }

  send(data: Uint8Array) {
    if (this.readyState !== FakeWebSocket.OPEN) {
      return;
    }

    FakeWebSocket.rooms.get(this.url)?.receive(this, data);
  }
}

class FakeRoom {
  private readonly sockets = new Set<FakeWebSocket>();
  private readonly doc = new Y.Doc();
  private readonly awareness = new awarenessProtocol.Awareness(this.doc);
  private readonly socketClientIds = new Map<FakeWebSocket, Set<number>>();
  private readonly authenticatedSockets = new Set<FakeWebSocket>();

  constructor(private readonly url: string) {
    writePageDocument(this.doc, createDocument());

    this.doc.on("update", (update, origin) => {
      const message = this.createSyncUpdateMessage(update);

      for (const socket of this.sockets) {
        if (socket.readyState !== FakeWebSocket.OPEN || socket === origin) {
          continue;
        }

        socket.dispatch("message", { data: message });
      }
    });

    this.awareness.on(
      "update",
      (
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
      const message = this.createAwarenessMessage(changedClients);

      if (origin instanceof FakeWebSocket) {
        const tracked = this.socketClientIds.get(origin) ?? new Set<number>();
        added.forEach((clientId: number) => tracked.add(clientId));
        removed.forEach((clientId: number) => tracked.delete(clientId));
        this.socketClientIds.set(origin, tracked);
      }

      for (const socket of this.sockets) {
        if (socket.readyState !== FakeWebSocket.OPEN) {
          continue;
        }

        socket.dispatch("message", { data: message });
      }
      }
    );
  }

  add(socket: FakeWebSocket) {
    this.sockets.add(socket);
    this.socketClientIds.set(socket, new Set<number>());
  }

  disconnectAll() {
    for (const socket of Array.from(this.sockets)) {
      socket.close();
    }
  }

  remove(socket: FakeWebSocket) {
    this.sockets.delete(socket);
    this.authenticatedSockets.delete(socket);
    const clientIds = Array.from(this.socketClientIds.get(socket) ?? []);

    this.socketClientIds.delete(socket);

    if (clientIds.length > 0) {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        clientIds,
        socket
      );
    }

    if (this.sockets.size === 0) {
      this.destroy();
      FakeWebSocket.rooms.delete(this.url);
    }
  }

  destroy() {
    this.awareness.destroy();
    this.doc.destroy();
  }

  receive(sender: FakeWebSocket, data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    const documentName = decoding.readVarString(decoder);
    const messageType = decoding.readVarUint(decoder);

    if (messageType === MESSAGE_AUTH) {
      const authType = decoding.readVarUint(decoder);

      if (authType === AUTH_TOKEN) {
        decoding.readVarString(decoder);
        this.authenticatedSockets.add(sender);
        sender.dispatch("message", {
          data: this.createAuthenticatedMessage(documentName)
        });
      }
      return;
    }

    if (!this.authenticatedSockets.has(sender)) {
      return;
    }

    if (messageType === MESSAGE_SYNC || messageType === MESSAGE_SYNC_REPLY) {
      const encoder = encoding.createEncoder();
      encoding.writeVarString(encoder, documentName);
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, sender);

      if (encoding.length(encoder) > this.minSyncMessageLength(documentName)) {
        sender.dispatch("message", { data: encoding.toUint8Array(encoder) });
      }

      return;
    }

    if (messageType === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(decoder),
        sender
      );
    }
  }

  private createSyncUpdateMessage(update: Uint8Array): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarString(encoder, "page:page-1");
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    return encoding.toUint8Array(encoder);
  }

  private createAwarenessMessage(changedClients: number[]): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarString(encoder, "page:page-1");
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
    );
    return encoding.toUint8Array(encoder);
  }

  private createAuthenticatedMessage(documentName: string): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarString(encoder, documentName);
    encoding.writeVarUint(encoder, MESSAGE_AUTH);
    encoding.writeVarUint(encoder, AUTHENTICATED);
    encoding.writeVarString(encoder, "read-write");
    return encoding.toUint8Array(encoder);
  }

  private minSyncMessageLength(documentName: string): number {
    const encoder = encoding.createEncoder();
    encoding.writeVarString(encoder, documentName);
    encoding.writeVarUint(encoder, 0);
    return encoding.length(encoder);
  }
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 250
): Promise<void> {
  const startedAt = Date.now();

  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }

    await flushMicrotasks();
  }
}

test("editor session commit, undo, and redo track one local command at a time", () => {
  const doc = new Y.Doc();
  writePageDocument(doc, createDocument());
  const session = createEditorSession({ doc, pageId: "page-1" });

  try {
    assert.equal(session.getSnapshot().canUndo, false);
    assert.equal(
      session.commit({
        pageId: "page-1",
        type: "move-node",
        updates: [
          {
            height: 80,
            nodeId: "rect",
            width: 120,
            x: 80,
            y: 90
          }
        ]
      }),
      true
    );
    assert.equal(session.getSnapshot().document.nodes.rect?.x, 80);
    assert.equal(session.getSnapshot().canUndo, true);
    assert.equal(session.undo(), true);
    assert.equal(session.getSnapshot().document.nodes.rect?.x, 20);
    assert.equal(session.getSnapshot().canRedo, true);
    assert.equal(session.redo(), true);
    assert.equal(session.getSnapshot().document.nodes.rect?.x, 80);
  } finally {
    session.destroy();
  }
});

test("remote document updates refresh the snapshot without adding local history", () => {
  const doc = new Y.Doc();
  writePageDocument(doc, createDocument());
  const session = createEditorSession({ doc, pageId: "page-1" });

  try {
    session.commit({
      pageId: "page-1",
      type: "move-node",
      updates: [
        {
          height: 80,
          nodeId: "rect",
          width: 120,
          x: 60,
          y: 70
        }
      ]
    });
    writePageDocument(doc, {
      ...createDocument(),
      nodes: {
        rect: {
          ...createDocument().nodes.rect,
          x: 140,
          y: 150
        }
      }
    });

    assert.equal(session.getSnapshot().document.nodes.rect?.x, 140);
    assert.equal(session.getSnapshot().canUndo, true);
    assert.equal(session.getSnapshot().canRedo, false);
  } finally {
    session.destroy();
  }
});

test("committed document changes sync to another connected session", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  const first = createEditorSession({
    pageId: "page-1",
    transport: {
      collabWsPath: "/collab",
      collabWsUrl: "ws://example.test",
      location: {
        fileId: "file-1",
        pageId: "page-1",
        workspaceId: "workspace-1"
      }
    }
  });
  const second = createEditorSession({
    pageId: "page-1",
    transport: {
      collabWsPath: "/collab",
      collabWsUrl: "ws://example.test",
      location: {
        fileId: "file-1",
        pageId: "page-1",
        workspaceId: "workspace-1"
      }
    }
  });

  try {
    first.connect();
    second.connect();
    await waitFor(() => {
      return (
        first.getSnapshot().document.nodes.rect?.x === 20 &&
        second.getSnapshot().document.nodes.rect?.x === 20
      );
    });

    first.commit({
      pageId: "page-1",
      type: "move-node",
      updates: [
        {
          height: 80,
          nodeId: "rect",
          width: 120,
          x: 200,
          y: 210
        }
      ]
    });
    await waitFor(() => {
      return (
        second.getSnapshot().document.nodes.rect?.x === 200 &&
        second.getSnapshot().document.nodes.rect?.y === 210
      );
    });

    assert.equal(second.getSnapshot().document.nodes.rect?.x, 200);
    assert.equal(second.getSnapshot().document.nodes.rect?.y, 210);
    assert.equal(second.getSnapshot().canUndo, false);
  } finally {
    first.destroy();
    second.destroy();
    FakeWebSocket.resetRooms();
    globalThis.WebSocket = originalWebSocket;
  }
});

test("awareness publishes remote presence without affecting undo history", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  const first = createEditorSession({
    pageId: "page-1",
    presence: {
      participant: {
        avatarUrl: null,
        color: "#f97316",
        displayName: "First User",
        userId: "user-1"
      }
    },
    transport: {
      collabWsPath: "/collab",
      collabWsUrl: "ws://example.test",
      location: {
        fileId: "file-1",
        pageId: "page-1",
        workspaceId: "workspace-1"
      }
    }
  });
  const second = createEditorSession({
    pageId: "page-1",
    presence: {
      participant: {
        avatarUrl: null,
        color: "#06b6d4",
        displayName: "Second User",
        userId: "user-2"
      }
    },
    transport: {
      collabWsPath: "/collab",
      collabWsUrl: "ws://example.test",
      location: {
        fileId: "file-1",
        pageId: "page-1",
        workspaceId: "workspace-1"
      }
    }
  });

  try {
    first.connect();
    second.connect();
    await flushMicrotasks();

    first.setPresenceSelection(["rect"]);
    first.setPresenceCursor({ x: 120, y: 140 });
    await new Promise((resolve) => setTimeout(resolve, 60));

    const secondSnapshot = second.getSnapshot();
    const remoteEntry = secondSnapshot.presenceEntries.find(
      (entry) => entry.payload.participant.userId === "user-1"
    );

    assert.ok(remoteEntry);
    assert.deepEqual(remoteEntry?.payload.selection?.nodeIds, ["rect"]);
    assert.deepEqual(remoteEntry?.payload.cursor, { x: 120, y: 140 });
    assert.equal(secondSnapshot.canUndo, false);
    assert.equal(secondSnapshot.canRedo, false);

    first.clearPresence();
    await flushMicrotasks();
    const firstLocalEntry = first
      .getSnapshot()
      .presenceEntries.find(
        (entry) => entry.clientId === first.getSnapshot().localClientId
      );
    assert.equal(firstLocalEntry?.payload.cursor, null);
    assert.equal(firstLocalEntry?.payload.selection, null);
  } finally {
    first.destroy();
    second.destroy();
    FakeWebSocket.resetRooms();
    globalThis.WebSocket = originalWebSocket;
  }
});

test("session reconnects after an unexpected websocket close", async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  const statuses: Array<"connecting" | "connected" | "disconnected" | "error"> =
    [];
  const session = createEditorSession(
    {
      pageId: "page-1",
      transport: {
        collabWsPath: "/collab",
        collabWsUrl: "ws://example.test",
        location: {
          fileId: "file-1",
          pageId: "page-1",
          workspaceId: "workspace-1"
        }
      }
    },
    (status) => {
      statuses.push(status);
    }
  );

  try {
    session.connect();
    await waitFor(() => statuses.includes("connected"));

    FakeWebSocket.disconnectAll();
    await waitFor(
      () =>
        statuses.some((status, index) => {
          return (
            status === "connected" &&
            statuses.slice(0, index).includes("error")
          );
        }),
      1_500
    );
  } finally {
    session.destroy();
    FakeWebSocket.resetRooms();
    globalThis.WebSocket = originalWebSocket;
  }
});
