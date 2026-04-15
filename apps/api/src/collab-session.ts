import { getAuthorizedCollabPageSession } from "@openmirage/db";
import { type AuthContext, type CollabPageSessionDto } from "@openmirage/types";

export interface CollabPageSessionRequest {
  fileId?: string;
  pageId: string;
  workspaceId?: string;
}

export interface CollabPageSessionResolution {
  body:
    | { error: "forbidden" | "not_found" | "unauthenticated" }
    | CollabPageSessionDto;
  status: 200 | 401 | 403 | 404;
}

interface QueryableDatabase {
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export async function resolveCollabPageSession(
  authContext: AuthContext | null,
  request: CollabPageSessionRequest,
  databasePool: QueryableDatabase
): Promise<CollabPageSessionResolution> {
  if (!authContext) {
    return {
      body: { error: "unauthenticated" },
      status: 401
    };
  }

  if (!request.workspaceId || !request.fileId) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  const hasMembership = authContext.memberships.some(
    (membership) => membership.workspaceId === request.workspaceId
  );

  if (!hasMembership) {
    return {
      body: { error: "forbidden" },
      status: 403
    };
  }

  const session = await getAuthorizedCollabPageSession(
    authContext.user.id,
    request.workspaceId,
    request.fileId,
    request.pageId,
    databasePool as Parameters<typeof getAuthorizedCollabPageSession>[4]
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
