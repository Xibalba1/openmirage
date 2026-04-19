import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type CreateExportJobInput,
  type AssetDto,
  type CollabPageSessionDto,
  type CommentDto,
  type CreateAssetInput,
  type CreatedShareLinkResponse,
  type ExportJobDto,
  type CreateCommentInput,
  type CreateFilePageInput,
  createEditorAccess,
  type FileDto,
  type FileOpenResponse,
  type ListCommentsInput,
  type ListAssetsInput,
  type PageDto,
  type ProjectDto,
  type ResolveCommentInput,
  type ShareLinkDto,
  type ShareLinkRecordDto,
  type SharedFileOpenResponse,
  type WorkspaceDetailDto,
  type WorkspaceDto,
  createCollabDocumentName
} from "@openmirage/types";
import { type Pool, type PoolClient } from "pg";
import { createDatabasePool } from "./client.js";

interface WorkspaceRow {
  created_at: Date;
  deleted_at: Date | null;
  id: string;
  membership_id: string;
  name: string;
  role: WorkspaceDetailDto["role"];
  slug: string;
  updated_at: Date;
}

interface ProjectRow {
  created_at: Date;
  deleted_at: Date | null;
  description: string | null;
  id: string;
  name: string;
  updated_at: Date;
  workspace_id: string;
}

interface FileRow {
  created_at: Date;
  created_by_user_id: string;
  deleted_at: Date | null;
  description: string | null;
  id: string;
  name: string;
  project_id: string;
  thumbnail_asset_id: string | null;
  updated_at: Date;
  workspace_id: string;
}

interface PageRow {
  background: string | null;
  created_at: Date;
  file_id: string;
  height: number | null;
  id: string;
  name: string;
  order_index: number;
  thumbnail_asset_id: string | null;
  updated_at: Date;
  width: number | null;
}

interface AssetRow {
  byte_size: string | number;
  created_at: Date;
  deleted_at: Date | null;
  file_id: string | null;
  filename: string;
  height: number | null;
  id: string;
  kind: AssetDto["kind"];
  mime_type: string;
  storage_key: string;
  updated_at: Date;
  uploaded_by_user_id: string;
  width: number | null;
  workspace_id: string;
}

interface AuthorizedCollabPageRow {
  file_id: string;
  page_id: string;
  role: WorkspaceDetailDto["role"];
  user_avatar_url: string | null;
  user_display_name: string;
  user_email: string;
  user_id: string;
  workspace_id: string;
}

interface ShareLinkRow {
  created_at: Date;
  created_by_user_id: string;
  expires_at: Date | null;
  file_id: string;
  id: string;
  revoked_at: Date | null;
}

interface ShareLinkAccessRow {
  file_created_at: Date;
  file_created_by_user_id: string;
  file_deleted_at: Date | null;
  file_description: string | null;
  file_id: string;
  file_name: string;
  file_project_id: string;
  file_updated_at: Date;
  file_workspace_id: string;
  project_created_at: Date;
  project_deleted_at: Date | null;
  project_description: string | null;
  project_id: string;
  project_name: string;
  project_updated_at: Date;
  project_workspace_id: string;
  share_link_id: string;
  workspace_created_at: Date;
  workspace_deleted_at: Date | null;
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  workspace_updated_at: Date;
}

interface CommentRow {
  author_avatar_url: string | null;
  author_display_name: string;
  author_user_id: string;
  body: string;
  created_at: Date;
  deleted_at: Date | null;
  file_id: string;
  id: string;
  node_id: string | null;
  page_id: string | null;
  resolved_at: Date | null;
  updated_at: Date;
}

interface ExportJobRow {
  completed_at: Date | null;
  created_at: Date;
  error_message: string | null;
  file_id: string;
  format: "jpeg" | "pdf" | "png" | "svg";
  id: string;
  output_asset_id: string | null;
  page_id: string | null;
  requested_by_user_id: string;
  started_at: Date | null;
  status: "cancelled" | "failed" | "queued" | "running" | "succeeded";
  updated_at: Date;
}

interface ClaimedExportJobRow extends ExportJobRow {
  file_created_at: Date;
  file_created_by_user_id: string;
  file_deleted_at: Date | null;
  file_description: string | null;
  file_name: string;
  file_project_id: string;
  file_thumbnail_asset_id: string | null;
  file_updated_at: Date;
  file_workspace_id: string;
}

interface PageThumbnailCandidateRow extends PageRow {
  file_created_at: Date;
  file_created_by_user_id: string;
  file_deleted_at: Date | null;
  file_description: string | null;
  file_name: string;
  file_project_id: string;
  file_thumbnail_asset_id: string | null;
  file_updated_at: Date;
  file_workspace_id: string;
}

function mapWorkspace(row: WorkspaceRow): WorkspaceDetailDto {
  return {
    createdAt: row.created_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
    id: row.id,
    membershipId: row.membership_id,
    name: row.name,
    role: row.role,
    slug: row.slug,
    updatedAt: row.updated_at.toISOString()
  };
}

function mapProject(row: ProjectRow): ProjectDto {
  return {
    createdAt: row.created_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
    description: row.description,
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at.toISOString(),
    workspaceId: row.workspace_id
  };
}

function mapFile(row: FileRow): FileDto {
  return {
    createdAt: row.created_at.toISOString(),
    createdByUserId: row.created_by_user_id,
    deletedAt: row.deleted_at?.toISOString() ?? null,
    description: row.description,
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    updatedAt: row.updated_at.toISOString(),
    workspaceId: row.workspace_id
  };
}

function mapPage(row: PageRow): PageDto {
  return {
    background: row.background,
    createdAt: row.created_at.toISOString(),
    fileId: row.file_id,
    height: row.height,
    id: row.id,
    name: row.name,
    orderIndex: row.order_index,
    updatedAt: row.updated_at.toISOString(),
    width: row.width
  };
}

function mapAsset(row: AssetRow): AssetDto {
  return {
    byteSize: Number(row.byte_size),
    createdAt: row.created_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
    fileId: row.file_id,
    filename: row.filename,
    height: row.height,
    id: row.id,
    kind: row.kind,
    mimeType: row.mime_type,
    storageKey: row.storage_key,
    updatedAt: row.updated_at.toISOString(),
    uploadedByUserId: row.uploaded_by_user_id,
    width: row.width,
    workspaceId: row.workspace_id
  };
}

function mapComment(row: CommentRow): CommentDto {
  return {
    author: {
      avatarUrl: row.author_avatar_url,
      displayName: row.author_display_name,
      id: row.author_user_id
    },
    authorUserId: row.author_user_id,
    body: row.body,
    createdAt: row.created_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
    fileId: row.file_id,
    id: row.id,
    nodeId: row.node_id,
    pageId: row.page_id,
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString()
  };
}

function mapExportJob(row: ExportJobRow): ExportJobDto {
  return {
    completedAt: row.completed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    errorMessage: row.error_message,
    fileId: row.file_id,
    format: row.format,
    id: row.id,
    outputAssetId: row.output_asset_id,
    pageId: row.page_id,
    requestedByUserId: row.requested_by_user_id,
    startedAt: row.started_at?.toISOString() ?? null,
    status: row.status,
    updatedAt: row.updated_at.toISOString()
  };
}

