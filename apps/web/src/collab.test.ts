import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPageCollabSessionUrl,
  buildPageCollabWebSocketUrl
} from "./collab";

test("collab urls use public share endpoints when a share token is present", () => {
  assert.equal(
    buildPageCollabSessionUrl("https://api.example.test", {
      fileId: "file-1",
      pageId: "page-1",
      projectId: "project-1",
      shareToken: "share token",
      workspaceId: "workspace-1"
    }),
    "https://api.example.test/v1/share-links/share%20token/pages/page-1/collab-session"
  );

  assert.equal(
    buildPageCollabWebSocketUrl("wss://collab.example.test", "/collab", {
      fileId: "file-1",
      pageId: "page-1",
      projectId: "project-1",
      shareToken: "share token",
      workspaceId: "workspace-1"
    }),
    "wss://collab.example.test/collab?documentName=page%3Apage-1&fileId=file-1&pageId=page-1&shareToken=share+token&workspaceId=workspace-1"
  );
});
