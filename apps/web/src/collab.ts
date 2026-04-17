import { createCollabDocumentName } from "@openmirage/types";

export interface PageCollabLocation {
  fileId: string;
  projectId: string;
  pageId: string;
  shareToken?: string;
  workspaceId: string;
}

export function buildPageCollabSessionUrl(
  apiBaseUrl: string,
  location: PageCollabLocation
): string {
  if (location.shareToken) {
    return new URL(
      `/v1/share-links/${encodeURIComponent(location.shareToken)}/pages/${encodeURIComponent(location.pageId)}/collab-session`,
      apiBaseUrl
    ).toString();
  }

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
  if (location.shareToken) {
    url.searchParams.set("shareToken", location.shareToken);
  }
  url.searchParams.set("workspaceId", location.workspaceId);
  return url.toString();
}