function mapShareLink(row: ShareLinkRow): ShareLinkDto {
  return {
    createdAt: row.created_at.toISOString(),
    createdByUserId: row.created_by_user_id,
    expiresAt: row.expires_at?.toISOString() ?? null,
    fileId: row.file_id,
    id: row.id,
    revokedAt: row.revoked_at?.toISOString() ?? null
  };
}

function mapShareLinkRecord(
  row: ShareLinkRow,
  shareUrl: string | null
): ShareLinkRecordDto {
  return {
    ...mapShareLink(row),
    shareUrl
  };
}

function mapClaimedFileRow(row: ClaimedExportJobRow): FileDto {
  return {
    createdAt: row.file_created_at.toISOString(),
    createdByUserId: row.file_created_by_user_id,
    deletedAt: row.file_deleted_at?.toISOString() ?? null,
    description: row.file_description,
    id: row.file_id,
    name: row.file_name,
    projectId: row.file_project_id,
    updatedAt: row.file_updated_at.toISOString(),
    workspaceId: row.file_workspace_id
  };
}

function mapFileFromPageThumbnailRow(row: PageThumbnailCandidateRow): FileDto {
  return {
    createdAt: row.file_created_at.toISOString(),
    createdByUserId: row.file_created_by_user_id,
    deletedAt: row.file_deleted_at?.toISOString() ?? null,
    description: row.file_description,
    id: row.file_id,
    name: row.file_name,
    projectId: row.file_project_id,
    updatedAt: row.file_updated_at.toISOString(),
    workspaceId: row.file_workspace_id
  };
}

function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createShareToken(): string {
  return randomBytes(24).toString("base64url");
}

function requireClient(poolOrClient?: Pool | PoolClient): Pool | PoolClient {
  return poolOrClient ?? createDatabasePool();
}

async function withTransaction<T>(
  poolOrClient: Pool | PoolClient | undefined,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const target = requireClient(poolOrClient);

  if ("release" in target && "query" in target) {
    return callback(target);
  }

  const client = await target.connect();

  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function getAuthorizedWorkspaceRow(
  userId: string,
  workspaceId: string,
  poolOrClient?: Pool | PoolClient
): Promise<WorkspaceRow | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<WorkspaceRow>(
    `
      select
        workspaces.created_at,
        workspaces.deleted_at,
        workspaces.id,
        memberships.id as membership_id,
        workspaces.name,
        memberships.role,
        workspaces.slug,
        workspaces.updated_at
      from workspaces
      inner join memberships
        on memberships.workspace_id = workspaces.id
      where memberships.user_id = $1
        and workspaces.id = $2
        and workspaces.deleted_at is null
      limit 1
    `,
    [userId, workspaceId]
  );

  return result.rows[0] ?? null;
}

function canMutateWorkspace(role: WorkspaceDetailDto["role"]): boolean {
  return createEditorAccess({
    role,
    source: "membership"
  }).canMutate;
}

async function getProjectRow(
  userId: string,
  workspaceId: string,
  projectId: string,
  poolOrClient?: Pool | PoolClient
): Promise<ProjectRow | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<ProjectRow>(
    `
      select
        projects.created_at,
        projects.deleted_at,
        projects.description,
        projects.id,
        projects.name,
        projects.updated_at,
        projects.workspace_id
      from projects
      inner join memberships
        on memberships.workspace_id = projects.workspace_id
      where memberships.user_id = $1
        and projects.workspace_id = $2
        and projects.id = $3
        and projects.deleted_at is null
      limit 1
    `,
    [userId, workspaceId, projectId]
  );

  return result.rows[0] ?? null;
}

async function getFileRow(
  userId: string,
  workspaceId: string,
  projectId: string,
  fileId: string,
  poolOrClient?: Pool | PoolClient
): Promise<FileRow | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<FileRow>(
    `
      select
        files.created_at,
        files.created_by_user_id,
        files.deleted_at,
        files.description,
        files.id,
        files.name,
        files.project_id,
        files.updated_at,
        files.workspace_id
      from files
      inner join memberships
        on memberships.workspace_id = files.workspace_id
      where memberships.user_id = $1
        and files.workspace_id = $2
        and files.project_id = $3
        and files.id = $4
        and files.deleted_at is null
      limit 1
    `,
    [userId, workspaceId, projectId, fileId]
  );

  return result.rows[0] ?? null;
}

async function getPageRow(
  userId: string,
  workspaceId: string,
  projectId: string,
  fileId: string,
  pageId: string,
  poolOrClient?: Pool | PoolClient
): Promise<PageRow | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<PageRow>(
    `
      select
        pages.background,
        pages.created_at,
        pages.file_id,
        pages.height,
        pages.id,
        pages.name,
        pages.order_index,
        pages.updated_at,
        pages.width
      from pages
      inner join files
        on files.id = pages.file_id
      inner join memberships
        on memberships.workspace_id = files.workspace_id
      where memberships.user_id = $1
        and files.workspace_id = $2
        and files.project_id = $3
        and files.id = $4
        and pages.id = $5
        and files.deleted_at is null
      limit 1
    `,
    [userId, workspaceId, projectId, fileId, pageId]
  );

  return result.rows[0] ?? null;
}

export async function getFileById(
  fileId: string,
  poolOrClient?: Pool | PoolClient
): Promise<FileDto | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<FileRow>(
    `
      select
        files.created_at,
        files.created_by_user_id,
        files.deleted_at,
        files.description,
        files.id,
        files.name,
        files.project_id,
        files.thumbnail_asset_id,
        files.updated_at,
        files.workspace_id
      from files
      where files.id = $1
        and files.deleted_at is null
      limit 1
    `,
    [fileId]
  );

  return result.rows[0] ? mapFile(result.rows[0]) : null;
}

export async function getPageById(
  pageId: string,
  poolOrClient?: Pool | PoolClient
): Promise<PageDto | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<PageRow>(
    `
      select
        pages.background,
        pages.created_at,
        pages.file_id,
        pages.height,
        pages.id,
        pages.name,
        pages.order_index,
        pages.thumbnail_asset_id,
        pages.updated_at,
        pages.width
      from pages
      inner join files
        on files.id = pages.file_id
      where pages.id = $1
        and files.deleted_at is null
      limit 1
    `,
    [pageId]
  );

  return result.rows[0] ? mapPage(result.rows[0]) : null;
}

export async function listAuthorizedWorkspaces(
  userId: string,
  poolOrClient?: Pool | PoolClient
): Promise<WorkspaceDetailDto[]> {
  const db = requireClient(poolOrClient);
  const result = await db.query<WorkspaceRow>(
    `
      select
        workspaces.created_at,
        workspaces.deleted_at,
        workspaces.id,
        memberships.id as membership_id,
        workspaces.name,
        memberships.role,
        workspaces.slug,
        workspaces.updated_at
      from workspaces
      inner join memberships
        on memberships.workspace_id = workspaces.id
      where memberships.user_id = $1
        and workspaces.deleted_at is null
      order by workspaces.updated_at desc, workspaces.name asc, workspaces.id asc
    `,
    [userId]
  );

  return result.rows.map(mapWorkspace);
}

