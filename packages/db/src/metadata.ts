import {
  type CollabPageSessionDto,
  type CommentDto,
  type CreateFilePageInput,
  type FileDto,
  type FileOpenResponse,
  type ListCommentsInput,
  type PageDto,
  type ProjectDto,
  type CreateCommentInput,
  type ResolveCommentInput,
  type WorkspaceDetailDto,
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
  updated_at: Date;
  width: number | null;
}

interface AuthorizedCollabPageRow {
  file_id: string;
  page_id: string;
  user_avatar_url: string | null;
  user_display_name: string;
  user_email: string;
  user_id: string;
  workspace_id: string;
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

    if (!workspace) {
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

    if (!workspace) {
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
    const file = await getFileRow(
      userId,
      workspaceId,
      projectId,
      fileId,
      client
    );

    if (!file) {
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
