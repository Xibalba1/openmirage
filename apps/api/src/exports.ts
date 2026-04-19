import {
  createExportJob,
  getAuthorizedAsset,
  getAuthorizedExportJob
} from "@openmirage/db";
import {
  type AuthContext,
  type CreateExportJobInput,
  type ExportJobDto
} from "@openmirage/types";
import { hasWorkspaceMembership } from "./access.js";

interface QueryableDatabase {
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

interface StorageLike {
  read(key: string): Promise<{
    body: Uint8Array;
    contentType?: string;
  }>;
}

export interface ExportJobRouteParams {
  fileId: string;
  jobId: string;
  projectId: string;
  workspaceId: string;
}

export interface CreateExportJobRequest {
  fileId: string;
  format?: unknown;
  pageId?: unknown;
  projectId: string;
  workspaceId: string;
}

export type ExportJobDownloadRequest = ExportJobRouteParams;

export type ExportJobStatusRequest = ExportJobRouteParams;

export interface ExportJobFailureResponse {
  error:
    | "forbidden"
    | "not_found"
    | "not_ready"
    | "unauthenticated";
}

export interface ExportJobBadRequest {
  error:
    | "format must be pdf or png"
    | "pageId is required for png exports"
    | "pageId must be omitted for pdf exports";
}

export interface ExportJobMutationResolution {
  body: ExportJobBadRequest | ExportJobDto | ExportJobFailureResponse;
  status: 202 | 400 | 401 | 403 | 404;
}

export interface ExportJobStatusResolution {
  body: ExportJobDto | ExportJobFailureResponse;
  status: 200 | 401 | 403 | 404;
}

export type ExportJobDownloadResolution =
  | {
      body: {
        body: Uint8Array;
        cacheControl: string;
        contentDisposition: string;
        contentType: string;
      };
      status: 200;
    }
  | {
      body: ExportJobFailureResponse;
      status: 401 | 403 | 404 | 409;
    };

function readPageId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCreateExportJobInput(
  request: CreateExportJobRequest
): CreateExportJobInput | ExportJobBadRequest {
  if (request.format !== "pdf" && request.format !== "png") {
    return {
      error: "format must be pdf or png"
    };
  }

  const pageId = readPageId(request.pageId);

  if (request.format === "png" && !pageId) {
    return {
      error: "pageId is required for png exports"
    };
  }

  if (request.format === "pdf" && pageId) {
    return {
      error: "pageId must be omitted for pdf exports"
    };
  }

  return {
    format: request.format,
    pageId
  };
}

function isMissingStorageObjectError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as Error & { code?: string; name?: string }).code;
  const name = (error as Error & { code?: string; name?: string }).name;

  return (
    code === "ENOENT" ||
    code === "NoSuchKey" ||
    name === "NoSuchKey" ||
    name === "NotFound"
  );
}

function sanitizeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "export"
  );
}

function buildDownloadFilename(job: ExportJobDto, assetFilename: string): string {
  const safeAssetFilename = sanitizeFilename(assetFilename);

  if (safeAssetFilename.includes(".")) {
    return safeAssetFilename;
  }

  const extension = job.format === "pdf" ? "pdf" : "png";
  return `${safeAssetFilename}.${extension}`;
}

export async function resolveCreateExportJobRequest(
  authContext: AuthContext | null,
  request: CreateExportJobRequest,
  databasePool: QueryableDatabase
): Promise<ExportJobMutationResolution> {
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

  const normalized = normalizeCreateExportJobInput(request);

  if ("error" in normalized) {
    return {
      body: normalized,
      status: 400
    };
  }

  const job = await createExportJob(
    authContext.user.id,
    request.workspaceId,
    request.projectId,
    request.fileId,
    normalized,
    databasePool as Parameters<typeof createExportJob>[5]
  );

  if (!job) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  return {
    body: job,
    status: 202
  };
}

export async function resolveGetExportJobRequest(
  authContext: AuthContext | null,
  request: ExportJobStatusRequest,
  databasePool: QueryableDatabase
): Promise<ExportJobStatusResolution> {
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

  const job = await getAuthorizedExportJob(
    authContext.user.id,
    request.workspaceId,
    request.projectId,
    request.fileId,
    request.jobId,
    databasePool as Parameters<typeof getAuthorizedExportJob>[5]
  );

  if (!job) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  return {
    body: job,
    status: 200
  };
}

export async function resolveExportJobDownloadRequest(
  authContext: AuthContext | null,
  request: ExportJobDownloadRequest,
  databasePool: QueryableDatabase,
  storage: StorageLike
): Promise<ExportJobDownloadResolution> {
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

  const job = await getAuthorizedExportJob(
    authContext.user.id,
    request.workspaceId,
    request.projectId,
    request.fileId,
    request.jobId,
    databasePool as Parameters<typeof getAuthorizedExportJob>[5]
  );

  if (!job) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  if (job.status !== "succeeded" || !job.outputAssetId) {
    return {
      body: { error: "not_ready" },
      status: 409
    };
  }

  const asset = await getAuthorizedAsset(
    authContext.user.id,
    request.workspaceId,
    request.projectId,
    request.fileId,
    job.outputAssetId,
    databasePool as Parameters<typeof getAuthorizedAsset>[5]
  );

  if (!asset) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  try {
    const storedObject = await storage.read(asset.storageKey);

    return {
      body: {
        body: storedObject.body,
        cacheControl: "private, max-age=60",
        contentDisposition: `attachment; filename="${buildDownloadFilename(job, asset.filename)}"`,
        contentType:
          asset.mimeType || storedObject.contentType || "application/octet-stream"
      },
      status: 200
    };
  } catch (error) {
    if (isMissingStorageObjectError(error)) {
      return {
        body: { error: "not_found" },
        status: 404
      };
    }

    throw error;
  }
}
