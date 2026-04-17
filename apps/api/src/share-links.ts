import {
  createFileShareLink,
  getSharedCollabPageSession,
  getSharedFileOpenDetails,
  listFileShareLinks,
  revokeFileShareLink
} from "@openmirage/db";
import {
  type AuthContext,
  type CollabPageSessionDto,
  type CreatedShareLinkResponse,
  type ShareLinkDto,
  type ShareLinkListResponse,
  type SharedFileOpenResponse
} from "@openmirage/types";
import { hasWritableWorkspaceAccess } from "./access.js";

interface QueryableDatabase {
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export interface ShareLinkRouteParams {
  fileId: string;
  projectId: string;
  workspaceId: string;
}

export interface RevokeShareLinkRequest extends ShareLinkRouteParams {
  shareLinkId: string;
}

export interface PublicShareLinkRequest {
  pageId?: string;
  token: string;
}

export interface ShareLinkResolution {
  body:
    | CreatedShareLinkResponse
    | ShareLinkDto
    | ShareLinkListResponse
    | SharedFileOpenResponse
    | CollabPageSessionDto
    | { error: "forbidden" | "not_found" | "unauthenticated" };
  status: 200 | 201 | 401 | 403 | 404;
}

function buildShareUrl(appBaseUrl: string, token: string): string | null {
  try {
    return new URL(`/share/${encodeURIComponent(token)}`, appBaseUrl).toString();
  } catch {
    return null;
  }
}

export async function resolveListShareLinksRequest(
  authContext: AuthContext | null,
  request: ShareLinkRouteParams,
  databasePool: QueryableDatabase
): Promise<ShareLinkResolution> {
  if (!authContext) {
    return {
      body: { error: "unauthenticated" },
      status: 401
    };
  }

  if (!hasWritableWorkspaceAccess(authContext, request.workspaceId)) {
    return {
      body: { error: "forbidden" },
      status: 403
    };
  }

  const shareLinks = await listFileShareLinks(
    authContext.user.id,
    request.workspaceId,
    request.projectId,
    request.fileId,
    databasePool as Parameters<typeof listFileShareLinks>[4]
  );

  if (!shareLinks) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  return {
    body: { shareLinks },
    status: 200
  };
}

export async function resolveCreateShareLinkRequest(
  authContext: AuthContext | null,
  request: ShareLinkRouteParams,
  databasePool: QueryableDatabase,
  appBaseUrl: string
): Promise<ShareLinkResolution> {
  if (!authContext) {
    return {
      body: { error: "unauthenticated" },
      status: 401
    };
  }

  if (!hasWritableWorkspaceAccess(authContext, request.workspaceId)) {
    return {
      body: { error: "forbidden" },
      status: 403
    };
  }

  const created = await createFileShareLink(
    authContext.user.id,
    request.workspaceId,
    request.projectId,
    request.fileId,
    databasePool as Parameters<typeof createFileShareLink>[4]
  );

  if (!created) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  return {
    body: {
      shareLink: {
        ...created.shareLink,
        shareUrl: buildShareUrl(appBaseUrl, created.token)
      },
      token: created.token
    },
    status: 201
  };
}

export async function resolveRevokeShareLinkRequest(
  authContext: AuthContext | null,
  request: RevokeShareLinkRequest,
  databasePool: QueryableDatabase
): Promise<ShareLinkResolution> {
  if (!authContext) {
    return {
      body: { error: "unauthenticated" },
      status: 401
    };
  }

  if (!hasWritableWorkspaceAccess(authContext, request.workspaceId)) {
    return {
      body: { error: "forbidden" },
      status: 403
    };
  }

  const shareLink = await revokeFileShareLink(
    authContext.user.id,
    request.workspaceId,
    request.projectId,
    request.fileId,
    request.shareLinkId,
    databasePool as Parameters<typeof revokeFileShareLink>[5]
  );

  if (!shareLink) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  return {
    body: shareLink,
    status: 200
  };
}

export async function resolvePublicShareLinkRequest(
  request: PublicShareLinkRequest,
  databasePool: QueryableDatabase
): Promise<ShareLinkResolution> {
  const sharedFile = await getSharedFileOpenDetails(
    request.token,
    databasePool as Parameters<typeof getSharedFileOpenDetails>[1]
  );

  if (!sharedFile) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  if (
    request.pageId &&
    !sharedFile.pages.some((page) => page.id === request.pageId)
  ) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  return {
    body: {
      ...sharedFile,
      defaultPageId: request.pageId ?? sharedFile.defaultPageId
    },
    status: 200
  };
}

export async function resolvePublicShareCollabSessionRequest(
  request: Required<PublicShareLinkRequest>,
  databasePool: QueryableDatabase
): Promise<ShareLinkResolution> {
  const session = await getSharedCollabPageSession(
    request.token,
    request.pageId,
    databasePool as Parameters<typeof getSharedCollabPageSession>[2]
  );

  if (!session) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  return {
    body: session,
    status: 200
  };
}