export async function listWorkspaceProjects(
  userId: string,
  workspaceId: string,
  poolOrClient?: Pool | PoolClient
): Promise<{ projects: ProjectDto[]; workspace: WorkspaceDetailDto } | null> {
  const workspace = await getAuthorizedWorkspaceRow(
    userId,
    workspaceId,
    poolOrClient
  );

  if (!workspace) {
    return null;
  }

  const db = requireClient(poolOrClient);
  const result = await db.query<ProjectRow>(
    `
      select
        projects.created_at,
        projects.deleted_at,
        projects.description,
        projects.id,
        projects.name,
        projects.updated_at,
        projects.workspace_id
      from projects
      inner join memberships
        on memberships.workspace_id = projects.workspace_id
      where memberships.user_id = $1
        and projects.workspace_id = $2
        and projects.deleted_at is null
      order by projects.updated_at desc, projects.name asc, projects.id asc
    `,
    [userId, workspaceId]
  );

  return {
    projects: result.rows.map(mapProject),
    workspace: mapWorkspace(workspace)
  };
}

export async function createProject(
  userId: string,
  workspaceId: string,
  name: string,
  poolOrClient?: Pool | PoolClient
): Promise<ProjectDto | null> {
  return withTransaction(poolOrClient, async (client) => {
    const workspace = await getAuthorizedWorkspaceRow(
      userId,
      workspaceId,
      client
    );

    if (!workspace || !canMutateWorkspace(workspace.role)) {
      return null;
    }

    const result = await client.query<ProjectRow>(
      `
        insert into projects (workspace_id, name)
        values ($1, $2)
        returning
          created_at,
          deleted_at,
          description,
          id,
          name,
          updated_at,
          workspace_id
      `,
      [workspaceId, name]
    );

    return mapProject(result.rows[0] as ProjectRow);
  });
}

export async function renameProject(
  userId: string,
  workspaceId: string,
  projectId: string,
  name: string,
  poolOrClient?: Pool | PoolClient
): Promise<ProjectDto | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<ProjectRow>(
    `
      update projects
      set name = $4,
          updated_at = now()
      where projects.id = $3
        and projects.workspace_id = $2
        and projects.deleted_at is null
        and exists (
          select 1
          from memberships
          where memberships.workspace_id = projects.workspace_id
            and memberships.user_id = $1
            and memberships.role in ('owner', 'editor')
        )
      returning
        created_at,
        deleted_at,
        description,
        id,
        name,
        updated_at,
        workspace_id
    `,
    [userId, workspaceId, projectId, name]
  );

  return result.rows[0] ? mapProject(result.rows[0]) : null;
}

export async function listProjectFiles(
  userId: string,
  workspaceId: string,
  projectId: string,
  poolOrClient?: Pool | PoolClient
): Promise<{
  files: FileDto[];
  project: ProjectDto;
  workspace: WorkspaceDetailDto;
} | null> {
  const workspace = await getAuthorizedWorkspaceRow(
    userId,
    workspaceId,
    poolOrClient
  );

  if (!workspace) {
    return null;
  }

  const project = await getProjectRow(
    userId,
    workspaceId,
    projectId,
    poolOrClient
  );

  if (!project) {
    return null;
  }

  const db = requireClient(poolOrClient);
  const result = await db.query<FileRow>(
    `
      select
        files.created_at,
        files.created_by_user_id,
        files.deleted_at,
        files.description,
        files.id,
        files.name,
        files.project_id,
        files.updated_at,
        files.workspace_id
      from files
      inner join memberships
        on memberships.workspace_id = files.workspace_id
      where memberships.user_id = $1
        and files.workspace_id = $2
        and files.project_id = $3
        and files.deleted_at is null
      order by files.updated_at desc, files.name asc, files.id asc
    `,
    [userId, workspaceId, projectId]
  );

  return {
    files: result.rows.map(mapFile),
    project: mapProject(project),
    workspace: mapWorkspace(workspace)
  };
}

export async function createFileWithPages(
  userId: string,
  workspaceId: string,
  projectId: string,
  name: string,
  initialPages: CreateFilePageInput[],
  poolOrClient?: Pool | PoolClient
): Promise<FileOpenResponse | null> {
  return withTransaction(poolOrClient, async (client) => {
    const workspace = await getAuthorizedWorkspaceRow(
      userId,
      workspaceId,
      client
    );

    if (!workspace || !canMutateWorkspace(workspace.role)) {
      return null;
    }

    const project = await getProjectRow(userId, workspaceId, projectId, client);

    if (!project) {
      return null;
    }

    const insertedFile = await client.query<FileRow>(
      `
        insert into files (project_id, workspace_id, name, created_by_user_id)
        values ($1, $2, $3, $4)
        returning
          created_at,
          created_by_user_id,
          deleted_at,
          description,
          id,
          name,
          project_id,
          updated_at,
          workspace_id
      `,
      [projectId, workspaceId, name, userId]
    );
    const file = insertedFile.rows[0] as FileRow;
    const pages: PageDto[] = [];

    for (const [index, page] of initialPages.entries()) {
      const insertedPage = await client.query<PageRow>(
        `
          insert into pages (file_id, name, order_index)
          values ($1, $2, $3)
          returning
            background,
            created_at,
            file_id,
            height,
            id,
            name,
            order_index,
            updated_at,
            width
        `,
        [file.id, page.name, index]
      );
      pages.push(mapPage(insertedPage.rows[0] as PageRow));
    }

    return {
      access: createEditorAccess({
        role: workspace.role,
        source: "membership"
      }),
      defaultPageId: pages[0]?.id ?? null,
      file: mapFile(file),
      pages,
      project: mapProject(project),
      workspace: mapWorkspace(workspace)
    };
  });
}

export async function renameFile(
  userId: string,
  workspaceId: string,
  projectId: string,
  fileId: string,
  name: string,
  poolOrClient?: Pool | PoolClient
): Promise<FileDto | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<FileRow>(
    `
      update files
      set name = $5,
          updated_at = now()
      where files.id = $4
        and files.project_id = $3
        and files.workspace_id = $2
        and files.deleted_at is null
        and exists (
          select 1
          from memberships
          where memberships.workspace_id = files.workspace_id
            and memberships.user_id = $1
            and memberships.role in ('owner', 'editor')
        )
      returning
        created_at,
        created_by_user_id,
        deleted_at,
        description,
        id,
        name,
        project_id,
        updated_at,
        workspace_id
    `,
    [userId, workspaceId, projectId, fileId, name]
  );

  return result.rows[0] ? mapFile(result.rows[0]) : null;
}

export async function getFileOpenDetails(
  userId: string,
  workspaceId: string,
  projectId: string,
  fileId: string,
  poolOrClient?: Pool | PoolClient
): Promise<FileOpenResponse | null> {
  const workspace = await getAuthorizedWorkspaceRow(
    userId,
    workspaceId,
    poolOrClient
  );

  if (!workspace) {
    return null;
  }

  const project = await getProjectRow(
    userId,
    workspaceId,
    projectId,
    poolOrClient
  );

  if (!project) {
    return null;
  }

  const file = await getFileRow(
    userId,
    workspaceId,
    projectId,
    fileId,
    poolOrClient
  );

  if (!file) {
    return null;
  }

  const db = requireClient(poolOrClient);
  const result = await db.query<PageRow>(
    `
      select
        background,
        created_at,
        file_id,
        height,
        id,
        name,
        order_index,
        updated_at,
        width
      from pages
      where file_id = $1
      order by order_index asc, created_at asc, id asc
    `,
    [fileId]
  );
  const pages = result.rows.map(mapPage);

  return {
    access: createEditorAccess({
      role: workspace.role,
      source: "membership"
    }),
    defaultPageId: pages[0]?.id ?? null,
    file: mapFile(file),
    pages,
    project: mapProject(project),
    workspace: mapWorkspace(workspace)
  };
}

