import { createComment, listComments, resolveComment } from "@openmirage/db";
import {
  type AuthContext,
  type CommentDto,
  type CreateCommentInput,
  type ListCommentsInput,
  type ResolveCommentInput
} from "@openmirage/types";

interface QueryableDatabase {
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export interface CommentRouteParams {
  fileId: string;
  projectId: string;
  workspaceId: string;
}

export interface ListCommentsRequest extends CommentRouteParams {
  includeResolved?: unknown;
  pageId?: unknown;
}

export interface CreateCommentRequest extends CommentRouteParams {
  body?: unknown;
}

export interface ResolveCommentRequest extends CommentRouteParams {
  commentId: string;
}

export interface CommentBadRequest {
  error:
    | "body is required"
    | "file-scoped comments cannot include pageId or nodeId"
    | "includeResolved must be true or false"
    | "node-scoped comments require pageId and nodeId"
    | "page-scoped comments require pageId and cannot include nodeId"
    | "target is required"
    | "target.fileId must match the route fileId"
    | "target.type must be file, page, or node";
}

export interface CommentListResolution {
  body:
    | CommentBadRequest
    | { comments: CommentDto[] }
    | { error: "forbidden" | "not_found" | "unauthenticated" };
  status: 200 | 400 | 401 | 403 | 404;
}

export interface CommentMutationResolution {
  body:
    | CommentBadRequest
    | CommentDto
    | { error: "forbidden" | "not_found" | "unauthenticated" };
  status: 200 | 201 | 400 | 401 | 403 | 404;
}

function hasWorkspaceMembership(
  authContext: AuthContext,
  workspaceId: string
): boolean {
  return authContext.memberships.some(
    (membership) => membership.workspaceId === workspaceId
  );
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeListCommentsInput(
  request: ListCommentsRequest
): ListCommentsInput | CommentBadRequest {
  let includeResolved = false;

  if (typeof request.includeResolved === "string") {
    if (request.includeResolved === "true") {
      includeResolved = true;
    } else if (request.includeResolved === "false") {
      includeResolved = false;
    } else {
      return {
        error: "includeResolved must be true or false"
      };
    }
  } else if (typeof request.includeResolved === "boolean") {
    includeResolved = request.includeResolved;
  } else if (request.includeResolved !== undefined) {
    return {
      error: "includeResolved must be true or false"
    };
  }

  const pageId = readNonEmptyString(request.pageId);

  return {
    fileId: request.fileId,
    includeResolved,
    ...(pageId ? { pageId } : {})
  };
}

function normalizeCreateCommentInput(
  request: CreateCommentRequest
): CreateCommentInput | CommentBadRequest {
  const commentBody = readNonEmptyString(
    (request.body as { body?: unknown } | undefined)?.body
  );

  if (!commentBody) {
    return {
      error: "body is required"
    };
  }

  const target = (
    request.body as { target?: Record<string, unknown> } | undefined
  )?.target;

  if (!target || typeof target !== "object") {
    return {
      error: "target is required"
    };
  }

  const type = readNonEmptyString(target.type);
  const fileId = readNonEmptyString(target.fileId);
  const pageId = readNonEmptyString(target.pageId);
  const nodeId = readNonEmptyString(target.nodeId);

  if (!type || !["file", "page", "node"].includes(type)) {
    return {
      error: "target.type must be file, page, or node"
    };
  }

  if (!fileId || fileId !== request.fileId) {
    return {
      error: "target.fileId must match the route fileId"
    };
  }

  if (type === "file") {
    if (pageId || nodeId) {
      return {
        error: "file-scoped comments cannot include pageId or nodeId"
      };
    }

    return {
      body: commentBody,
      target: {
        fileId,
        type: "file"
      }
    };
  }

  if (type === "page") {
    if (!pageId || nodeId) {
      return {
        error: "page-scoped comments require pageId and cannot include nodeId"
      };
    }

    return {
      body: commentBody,
      target: {
        fileId,
        pageId,
        type: "page"
      }
    };
  }

  if (!pageId || !nodeId) {
    return {
      error: "node-scoped comments require pageId and nodeId"
    };
  }

  return {
    body: commentBody,
    target: {
      fileId,
      nodeId,
      pageId,
      type: "node"
    }
  };
}

export async function resolveListCommentsRequest(
  authContext: AuthContext | null,
  request: ListCommentsRequest,
  databasePool: QueryableDatabase
): Promise<CommentListResolution> {
  if (!authContext) {
    return {
      body: { error: "unauthenticated" },
      status: 401
    };
  }

  if (!hasWorkspaceMembership(authContext, request.workspaceId)) {
    return {
      body: { error: "forbidden" },
      status: 403
    };
  }

  const input = normalizeListCommentsInput(request);

  if ("error" in input) {
    return {
      body: input,
      status: 400
    };
  }

  const comments = await listComments(
    authContext.user.id,
    request.workspaceId,
    request.projectId,
    input,
    databasePool as Parameters<typeof listComments>[4]
  );

  if (!comments) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  return {
    body: { comments },
    status: 200
  };
}

export async function resolveCreateCommentRequest(
  authContext: AuthContext | null,
  request: CreateCommentRequest,
  databasePool: QueryableDatabase
): Promise<CommentMutationResolution> {
  if (!authContext) {
    return {
      body: { error: "unauthenticated" },
      status: 401
    };
  }

  if (!hasWorkspaceMembership(authContext, request.workspaceId)) {
    return {
      body: { error: "forbidden" },
      status: 403
    };
  }

  const input = normalizeCreateCommentInput(request);

  if ("error" in input) {
    return {
      body: input,
      status: 400
    };
  }

  const comment = await createComment(
    authContext.user.id,
    request.workspaceId,
    request.projectId,
    input,
    databasePool as Parameters<typeof createComment>[4]
  );

  if (!comment) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  return {
    body: comment,
    status: 201
  };
}

export async function resolveResolveCommentRequest(
  authContext: AuthContext | null,
  request: ResolveCommentRequest,
  databasePool: QueryableDatabase
): Promise<CommentMutationResolution> {
  if (!authContext) {
    return {
      body: { error: "unauthenticated" },
      status: 401
    };
  }

  if (!hasWorkspaceMembership(authContext, request.workspaceId)) {
    return {
      body: { error: "forbidden" },
      status: 403
    };
  }

  const input: ResolveCommentInput = {
    commentId: request.commentId,
    fileId: request.fileId
  };
  const comment = await resolveComment(
    authContext.user.id,
    request.workspaceId,
    request.projectId,
    input,
    databasePool as Parameters<typeof resolveComment>[4]
  );

  if (!comment) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  return {
    body: comment,
    status: 200
  };
}
