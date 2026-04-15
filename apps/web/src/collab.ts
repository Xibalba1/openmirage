import { createCollabDocumentName } from "@openmirage/types";

export interface PageCollabLocation {
  fileId: string;
  pageId: string;
  workspaceId: string;
}

export function buildPageCollabWebSocketUrl(
  collabWsUrl: string,
  collabWsPath: string,
  location: PageCollabLocation
): string {
  const url = new URL(collabWsPath, collabWsUrl);
  url.searchParams.set("documentName", createCollabDocumentName(location.pageId));
  url.searchParams.set("fileId", location.fileId);
  url.searchParams.set("pageId", location.pageId);
  url.searchParams.set("workspaceId", location.workspaceId);
  return url.toString();
}