export async function listFilePages(
  userId: string,
  workspaceId: string,
  projectId: string,
  fileId: string,
  poolOrClient?: Pool | PoolClient
): Promise<{
  file: FileDto;
  pages: PageDto[];
  project: ProjectDto;
  workspace: WorkspaceDetailDto;
} | null> {
  const details = await getFileOpenDetails(
    userId,
    workspaceId,
    projectId,
    fileId,
    poolOrClient
  );

  if (!details) {
    return null;
  }

  return details;
}

export async function createPage(
  userId: string,
  workspaceId: string,
  projectId: string,
  fileId: string,
  name: string,
  poolOrClient?: Pool | PoolClient
): Promise<PageDto | null> {
  return withTransaction(poolOrClient, async (client) => {
    const workspace = await getAuthorizedWorkspaceRow(userId, workspaceId, client);
    const file = await getFileRow(
      userId,
      workspaceId,
      projectId,
      fileId,
      client
    );

    if (!file || !workspace || !canMutateWorkspace(workspace.role)) {
      return null;
    }

    const nextOrderResult = await client.query<{ next_order_index: number }>(
      `
        select coalesce(max(order_index), -1) + 1 as next_order_index
        from pages
        where file_id = $1
      `,
      [fileId]
    );
    const nextOrderIndex = nextOrderResult.rows[0]?.next_order_index ?? 0;
    const inserted = await client.query<PageRow>(
      `
        insert into pages (file_id, name, order_index)
        values ($1, $2, $3)
        returning
          background,
          created_at,
          file_id,
          height,
          id,
          name,
          order_index,
          updated_at,
          width
      `,
      [fileId, name, nextOrderIndex]
    );

    return mapPage(inserted.rows[0] as PageRow);
  });
}

export async function renamePage(
  userId: string,
  workspaceId: string,
  projectId: string,
  fileId: string,
  pageId: string,
  name: string,
  poolOrClient?: Pool | PoolClient
): Promise<PageDto | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<PageRow>(
    `
      update pages
      set name = $6,
          updated_at = now()
      where pages.id = $5
        and pages.file_id = $4
        and exists (
          select 1
          from files
          inner join memberships
            on memberships.workspace_id = files.workspace_id
          where files.id = pages.file_id
            and files.workspace_id = $2
            and files.project_id = $3
            and files.deleted_at is null
            and memberships.user_id = $1
            and memberships.role in ('owner', 'editor')
        )
      returning
        background,
        created_at,
        file_id,
        height,
        id,
        name,
        order_index,
        updated_at,
        width
    `,
    [userId, workspaceId, projectId, fileId, pageId, name]
  );

  return result.rows[0] ? mapPage(result.rows[0]) : null;
}

export async function listAssets(
  userId: string,
  workspaceId: string,
  projectId: string,
  input: ListAssetsInput,
  poolOrClient?: Pool | PoolClient
): Promise<AssetDto[] | null> {
  const file = await getFileRow(
    userId,
    workspaceId,
    projectId,
    input.fileId,
    poolOrClient
  );

  if (!file) {
    return null;
  }

  const db = requireClient(poolOrClient);
  const includeWorkspaceAssets = input.includeWorkspaceAssets !== false;
  const result = await db.query<AssetRow>(
    `
      select
        byte_size,
        created_at,
        deleted_at,
        file_id,
        filename,
        height,
        id,
        kind,
        mime_type,
        storage_key,
        updated_at,
        uploaded_by_user_id,
        width,
        workspace_id
      from assets
      where workspace_id = $1
        and deleted_at is null
        and (file_id = $2 or ($3 and file_id is null))
      order by created_at desc, id desc
    `,
    [workspaceId, input.fileId, includeWorkspaceAssets]
  );

  return result.rows.map(mapAsset);
}

export async function createAsset(
  userId: string,
  workspaceId: string,
  projectId: string,
  fileId: string,
  input: CreateAssetInput,
  poolOrClient?: Pool | PoolClient
): Promise<AssetDto | null> {
  return withTransaction(poolOrClient, async (client) => {
    const workspace = await getAuthorizedWorkspaceRow(userId, workspaceId, client);
    const file = await getFileRow(userId, workspaceId, projectId, fileId, client);

    if (!file || !workspace || !canMutateWorkspace(workspace.role)) {
      return null;
    }

    const scopedFileId = input.scope === "workspace" ? null : fileId;
    const assetId = input.id ?? randomUUID();
    const result = await client.query<AssetRow>(
      `
        insert into assets (
          id,
          workspace_id,
          file_id,
          uploaded_by_user_id,
          kind,
          filename,
          mime_type,
          byte_size,
          storage_key,
          width,
          height
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        returning
          byte_size,
          created_at,
          deleted_at,
          file_id,
          filename,
          height,
          id,
          kind,
          mime_type,
          storage_key,
          updated_at,
          uploaded_by_user_id,
          width,
          workspace_id
      `,
      [
        assetId,
        workspaceId,
        scopedFileId,
        userId,
        input.kind,
        input.filename,
        input.mimeType,
        input.byteSize,
        input.storageKey,
        input.width ?? null,
        input.height ?? null
      ]
    );

    return mapAsset(result.rows[0] as AssetRow);
  });
}

export async function getAuthorizedAsset(
  userId: string,
  workspaceId: string,
  projectId: string,
  fileId: string,
  assetId: string,
  poolOrClient?: Pool | PoolClient
): Promise<AssetDto | null> {
  const file = await getFileRow(
    userId,
    workspaceId,
    projectId,
    fileId,
    poolOrClient
  );

  if (!file) {
    return null;
  }

  const db = requireClient(poolOrClient);
  const result = await db.query<AssetRow>(
    `
      select
        byte_size,
        created_at,
        deleted_at,
        file_id,
        filename,
        height,
        id,
        kind,
        mime_type,
        storage_key,
        updated_at,
        uploaded_by_user_id,
        width,
        workspace_id
      from assets
      where workspace_id = $1
        and id = $2
        and deleted_at is null
        and (file_id = $3 or file_id is null)
      limit 1
    `,
    [workspaceId, assetId, fileId]
  );

  return result.rows[0] ? mapAsset(result.rows[0]) : null;
}

export async function listRenderableAssetsForFile(
  fileId: string,
  poolOrClient?: Pool | PoolClient
): Promise<AssetDto[]> {
  const file = await getFileById(fileId, poolOrClient);

  if (!file) {
    return [];
  }

  const db = requireClient(poolOrClient);
  const result = await db.query<AssetRow>(
    `
      select
        byte_size,
        created_at,
        deleted_at,
        file_id,
        filename,
        height,
        id,
        kind,
        mime_type,
        storage_key,
        updated_at,
        uploaded_by_user_id,
        width,
        workspace_id
      from assets
      where workspace_id = $1
        and deleted_at is null
        and (file_id = $2 or file_id is null)
      order by created_at desc, id desc
    `,
    [file.workspaceId, fileId]
  );

  return result.rows.map(mapAsset);
}

