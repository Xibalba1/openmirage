import { randomUUID } from "node:crypto";
import { createAsset, getAuthorizedAsset, listAssets } from "@openmirage/db";
import {
  type AssetDto,
  type AssetRecordDto,
  type AssetScope,
  type AuthContext,
  type CreateAssetInput,
  type ListAssetsResponse
} from "@openmirage/types";

const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_MULTIPART_BODY_BYTES = MAX_IMAGE_UPLOAD_BYTES + 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp"
]);
const CRLF = Buffer.from("\r\n");
const HEADER_DELIMITER = Buffer.from("\r\n\r\n");

interface QueryableDatabase {
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

interface StorageLike {
  delete(key: string): Promise<unknown>;
  put(input: {
    body: Uint8Array;
    contentType?: string;
    key: string;
  }): Promise<unknown>;
  read(key: string): Promise<{
    body: Uint8Array;
    contentType?: string;
  }>;
  resolveDownloadUrl(key: string): Promise<string>;
}

export interface UploadAssetFile {
  body: Uint8Array;
  filename: string;
  mimeType: string;
}

export interface ParsedMultipartUpload {
  fields: Record<string, string>;
  files: UploadAssetFile[];
}

export interface ListAssetsRequest {
  fileId: string;
  includeWorkspaceAssets?: boolean;
  projectId: string;
  workspaceId: string;
}

export interface CreateAssetRequest {
  file?: UploadAssetFile | null;
  fileId: string;
  projectId: string;
  scope?: unknown;
  workspaceId: string;
}

export interface AssetContentRequest {
  assetId: string;
  fileId: string;
  projectId: string;
  workspaceId: string;
}

export interface AssetResponseContext {
  appBaseUrl: string;
  storageProvider: string;
}

export interface AssetBadRequest {
  error:
    | "content-type must be multipart/form-data"
    | "file is required"
    | "file must be 10 MB or smaller"
    | "file must be an image/png, image/jpeg, image/webp, or image/gif"
    | "file must contain a valid raster image matching the declared type"
    | "scope must be file or workspace"
    | "upload filename is required";
}

export interface AssetListResolution {
  body:
    | AssetBadRequest
    | ListAssetsResponse
    | { error: "forbidden" | "not_found" | "unauthenticated" };
  status: 200 | 400 | 401 | 403 | 404;
}

export interface AssetMutationResolution {
  body:
    | AssetBadRequest
    | AssetRecordDto
    | { error: "forbidden" | "not_found" | "unauthenticated" };
  status: 201 | 400 | 401 | 403 | 404;
}

export type AssetContentResolution =
  | {
      body: {
        body: Uint8Array;
        cacheControl: string;
        contentType: string;
      };
      status: 200;
    }
  | {
      body: { error: "forbidden" | "not_found" | "unauthenticated" };
      status: 401 | 403 | 404;
    };

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

function normalizeScope(value: unknown): AssetScope | null {
  if (value === undefined || value === null || value === "") {
    return "file";
  }

  return value === "file" || value === "workspace" ? value : null;
}

function sanitizeStorageFilename(filename: string): string {
  return filename
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "upload";
}

function createApiUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

function buildStorageKey(input: {
  assetId: string;
  fileId: string;
  filename: string;
  scope: AssetScope;
  workspaceId: string;
}): string {
  const safeFilename = sanitizeStorageFilename(input.filename);

  if (input.scope === "workspace") {
    return `workspaces/${input.workspaceId}/assets/${input.assetId}/${safeFilename}`;
  }

  return `workspaces/${input.workspaceId}/files/${input.fileId}/assets/${input.assetId}/${safeFilename}`;
}

export function buildAssetContentPath(input: AssetContentRequest): string {
  return `/v1/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/files/${encodeURIComponent(input.fileId)}/assets/${encodeURIComponent(input.assetId)}/content`;
}

function readByte(body: Uint8Array, index: number): number {
  return body[index] ?? 0;
}

function readPngDimensions(body: Uint8Array) {
  if (
    body.length < 24 ||
    body[0] !== 0x89 ||
    body[1] !== 0x50 ||
    body[2] !== 0x4e ||
    body[3] !== 0x47
  ) {
    return null;
  }

  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return {
    height: view.getUint32(20),
    width: view.getUint32(16)
  };
}

function readGifDimensions(body: Uint8Array) {
  if (body.length < 10) {
    return null;
  }

  const signature = Buffer.from(body.slice(0, 6)).toString("ascii");

  if (signature !== "GIF87a" && signature !== "GIF89a") {
    return null;
  }

  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return {
    height: view.getUint16(8, true),
    width: view.getUint16(6, true)
  };
}

function readJpegDimensions(body: Uint8Array) {
  if (body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8) {
    return null;
  }

  let offset = 2;

  while (offset + 3 < body.length) {
    if (body[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = readByte(body, offset + 1);
    offset += 2;

    if (
      marker === 0x01 ||
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }

    if (offset + 1 >= body.length) {
      break;
    }

    const length = (readByte(body, offset) << 8) | readByte(body, offset + 1);

    if (length < 2 || offset + length > body.length) {
      break;
    }

    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    ) {
      return {
        height:
          (readByte(body, offset + 3) << 8) | readByte(body, offset + 4),
        width:
          (readByte(body, offset + 5) << 8) | readByte(body, offset + 6)
      };
    }

    offset += length;
  }

  return null;
}

function readWebpDimensions(body: Uint8Array) {
  if (
    body.length < 30 ||
    Buffer.from(body.slice(0, 4)).toString("ascii") !== "RIFF" ||
    Buffer.from(body.slice(8, 12)).toString("ascii") !== "WEBP"
  ) {
    return null;
  }

  const chunkType = Buffer.from(body.slice(12, 16)).toString("ascii");

  if (chunkType === "VP8X") {
    return {
      height:
        1 +
        readByte(body, 27) +
        (readByte(body, 28) << 8) +
        (readByte(body, 29) << 16),
      width:
        1 +
        readByte(body, 24) +
        (readByte(body, 25) << 8) +
        (readByte(body, 26) << 16)
    };
  }

  if (chunkType === "VP8L" && body.length >= 25) {
    const b0 = body[21] ?? 0;
    const b1 = body[22] ?? 0;
    const b2 = body[23] ?? 0;
    const b3 = body[24] ?? 0;

    return {
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      width: 1 + (((b1 & 0x3f) << 8) | b0)
    };
  }

  if (chunkType === "VP8 " && body.length >= 30) {
    return {
      height: ((readByte(body, 29) & 0x3f) << 8) | readByte(body, 28),
      width: ((readByte(body, 27) & 0x3f) << 8) | readByte(body, 26)
    };
  }

  return null;
}

export function detectRasterImageMimeType(body: Uint8Array): string | null {
  if (
    body.length >= 8 &&
    body[0] === 0x89 &&
    body[1] === 0x50 &&
    body[2] === 0x4e &&
    body[3] === 0x47 &&
    body[4] === 0x0d &&
    body[5] === 0x0a &&
    body[6] === 0x1a &&
    body[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    body.length >= 6 &&
    (Buffer.from(body.slice(0, 6)).toString("ascii") === "GIF87a" ||
      Buffer.from(body.slice(0, 6)).toString("ascii") === "GIF89a")
  ) {
    return "image/gif";
  }

  if (body.length >= 2 && body[0] === 0xff && body[1] === 0xd8) {
    return "image/jpeg";
  }

  if (
    body.length >= 12 &&
    Buffer.from(body.slice(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(body.slice(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

export function readImageDimensions(
  body: Uint8Array,
  mimeType: string
): { height: number | null; width: number | null } {
  const dimensions =
    (mimeType === "image/png" ? readPngDimensions(body) : null) ??
    (mimeType === "image/gif" ? readGifDimensions(body) : null) ??
    (mimeType === "image/jpeg" ? readJpegDimensions(body) : null) ??
    (mimeType === "image/webp" ? readWebpDimensions(body) : null);

  return {
    height: dimensions?.height ?? null,
    width: dimensions?.width ?? null
  };
}

async function readRequestBody(
  stream: NodeJS.ReadableStream,
  limitBytes: number
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > limitBytes) {
      throw new Error("payload_too_large");
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function readMultipartBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match?.[1] ?? match?.[2] ?? null;
}

function parsePartHeaders(source: string): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const line of source.split("\r\n")) {
    const separatorIndex = line.indexOf(":");

    if (separatorIndex <= 0) {
      continue;
    }

    headers[line.slice(0, separatorIndex).trim().toLowerCase()] = line
      .slice(separatorIndex + 1)
      .trim();
  }

  return headers;
}

function parseContentDisposition(
  value: string | undefined
): { filename: string | null; name: string | null } {
  if (!value) {
    return {
      filename: null,
      name: null
    };
  }

  const nameMatch = value.match(/name="([^"]+)"/i);
  const filenameMatch = value.match(/filename="([^"]*)"/i);

  return {
    filename: filenameMatch?.[1] ?? null,
    name: nameMatch?.[1] ?? null
  };
}

export async function parseMultipartUpload(input: {
  contentTypeHeader: string | undefined;
  stream: NodeJS.ReadableStream;
}): Promise<ParsedMultipartUpload> {
  if (!input.contentTypeHeader?.includes("multipart/form-data")) {
    const error = new Error("invalid_content_type");
    (error as Error & { code?: string }).code = "invalid_content_type";
    throw error;
  }

  const boundary = readMultipartBoundary(input.contentTypeHeader);

  if (!boundary) {
    const error = new Error("invalid_content_type");
    (error as Error & { code?: string }).code = "invalid_content_type";
    throw error;
  }

  const body = await readRequestBody(input.stream, MAX_MULTIPART_BODY_BYTES);
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  let cursor = body.indexOf(boundaryBuffer);
  const fields: Record<string, string> = {};
  const files: UploadAssetFile[] = [];

  while (cursor !== -1) {
    cursor += boundaryBuffer.byteLength;

    if (
      readByte(body, cursor) === 0x2d &&
      readByte(body, cursor + 1) === 0x2d
    ) {
      break;
    }

    if (
      readByte(body, cursor) === CRLF[0] &&
      readByte(body, cursor + 1) === CRLF[1]
    ) {
      cursor += CRLF.byteLength;
    }

    const nextBoundary = body.indexOf(Buffer.from(`\r\n--${boundary}`), cursor);

    if (nextBoundary === -1) {
      break;
    }

    const part = body.slice(cursor, nextBoundary);
    const headerEnd = part.indexOf(HEADER_DELIMITER);

    if (headerEnd !== -1) {
      const headers = parsePartHeaders(part.slice(0, headerEnd).toString("utf8"));
      const disposition = parseContentDisposition(headers["content-disposition"]);
      const content = part.slice(headerEnd + HEADER_DELIMITER.byteLength);
      const fieldName = disposition.name;

      if (fieldName) {
        if (disposition.filename !== null) {
          files.push({
            body: new Uint8Array(
              content.buffer,
              content.byteOffset,
              content.byteLength
            ),
            filename: disposition.filename,
            mimeType: headers["content-type"] ?? "application/octet-stream"
          });
        } else {
          fields[fieldName] = content.toString("utf8");
        }
      }
    }

    cursor = nextBoundary + CRLF.byteLength;
  }

  return {
    fields,
    files
  };
}

function hasPositiveDimensions(dimensions: {
  height: number | null;
  width: number | null;
}): boolean {
  return (
    typeof dimensions.width === "number" &&
    dimensions.width > 0 &&
    typeof dimensions.height === "number" &&
    dimensions.height > 0
  );
}

async function resolveAssetContentUrl(
  asset: AssetDto,
  request: Pick<AssetContentRequest, "fileId" | "projectId" | "workspaceId">,
  storage: StorageLike,
  context: AssetResponseContext
): Promise<string> {
  if (context.storageProvider === "local") {
    return createApiUrl(
      context.appBaseUrl,
      buildAssetContentPath({
        assetId: asset.id,
        fileId: request.fileId,
        projectId: request.projectId,
        workspaceId: request.workspaceId
      })
    );
  }

  return storage.resolveDownloadUrl(asset.storageKey);
}

async function mapAssetRecord(
  asset: AssetDto,
  request: Pick<AssetContentRequest, "fileId" | "projectId" | "workspaceId">,
  storage: StorageLike,
  context: AssetResponseContext
): Promise<AssetRecordDto> {
  return {
    ...asset,
    contentUrl: await resolveAssetContentUrl(asset, request, storage, context)
  };
}

function normalizeCreateAssetInput(
  request: CreateAssetRequest
):
  | AssetBadRequest
  | { file: UploadAssetFile; scope: AssetScope } {
  const scope = normalizeScope(request.scope);

  if (!scope) {
    return {
      error: "scope must be file or workspace"
    };
  }

  const file = request.file;

  if (!file) {
    return {
      error: "file is required"
    };
  }

  if (!readNonEmptyString(file.filename)) {
    return {
      error: "upload filename is required"
    };
  }

  if (file.body.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
    return {
      error: "file must be 10 MB or smaller"
    };
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimeType)) {
    return {
      error: "file must be an image/png, image/jpeg, image/webp, or image/gif"
    };
  }

  return {
    file,
    scope
  };
}

export async function resolveListAssetsRequest(
  authContext: AuthContext | null,
  request: ListAssetsRequest,
  databasePool: QueryableDatabase,
  storage: StorageLike,
  context: AssetResponseContext
): Promise<AssetListResolution> {
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

  const assets = await listAssets(
    authContext.user.id,
    request.workspaceId,
    request.projectId,
    {
      fileId: request.fileId,
      ...(request.includeWorkspaceAssets === undefined
        ? {}
        : { includeWorkspaceAssets: request.includeWorkspaceAssets })
    },
    databasePool as Parameters<typeof listAssets>[4]
  );

  if (!assets) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  return {
    body: {
      assets: await Promise.all(
        assets.map((asset) => mapAssetRecord(asset, request, storage, context))
      )
    },
    status: 200
  };
}

export async function resolveCreateAssetRequest(
  authContext: AuthContext | null,
  request: CreateAssetRequest,
  databasePool: QueryableDatabase,
  storage: StorageLike,
  context: AssetResponseContext
): Promise<AssetMutationResolution> {
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

  const normalized = normalizeCreateAssetInput(request);

  if ("error" in normalized) {
    return {
      body: normalized,
      status: 400
    };
  }

  const visibilityCheck = await listAssets(
    authContext.user.id,
    request.workspaceId,
    request.projectId,
    {
      fileId: request.fileId,
      includeWorkspaceAssets: false
    },
    databasePool as Parameters<typeof listAssets>[4]
  );

  if (!visibilityCheck) {
    return {
      body: { error: "not_found" },
      status: 404
    };
  }

  const assetId = randomUUID();
  const detectedMimeType = detectRasterImageMimeType(normalized.file.body);

  if (detectedMimeType !== normalized.file.mimeType) {
    return {
      body: {
        error: "file must contain a valid raster image matching the declared type"
      },
      status: 400
    };
  }

  const dimensions = readImageDimensions(normalized.file.body, detectedMimeType);

  if (!hasPositiveDimensions(dimensions)) {
    return {
      body: {
        error: "file must contain a valid raster image matching the declared type"
      },
      status: 400
    };
  }

  const storageKey = buildStorageKey({
    assetId,
    fileId: request.fileId,
    filename: normalized.file.filename,
    scope: normalized.scope,
    workspaceId: request.workspaceId
  });

  await storage.put({
    body: normalized.file.body,
    contentType: normalized.file.mimeType,
    key: storageKey
  });

  try {
    const created = await createAsset(
      authContext.user.id,
      request.workspaceId,
      request.projectId,
      request.fileId,
      {
        byteSize: normalized.file.body.byteLength,
        filename: normalized.file.filename,
        height: dimensions.height,
        id: assetId,
        kind: "image",
        mimeType: normalized.file.mimeType,
        scope: normalized.scope,
        storageKey,
        width: dimensions.width
      } satisfies CreateAssetInput,
      databasePool as Parameters<typeof createAsset>[5]
    );

    if (!created) {
      await storage.delete(storageKey).catch(() => undefined);
      return {
        body: { error: "not_found" },
        status: 404
      };
    }

    return {
      body: await mapAssetRecord(
        created,
        {
          fileId: request.fileId,
          projectId: request.projectId,
          workspaceId: request.workspaceId
        },
        storage,
        context
      ),
      status: 201
    };
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
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

export async function resolveAssetContentRequest(
  authContext: AuthContext | null,
  request: AssetContentRequest,
  databasePool: QueryableDatabase,
  storage: StorageLike
): Promise<AssetContentResolution> {
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

  const asset = await getAuthorizedAsset(
    authContext.user.id,
    request.workspaceId,
    request.projectId,
    request.fileId,
    request.assetId,
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
