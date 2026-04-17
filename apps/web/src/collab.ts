import { createCollabDocumentName } from "@openmirage/types";

export interface PageCollabLocation {
  fileId: string;
  projectId: string;
  pageId: string;
  workspaceId: string;
}

export function buildPageCollabSessionUrl(
  apiBaseUrl: string,
  location: PageCollabLocation
): string {
  return new URL(
    `/v1/workspaces/${encodeURIComponent(location.workspaceId)}/projects/${encodeURIComponent(location.projectId)}/files/${encodeURIComponent(location.fileId)}/pages/${encodeURIComponent(location.pageId)}/collab-session`,
    apiBaseUrl
  ).toString();
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
