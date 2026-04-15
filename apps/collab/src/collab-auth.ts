import {
  type CollabPageSessionDto,
  createCollabDocumentName
} from "@openmirage/types";

export interface CollabConnectionRequest {
  documentName?: string;
  fileId?: string;
  pageId?: string;
  workspaceId?: string;
}

export interface CollabAuthorizationFailure {
  ok: false;
  reason:
    | "auth-service-unavailable"
    | "forbidden"
    | "invalid-document-name"
    | "missing-page-identity"
    | "not_found"
    | "unauthenticated";
  status: 400 | 401 | 403 | 404 | 503;
}

export interface CollabAuthorizationSuccess {
  ok: true;
  session: CollabPageSessionDto;
}

export type CollabAuthorizationResult =
  | CollabAuthorizationFailure
  | CollabAuthorizationSuccess;

export type FetchLike = typeof fetch;

export function readCollabConnectionRequest(
  requestParameters: URLSearchParams
): CollabConnectionRequest {
  const documentName = requestParameters.get("documentName") ?? undefined;
  const fileId = requestParameters.get("fileId") ?? undefined;
  const pageId = requestParameters.get("pageId") ?? undefined;
  const workspaceId = requestParameters.get("workspaceId") ?? undefined;
  const request: CollabConnectionRequest = {};

  if (documentName) {
    request.documentName = documentName;
  }

  if (fileId) {
    request.fileId = fileId;
  }

  if (pageId) {
    request.pageId = pageId;
  }

  if (workspaceId) {
    request.workspaceId = workspaceId;
  }

  return request;
}

export function buildAuthorizedCollabRequestUrl(input: {
  baseUrl: string;
  fileId: string;
  pageId: string;
  workspaceId: string;
}): string {
  const url = new URL(
    `/internal/collab/pages/${encodeURIComponent(input.pageId)}/session`,
    input.baseUrl
  );
  url.searchParams.set("fileId", input.fileId);
  url.searchParams.set("workspaceId", input.workspaceId);
  return url.toString();
}

export function rewriteRequestUrlWithDocumentName(
  requestUrl: string,
  documentName: string,
  origin: string
): string {
  const url = new URL(requestUrl, origin);
  url.searchParams.set("documentName", documentName);
  return `${url.pathname}${url.search}`;
}

export async function authorizeCollabConnection(
  request: CollabConnectionRequest,
  options: {
    apiBaseUrl: string;
    cookieHeader: string;
    fetchImpl?: FetchLike;
  }
): Promise<CollabAuthorizationResult> {
  if (!request.pageId || !request.fileId || !request.workspaceId) {
    return {
      ok: false,
      reason: "missing-page-identity",
      status: 400
    };
  }

  const canonicalDocumentName = createCollabDocumentName(request.pageId);

  if (request.documentName && request.documentName !== canonicalDocumentName) {
    return {
      ok: false,
      reason: "invalid-document-name",
      status: 400
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(
      buildAuthorizedCollabRequestUrl({
        baseUrl: options.apiBaseUrl,
        fileId: request.fileId,
        pageId: request.pageId,
        workspaceId: request.workspaceId
      }),
      {
        headers: {
          cookie: options.cookieHeader
        }
      }
    );

    if (response.status === 401) {
      return {
        ok: false,
        reason: "unauthenticated",
        status: 401
      };
    }

    if (response.status === 403) {
      return {
        ok: false,
        reason: "forbidden",
        status: 403
      };
    }

    if (response.status === 404) {
      return {
        ok: false,
        reason: "not_found",
        status: 404
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        reason: "auth-service-unavailable",
        status: 503
      };
    }

    return {
      ok: true,
      session: (await response.json()) as CollabPageSessionDto
    };
  } catch {
    return {
      ok: false,
      reason: "auth-service-unavailable",
      status: 503
    };
  }
}