export async function createExportJob(
  userId: string,
  workspaceId: string,
  projectId: string,
  fileId: string,
  input: CreateExportJobInput,
  poolOrClient?: Pool | PoolClient
): Promise<ExportJobDto | null> {
  const db = requireClient(poolOrClient);
  const workspace = await getAuthorizedWorkspaceRow(userId, workspaceId, db);
  const file = await getFileRow(userId, workspaceId, projectId, fileId, db);

  if (!workspace || !file) {
    return null;
  }

  if (input.pageId) {
    const page = await getPageRow(
      userId,
      workspaceId,
      projectId,
      fileId,
      input.pageId,
      db
    );

    if (!page) {
      return null;
    }
  }

  const result = await db.query<ExportJobRow>(
    `
      insert into export_jobs (
        file_id,
        page_id,
        requested_by_user_id,
        format,
        status
      )
      values ($1, $2, $3, $4, 'queued')
      returning
        completed_at,
        created_at,
        error_message,
        file_id,
        format,
        id,
        output_asset_id,
        page_id,
        requested_by_user_id,
        started_at,
        status,
        updated_at
    `,
    [fileId, input.pageId ?? null, userId, input.format]
  );

  return result.rows[0] ? mapExportJob(result.rows[0]) : null;
}

export async function getAuthorizedExportJob(
  userId: string,
  workspaceId: string,
  projectId: string,
  fileId: string,
  jobId: string,
  poolOrClient?: Pool | PoolClient
): Promise<ExportJobDto | null> {
  const file = await getFileRow(
    userId,
    workspaceId,
    projectId,
    fileId,
    poolOrClient
  );

  if (!file) {
    return null;
  }

  const db = requireClient(poolOrClient);
  const result = await db.query<ExportJobRow>(
    `
      select
        completed_at,
        created_at,
        error_message,
        file_id,
        format,
        id,
        output_asset_id,
        page_id,
        requested_by_user_id,
        started_at,
        status,
        updated_at
      from export_jobs
      where id = $1
        and file_id = $2
      limit 1
    `,
    [jobId, fileId]
  );

  return result.rows[0] ? mapExportJob(result.rows[0]) : null;
}

export async function claimNextQueuedExportJob(
  poolOrClient?: Pool | PoolClient
): Promise<{
  file: FileDto;
  job: ExportJobDto;
  projectId: string;
  workspaceId: string;
} | null> {
  return withTransaction(poolOrClient, async (client) => {
    const result = await client.query<ClaimedExportJobRow>(
      `
        with next_job as (
          select export_jobs.id, export_jobs.file_id
          from export_jobs
          inner join files
            on files.id = export_jobs.file_id
          where export_jobs.status = 'queued'
            and files.deleted_at is null
          order by export_jobs.created_at asc, export_jobs.id asc
          for update skip locked
          limit 1
        )
        update export_jobs as job
        set status = 'running',
            started_at = coalesce(job.started_at, now()),
            completed_at = null,
            error_message = null,
            updated_at = now()
        from next_job, files
        where job.id = next_job.id
          and files.id = next_job.file_id
        returning
          job.completed_at,
          job.created_at,
          job.error_message,
          job.file_id,
          job.format,
          job.id,
          job.output_asset_id,
          job.page_id,
          job.requested_by_user_id,
          job.started_at,
          job.status,
          job.updated_at,
          files.created_at as file_created_at,
          files.created_by_user_id as file_created_by_user_id,
          files.deleted_at as file_deleted_at,
          files.description as file_description,
          files.name as file_name,
          files.project_id as file_project_id,
          files.thumbnail_asset_id as file_thumbnail_asset_id,
          files.updated_at as file_updated_at,
          files.workspace_id as file_workspace_id
      `
    );
    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      file: mapClaimedFileRow(row),
      job: mapExportJob(row),
      projectId: row.file_project_id,
      workspaceId: row.file_workspace_id
    };
  });
}

export async function markExportJobSucceeded(
  jobId: string,
  outputAssetId: string,
  poolOrClient?: Pool | PoolClient
): Promise<ExportJobDto | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<ExportJobRow>(
    `
      update export_jobs
      set status = 'succeeded',
          output_asset_id = $2,
          error_message = null,
          completed_at = now(),
          updated_at = now()
      where id = $1
      returning
        completed_at,
        created_at,
        error_message,
        file_id,
        format,
        id,
        output_asset_id,
        page_id,
        requested_by_user_id,
        started_at,
        status,
        updated_at
    `,
    [jobId, outputAssetId]
  );

  return result.rows[0] ? mapExportJob(result.rows[0]) : null;
}

export async function markExportJobFailed(
  jobId: string,
  errorMessage: string,
  poolOrClient?: Pool | PoolClient
): Promise<ExportJobDto | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<ExportJobRow>(
    `
      update export_jobs
      set status = 'failed',
          error_message = left($2, 2048),
          completed_at = now(),
          updated_at = now()
      where id = $1
      returning
        completed_at,
        created_at,
        error_message,
        file_id,
        format,
        id,
        output_asset_id,
        page_id,
        requested_by_user_id,
        started_at,
        status,
        updated_at
    `,
    [jobId, errorMessage]
  );

  return result.rows[0] ? mapExportJob(result.rows[0]) : null;
}

export async function failStaleRunningExportJobs(
  startedBefore: Date,
  poolOrClient?: Pool | PoolClient
): Promise<number> {
  const db = requireClient(poolOrClient);
  const result = await db.query<{ id: string }>(
    `
      update export_jobs
      set status = 'failed',
          error_message = 'worker job timed out',
          completed_at = now(),
          updated_at = now()
      where status = 'running'
        and started_at is not null
        and started_at <= $1
      returning id
    `,
    [startedBefore]
  );

  return result.rows.length;
}

export async function createDerivedAssetRecord(input: {
  byteSize: number;
  fileId: string;
  filename: string;
  height?: number | null;
  kind: AssetDto["kind"];
  mimeType: string;
  storageKey: string;
  uploadedByUserId: string;
  width?: number | null;
  workspaceId: string;
}, poolOrClient?: Pool | PoolClient): Promise<AssetDto> {
  const db = requireClient(poolOrClient);
  const result = await db.query<AssetRow>(
    `
      insert into assets (
        workspace_id,
        file_id,
        uploaded_by_user_id,
        kind,
        filename,
        mime_type,
        byte_size,
        storage_key,
        width,
        height
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning
        byte_size,
        created_at,
        deleted_at,
        file_id,
        filename,
        height,
        id,
        kind,
        mime_type,
        storage_key,
        updated_at,
        uploaded_by_user_id,
        width,
        workspace_id
    `,
    [
      input.workspaceId,
      input.fileId,
      input.uploadedByUserId,
      input.kind,
      input.filename,
      input.mimeType,
      input.byteSize,
      input.storageKey,
      input.width ?? null,
      input.height ?? null
    ]
  );

  return mapAsset(result.rows[0] as AssetRow);
}

