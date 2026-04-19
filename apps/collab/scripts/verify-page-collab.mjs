import WebSocket from "ws";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

const MESSAGE_SYNC = 0;
const MESSAGE_AUTH = 2;
const MESSAGE_SYNC_REPLY = 4;
const AUTH_TOKEN = 0;
const AUTH_PERMISSION_DENIED = 1;
const AUTHENTICATED = 2;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];

    if (!entry?.startsWith("--")) {
      continue;
    }

    const separatorIndex = entry.indexOf("=");

    if (separatorIndex >= 0) {
      options[entry.slice(2, separatorIndex)] = entry.slice(separatorIndex + 1);
      continue;
    }

    const key = entry.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      options[key] = "true";
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return options;
}

function requireOption(options, key) {
  const value = options[key];

  if (typeof value !== "string" || value.length === 0) {
    fail(`missing required option --${key}`);
  }

  return value;
}

function buildCollabUrl(options) {
  const baseUrl = new URL(requireOption(options, "base-url"));
  const collabUrl = new URL("/collab", baseUrl);
  collabUrl.protocol = collabUrl.protocol === "https:" ? "wss:" : "ws:";
  collabUrl.searchParams.set("documentName", requireOption(options, "document-name"));
  collabUrl.searchParams.set("fileId", requireOption(options, "file-id"));
  collabUrl.searchParams.set("pageId", requireOption(options, "page-id"));
  collabUrl.searchParams.set("workspaceId", requireOption(options, "workspace-id"));
  return collabUrl.toString();
}

function writeAuthMessage(documentName, token = "") {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, MESSAGE_AUTH);
  encoding.writeVarUint(encoder, AUTH_TOKEN);
  encoding.writeVarString(encoder, token);
  return encoding.toUint8Array(encoder);
}

function writeSyncStep1Message(documentName, doc) {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, documentName);
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

function runAuthenticatedProbe(options) {
  const documentName = requireOption(options, "document-name");
  const sessionCookie = requireOption(options, "session-cookie");
  const timeoutMs = Number(options.timeout ?? 5_000);
  const holdOpen = options.mode === "hold-authenticated";
  const holdMs = Number(options["hold-ms"] ?? 15_000);
  const doc = new Y.Doc();
  const collabUrl = buildCollabUrl(options);
  let authenticated = false;
  let synced = false;
  let finished = false;
  let holdTimer = null;

  const ws = new WebSocket(collabUrl, {
    headers: {
      Cookie: sessionCookie
    }
  });

  const timer = setTimeout(() => {
    if (finished) {
      return;
    }

    finished = true;
    ws.terminate();
    fail("timeout waiting for authenticated collab sync");
  }, timeoutMs);

  function finish(code, message) {
    if (finished) {
      return;
    }

    finished = true;
    clearTimeout(timer);
    if (holdTimer) {
      clearTimeout(holdTimer);
    }

    if (message) {
      if (code === 0) {
        console.log(message);
      } else {
        console.error(message);
      }
    }

    process.exit(code);
  }

  ws.on("unexpected-response", (_request, response) => {
    finish(1, `unexpected websocket response: ${response.statusCode ?? "unknown"}`);
  });

  ws.on("open", () => {
    ws.send(writeAuthMessage(documentName));
  });

  ws.on("message", (raw) => {
    const message = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const decoder = decoding.createDecoder(message);
    const incomingDocumentName = decoding.readVarString(decoder);

    if (incomingDocumentName !== documentName) {
      return;
    }

    const messageType = decoding.readVarUint(decoder);

    if (messageType === MESSAGE_AUTH) {
      const authType = decoding.readVarUint(decoder);

      if (authType === AUTH_TOKEN) {
        ws.send(writeAuthMessage(documentName));
        return;
      }

      if (authType === AUTH_PERMISSION_DENIED) {
        finish(1, "permission denied during collab auth");
        return;
      }

      if (authType === AUTHENTICATED) {
        authenticated = true;
        ws.send(writeSyncStep1Message(documentName, doc));
        return;
      }

      finish(1, `unexpected auth response type ${String(authType)}`);
      return;
    }

    if (
      authenticated &&
      (messageType === MESSAGE_SYNC || messageType === MESSAGE_SYNC_REPLY)
    ) {
      const encoder = encoding.createEncoder();
      encoding.writeVarString(encoder, documentName);
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, doc, "remote");
      synced = true;

      if (!holdOpen) {
        ws.close();
        return;
      }

      clearTimeout(timer);
      console.log("authenticated collab hold ready");
      holdTimer = setTimeout(() => {
        ws.close();
        finish(0, "authenticated collab hold ok");
      }, holdMs);
    }
  });

  ws.on("error", (error) => {
    finish(1, error.message);
  });

  ws.on("close", () => {
    if (holdOpen && authenticated && synced && finished) {
      return;
    }

    if (authenticated && synced) {
      finish(0, "authenticated collab sync ok");
      return;
    }

    finish(
      1,
      `websocket closed before sync completed (authenticated=${String(authenticated)} synced=${String(synced)})`
    );
  });

  process.on("SIGTERM", () => {
    if (!holdOpen || finished) {
      process.exit(0);
    }

    ws.close();
    finish(authenticated && synced ? 0 : 1, authenticated && synced
      ? "authenticated collab hold interrupted after sync"
      : "authenticated collab hold interrupted before sync");
  });
}

function runUnauthorizedProbe(options) {
  const timeoutMs = Number(options.timeout ?? 5_000);
  const ws = new WebSocket(buildCollabUrl(options));
  let finished = false;

  const timer = setTimeout(() => {
    if (finished) {
      return;
    }

    finished = true;
    ws.terminate();
    fail("timeout waiting for unauthorized collab rejection");
  }, timeoutMs);

  function finish(code, message) {
    if (finished) {
      return;
    }

    finished = true;
    clearTimeout(timer);

    if (message) {
      if (code === 0) {
        console.log(message);
      } else {
        console.error(message);
      }
    }

    process.exit(code);
  }

  ws.on("unexpected-response", (_request, response) => {
    if (response.statusCode === 401) {
      finish(0, "unauthenticated collab rejected with 401");
      return;
    }

    finish(1, `unexpected websocket response: ${response.statusCode ?? "unknown"}`);
  });

  ws.on("open", () => {
    finish(1, "unauthenticated websocket unexpectedly opened");
  });

  ws.on("error", () => {});
  ws.on("close", () => {
    finish(1, "unauthenticated websocket closed without an explicit 401 response");
  });
}

const options = parseArgs(process.argv.slice(2));
const mode = options.mode ?? "authenticated";

if (mode === "authenticated") {
  runAuthenticatedProbe(options);
} else if (mode === "hold-authenticated") {
  runAuthenticatedProbe(options);
} else if (mode === "unauthorized") {
  runUnauthorizedProbe(options);
} else {
  fail(`unsupported mode: ${mode}`);
}