export async function replacePageThumbnailAsset(
  pageId: string,
  thumbnailAssetId: string,
  poolOrClient?: Pool | PoolClient
): Promise<string | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<{ previous_asset_id: string | null }>(
    `
      with previous as (
        select thumbnail_asset_id as previous_asset_id
        from pages
        where id = $1
      )
      update pages
      set thumbnail_asset_id = $2,
          updated_at = now()
      where id = $1
      returning (select previous_asset_id from previous) as previous_asset_id
    `,
    [pageId, thumbnailAssetId]
  );

  return result.rows[0]?.previous_asset_id ?? null;
}

export async function replaceFileThumbnailAsset(
  fileId: string,
  thumbnailAssetId: string,
  poolOrClient?: Pool | PoolClient
): Promise<string | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<{ previous_asset_id: string | null }>(
    `
      with previous as (
        select thumbnail_asset_id as previous_asset_id
        from files
        where id = $1
      )
      update files
      set thumbnail_asset_id = $2,
          updated_at = now()
      where id = $1
      returning (select previous_asset_id from previous) as previous_asset_id
    `,
    [fileId, thumbnailAssetId]
  );

  return result.rows[0]?.previous_asset_id ?? null;
}

export async function markAssetDeleted(
  assetId: string,
  poolOrClient?: Pool | PoolClient
): Promise<AssetDto | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<AssetRow>(
    `
      update assets
      set deleted_at = coalesce(deleted_at, now()),
          updated_at = now()
      where id = $1
      returning
        byte_size,
        created_at,
        deleted_at,
        file_id,
        filename,
        height,
        id,
        kind,
        mime_type,
        storage_key,
        updated_at,
        uploaded_by_user_id,
        width,
        workspace_id
    `,
    [assetId]
  );

  return result.rows[0] ? mapAsset(result.rows[0]) : null;
}

export async function listDeletedThumbnailAssetsForCleanup(
  deletedBefore: Date,
  limit: number,
  poolOrClient?: Pool | PoolClient
): Promise<AssetDto[]> {
  const db = requireClient(poolOrClient);
  const result = await db.query<AssetRow>(
    `
      select
        assets.byte_size,
        assets.created_at,
        assets.deleted_at,
        assets.file_id,
        assets.filename,
        assets.height,
        assets.id,
        assets.kind,
        assets.mime_type,
        assets.storage_key,
        assets.updated_at,
        assets.uploaded_by_user_id,
        assets.width,
        assets.workspace_id
      from assets
      where assets.kind = 'thumbnail'
        and assets.deleted_at is not null
        and assets.deleted_at <= $1
        and not exists (
          select 1
          from files
          where files.thumbnail_asset_id = assets.id
        )
        and not exists (
          select 1
          from pages
          where pages.thumbnail_asset_id = assets.id
        )
      order by assets.deleted_at asc, assets.id asc
      limit $2
    `,
    [deletedBefore, limit]
  );

  return result.rows.map(mapAsset);
}

export async function hardDeleteAssetRecord(
  assetId: string,
  poolOrClient?: Pool | PoolClient
): Promise<boolean> {
  const db = requireClient(poolOrClient);
  const result = await db.query<{ id: string }>(
    `
      delete from assets
      where id = $1
      returning id
    `,
    [assetId]
  );

  return Boolean(result.rows[0]);
}

export async function findNextPageMissingThumbnail(
  poolOrClient?: Pool | PoolClient
): Promise<{
  file: FileDto;
  page: PageDto;
  projectId: string;
  workspaceId: string;
} | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<PageThumbnailCandidateRow>(
    `
      select
        pages.background,
        pages.created_at,
        pages.file_id,
        pages.height,
        pages.id,
        pages.name,
        pages.order_index,
        pages.thumbnail_asset_id,
        pages.updated_at,
        pages.width,
        files.created_at as file_created_at,
        files.created_by_user_id as file_created_by_user_id,
        files.deleted_at as file_deleted_at,
        files.description as file_description,
        files.name as file_name,
        files.project_id as file_project_id,
        files.thumbnail_asset_id as file_thumbnail_asset_id,
        files.updated_at as file_updated_at,
        files.workspace_id as file_workspace_id
      from pages
      inner join files
        on files.id = pages.file_id
      where pages.thumbnail_asset_id is null
        and files.deleted_at is null
      order by pages.updated_at desc, pages.created_at desc, pages.id asc
      limit 1
    `
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    file: mapFileFromPageThumbnailRow(row),
    page: mapPage(row),
    projectId: row.file_project_id,
    workspaceId: row.file_workspace_id
  };
}

export async function findNextFileMissingThumbnail(
  poolOrClient?: Pool | PoolClient
): Promise<{
  coverPage: PageDto;
  file: FileDto;
  projectId: string;
  workspaceId: string;
} | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<PageThumbnailCandidateRow>(
    `
      select
        pages.background,
        pages.created_at,
        pages.file_id,
        pages.height,
        pages.id,
        pages.name,
        pages.order_index,
        pages.thumbnail_asset_id,
        pages.updated_at,
        pages.width,
        files.created_at as file_created_at,
        files.created_by_user_id as file_created_by_user_id,
        files.deleted_at as file_deleted_at,
        files.description as file_description,
        files.name as file_name,
        files.project_id as file_project_id,
        files.thumbnail_asset_id as file_thumbnail_asset_id,
        files.updated_at as file_updated_at,
        files.workspace_id as file_workspace_id
      from files
      inner join pages
        on pages.file_id = files.id
      where files.thumbnail_asset_id is null
        and files.deleted_at is null
        and pages.order_index = (
          select min(first_page.order_index)
          from pages as first_page
          where first_page.file_id = files.id
        )
      order by files.updated_at desc, files.created_at desc, files.id asc
      limit 1
    `
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    coverPage: mapPage(row),
    file: mapFileFromPageThumbnailRow(row),
    projectId: row.file_project_id,
    workspaceId: row.file_workspace_id
  };
}

export async function listComments(
  userId: string,
  workspaceId: string,
  projectId: string,
  input: ListCommentsInput,
  poolOrClient?: Pool | PoolClient
): Promise<CommentDto[] | null> {
  const db = requireClient(poolOrClient);
  const file = await getFileRow(
    userId,
    workspaceId,
    projectId,
    input.fileId,
    db
  );

  if (!file) {
    return null;
  }

  if (input.pageId) {
    const page = await getPageRow(
      userId,
      workspaceId,
      projectId,
      input.fileId,
      input.pageId,
      db
    );

    if (!page) {
      return null;
    }
  }

  const includeResolved = input.includeResolved ?? false;
  const result = await db.query<CommentRow>(
    `
      select
        comments.author_user_id,
        users.avatar_url as author_avatar_url,
        users.display_name as author_display_name,
        comments.body,
        comments.created_at,
        comments.deleted_at,
        comments.file_id,
        comments.id,
        comments.node_id,
        comments.page_id,
        comments.resolved_at,
        comments.updated_at
      from comments
      inner join users
        on users.id = comments.author_user_id
      where comments.file_id = $1
        and comments.deleted_at is null
        and ($2::boolean or comments.resolved_at is null)
        and (
          $3::uuid is null
          or comments.page_id is null
          or comments.page_id = $3
        )
      order by
        comments.resolved_at is null desc,
        comments.created_at asc
    `,
    [input.fileId, includeResolved, input.pageId ?? null]
  );

  return result.rows.map(mapComment);
}

export async function createComment(
  userId: string,
  workspaceId: string,
  projectId: string,
  input: CreateCommentInput,
  poolOrClient?: Pool | PoolClient
): Promise<CommentDto | null> {
  const db = requireClient(poolOrClient);
  const workspace = await getAuthorizedWorkspaceRow(userId, workspaceId, db);

  if (!workspace || !canMutateWorkspace(workspace.role)) {
    return null;
  }

  const file = await getFileRow(
    userId,
    workspaceId,
    projectId,
    input.target.fileId,
    db
  );

  if (!file) {
    return null;
  }

  if (input.target.type !== "file") {
    const page = await getPageRow(
      userId,
      workspaceId,
      projectId,
      input.target.fileId,
      input.target.pageId,
      db
    );

    if (!page) {
      return null;
    }
  }

  const result = await db.query<CommentRow>(
    `
      with inserted_comment as (
        insert into comments (
          file_id,
          page_id,
          node_id,
          author_user_id,
          body
        )
        values ($1, $2, $3, $4, $5)
        returning
          author_user_id,
          body,
          created_at,
          deleted_at,
          file_id,
          id,
          node_id,
          page_id,
          resolved_at,
          updated_at
      )
      select
        inserted_comment.author_user_id,
        users.avatar_url as author_avatar_url,
        users.display_name as author_display_name,
        inserted_comment.body,
        inserted_comment.created_at,
        inserted_comment.deleted_at,
        inserted_comment.file_id,
        inserted_comment.id,
        inserted_comment.node_id,
        inserted_comment.page_id,
        inserted_comment.resolved_at,
        inserted_comment.updated_at
      from inserted_comment
      inner join users
        on users.id = inserted_comment.author_user_id
    `,
    [
      input.target.fileId,
      input.target.type === "file" ? null : input.target.pageId,
      input.target.type === "node" ? input.target.nodeId : null,
      userId,
      input.body
    ]
  );

  return result.rows[0] ? mapComment(result.rows[0]) : null;
}

export async function resolveComment(
  userId: string,
  workspaceId: string,
  projectId: string,
  input: ResolveCommentInput,
  poolOrClient?: Pool | PoolClient
): Promise<CommentDto | null> {
  const db = requireClient(poolOrClient);
  const workspace = await getAuthorizedWorkspaceRow(userId, workspaceId, db);

  if (!workspace || !canMutateWorkspace(workspace.role)) {
    return null;
  }

  const file = await getFileRow(
    userId,
    workspaceId,
    projectId,
    input.fileId,
    db
  );

  if (!file) {
    return null;
  }

  const result = await db.query<CommentRow>(
    `
      update comments
      set resolved_at = coalesce(resolved_at, now()),
          updated_at = now()
      from users
      where comments.id = $1
        and comments.file_id = $2
        and comments.deleted_at is null
        and users.id = comments.author_user_id
      returning
        comments.author_user_id,
        users.avatar_url as author_avatar_url,
        users.display_name as author_display_name,
        comments.body,
        comments.created_at,
        comments.deleted_at,
        comments.file_id,
        comments.id,
        comments.node_id,
        comments.page_id,
        comments.resolved_at,
        comments.updated_at
    `,
    [input.commentId, input.fileId]
  );

  return result.rows[0] ? mapComment(result.rows[0]) : null;
}

function mapFileFromShareLinkAccess(row: ShareLinkAccessRow): FileDto {
  return {
    createdAt: row.file_created_at.toISOString(),
    createdByUserId: row.file_created_by_user_id,
    deletedAt: row.file_deleted_at?.toISOString() ?? null,
    description: row.file_description,
    id: row.file_id,
    name: row.file_name,
    projectId: row.file_project_id,
    updatedAt: row.file_updated_at.toISOString(),
    workspaceId: row.file_workspace_id
  };
}

function mapProjectFromShareLinkAccess(row: ShareLinkAccessRow): ProjectDto {
  return {
    createdAt: row.project_created_at.toISOString(),
    deletedAt: row.project_deleted_at?.toISOString() ?? null,
    description: row.project_description,
    id: row.project_id,
    name: row.project_name,
    updatedAt: row.project_updated_at.toISOString(),
    workspaceId: row.project_workspace_id
  };
}

function mapWorkspaceFromShareLinkAccess(row: ShareLinkAccessRow): WorkspaceDto {
  return {
    createdAt: row.workspace_created_at.toISOString(),
    deletedAt: row.workspace_deleted_at?.toISOString() ?? null,
    id: row.workspace_id,
    name: row.workspace_name,
    slug: row.workspace_slug,
    updatedAt: row.workspace_updated_at.toISOString()
  };
}

async function getShareLinkAccessRow(
  token: string,
  poolOrClient?: Pool | PoolClient
): Promise<ShareLinkAccessRow | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<ShareLinkAccessRow>(
    `
      select
        files.created_at as file_created_at,
        files.created_by_user_id as file_created_by_user_id,
        files.deleted_at as file_deleted_at,
        files.description as file_description,
        files.id as file_id,
        files.name as file_name,
        files.project_id as file_project_id,
        files.updated_at as file_updated_at,
        files.workspace_id as file_workspace_id,
        projects.created_at as project_created_at,
        projects.deleted_at as project_deleted_at,
        projects.description as project_description,
        projects.id as project_id,
        projects.name as project_name,
        projects.updated_at as project_updated_at,
        projects.workspace_id as project_workspace_id,
        share_links.id as share_link_id,
        workspaces.created_at as workspace_created_at,
        workspaces.deleted_at as workspace_deleted_at,
        workspaces.id as workspace_id,
        workspaces.name as workspace_name,
        workspaces.slug as workspace_slug,
        workspaces.updated_at as workspace_updated_at
      from share_links
      inner join files
        on files.id = share_links.file_id
      inner join projects
        on projects.id = files.project_id
      inner join workspaces
        on workspaces.id = files.workspace_id
      where share_links.token_hash = $1
        and share_links.revoked_at is null
        and (share_links.expires_at is null or share_links.expires_at > now())
        and files.deleted_at is null
        and projects.deleted_at is null
        and workspaces.deleted_at is null
      limit 1
    `,
    [hashShareToken(token)]
  );

  return result.rows[0] ?? null;
}

export async function listPagesForFileId(
  fileId: string,
  poolOrClient?: Pool | PoolClient
): Promise<PageDto[]> {
  const db = requireClient(poolOrClient);
  const result = await db.query<PageRow>(
    `
      select
        background,
        created_at,
        file_id,
        height,
        id,
        name,
        order_index,
        updated_at,
        width
      from pages
      where file_id = $1
      order by order_index asc, created_at asc, id asc
    `,
    [fileId]
  );

  return result.rows.map(mapPage);
}

export async function listFileShareLinks(
  userId: string,
  workspaceId: string,
  projectId: string,
  fileId: string,
  poolOrClient?: Pool | PoolClient
): Promise<ShareLinkRecordDto[] | null> {
  const workspace = await getAuthorizedWorkspaceRow(
    userId,
    workspaceId,
    poolOrClient
  );
  const file = await getFileRow(
    userId,
    workspaceId,
    projectId,
    fileId,
    poolOrClient
  );

  if (!workspace || !canMutateWorkspace(workspace.role) || !file) {
    return null;
  }

  const db = requireClient(poolOrClient);
  const result = await db.query<ShareLinkRow>(
    `
      select
        created_at,
        created_by_user_id,
        expires_at,
        file_id,
        id,
        revoked_at
      from share_links
      where file_id = $1
      order by created_at desc, id desc
    `,
    [fileId]
  );

  return result.rows.map((row) => mapShareLinkRecord(row, null));
}

export async function createFileShareLink(
  userId: string,
  workspaceId: string,
  projectId: string,
  fileId: string,
  poolOrClient?: Pool | PoolClient
): Promise<CreatedShareLinkResponse | null> {
  return withTransaction(poolOrClient, async (client) => {
    const workspace = await getAuthorizedWorkspaceRow(userId, workspaceId, client);
    const file = await getFileRow(userId, workspaceId, projectId, fileId, client);

    if (!workspace || !canMutateWorkspace(workspace.role) || !file) {
      return null;
    }

    const token = createShareToken();
    const inserted = await client.query<ShareLinkRow>(
      `
        insert into share_links (file_id, token_hash, created_by_user_id)
        values ($1, $2, $3)
        returning
          created_at,
          created_by_user_id,
          expires_at,
          file_id,
          id,
          revoked_at
      `,
      [fileId, hashShareToken(token), userId]
    );

    return {
      shareLink: mapShareLinkRecord(inserted.rows[0] as ShareLinkRow, null),
      token
    };
  });
}

export async function revokeFileShareLink(
  userId: string,
  workspaceId: string,
  projectId: string,
  fileId: string,
  shareLinkId: string,
  poolOrClient?: Pool | PoolClient
): Promise<ShareLinkDto | null> {
  const workspace = await getAuthorizedWorkspaceRow(
    userId,
    workspaceId,
    poolOrClient
  );
  const file = await getFileRow(
    userId,
    workspaceId,
    projectId,
    fileId,
    poolOrClient
  );

  if (!workspace || !canMutateWorkspace(workspace.role) || !file) {
    return null;
  }

  const db = requireClient(poolOrClient);
  const result = await db.query<ShareLinkRow>(
    `
      update share_links
      set revoked_at = coalesce(revoked_at, now())
      where id = $1
        and file_id = $2
      returning
        created_at,
        created_by_user_id,
        expires_at,
        file_id,
        id,
        revoked_at
    `,
    [shareLinkId, fileId]
  );

  return result.rows[0] ? mapShareLink(result.rows[0]) : null;
}

export async function getSharedFileOpenDetails(
  token: string,
  poolOrClient?: Pool | PoolClient
): Promise<SharedFileOpenResponse | null> {
  const row = await getShareLinkAccessRow(token, poolOrClient);

  if (!row) {
    return null;
  }

  const pages = await listPagesForFileId(row.file_id, poolOrClient);

  return {
    access: createEditorAccess({
      role: null,
      source: "share-link"
    }),
    defaultPageId: pages[0]?.id ?? null,
    file: mapFileFromShareLinkAccess(row),
    pages,
    project: mapProjectFromShareLinkAccess(row),
    shareLink: {
      fileId: row.file_id,
      id: row.share_link_id
    },
    workspace: mapWorkspaceFromShareLinkAccess(row)
  };
}

export async function listSharedAssets(
  token: string,
  poolOrClient?: Pool | PoolClient
): Promise<AssetDto[] | null> {
  const row = await getShareLinkAccessRow(token, poolOrClient);

  if (!row) {
    return null;
  }

  const db = requireClient(poolOrClient);
  const result = await db.query<AssetRow>(
    `
      select
        byte_size,
        created_at,
        deleted_at,
        file_id,
        filename,
        height,
        id,
        kind,
        mime_type,
        storage_key,
        updated_at,
        uploaded_by_user_id,
        width,
        workspace_id
      from assets
      where workspace_id = $1
        and deleted_at is null
        and (file_id = $2 or file_id is null)
      order by created_at desc, id desc
    `,
    [row.file_workspace_id, row.file_id]
  );

  return result.rows.map(mapAsset);
}

export async function getSharedAsset(
  token: string,
  assetId: string,
  poolOrClient?: Pool | PoolClient
): Promise<AssetDto | null> {
  const row = await getShareLinkAccessRow(token, poolOrClient);

  if (!row) {
    return null;
  }

  const db = requireClient(poolOrClient);
  const result = await db.query<AssetRow>(
    `
      select
        byte_size,
        created_at,
        deleted_at,
        file_id,
        filename,
        height,
        id,
        kind,
        mime_type,
        storage_key,
        updated_at,
        uploaded_by_user_id,
        width,
        workspace_id
      from assets
      where workspace_id = $1
        and id = $2
        and deleted_at is null
        and (file_id = $3 or file_id is null)
      limit 1
    `,
    [row.file_workspace_id, assetId, row.file_id]
  );

  return result.rows[0] ? mapAsset(result.rows[0]) : null;
}

export async function getSharedCollabPageSession(
  token: string,
  pageId: string,
  poolOrClient?: Pool | PoolClient
): Promise<CollabPageSessionDto | null> {
  const row = await getShareLinkAccessRow(token, poolOrClient);

  if (!row) {
    return null;
  }

  const db = requireClient(poolOrClient);
  const page = await db.query<{ id: string }>(
    `
      select id
      from pages
      where id = $1
        and file_id = $2
      limit 1
    `,
    [pageId, row.file_id]
  );

  if (!page.rows[0]) {
    return null;
  }

  return {
    access: createEditorAccess({
      role: null,
      source: "share-link"
    }),
    documentName: createCollabDocumentName(pageId),
    fileId: row.file_id,
    pageId,
    user: {
      avatarUrl: null,
      displayName: "Shared viewer",
      email: `share-link-${row.share_link_id}@openmirage.local`,
      id: `share-link-${row.share_link_id}`
    },
    workspaceId: row.workspace_id
  };
}

export async function getAuthorizedCollabPageSession(
  userId: string,
  workspaceId: string,
  fileId: string,
  pageId: string,
  poolOrClient?: Pool | PoolClient
): Promise<CollabPageSessionDto | null> {
  const db = requireClient(poolOrClient);
  const result = await db.query<AuthorizedCollabPageRow>(
    `
      select
        files.id as file_id,
        pages.id as page_id,
        memberships.role,
        users.avatar_url as user_avatar_url,
        users.display_name as user_display_name,
        users.email as user_email,
        users.id as user_id,
        files.workspace_id
      from pages
      inner join files
        on files.id = pages.file_id
      inner join memberships
        on memberships.workspace_id = files.workspace_id
      inner join users
        on users.id = memberships.user_id
      where memberships.user_id = $1
        and files.workspace_id = $2
        and files.id = $3
        and pages.id = $4
        and files.deleted_at is null
      limit 1
    `,
    [userId, workspaceId, fileId, pageId]
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    access: createEditorAccess({
      role: row.role,
      source: "membership"
    }),
    documentName: createCollabDocumentName(row.page_id),
    fileId: row.file_id,
    pageId: row.page_id,
    user: {
      avatarUrl: row.user_avatar_url,
      displayName: row.user_display_name,
      email: row.user_email,
      id: row.user_id
    },
    workspaceId: row.workspace_id
  };
}
