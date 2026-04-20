import { type ApplicationVersionInfo } from "@openmirage/types";
export {
  checkMetadataStore,
  createMetadataStoreContract,
  type MetadataStoreContract
} from "./contracts.js";
export {
  PgCollabPersistence,
  type CollabPersistenceSnapshotRow,
  type CollabPersistenceUpdateRow,
  type PageDocumentState,
  seedPageDocument,
  type PgCollabPersistenceOptions
} from "./collab-persistence.js";
export {
  checkDatabaseConnection,
  createDatabasePool,
  DEFAULT_DATABASE_URL,
  resolveDatabaseUrl
} from "./client.js";
export {
  hashToken,
  seedDevelopmentBootstrap,
  type DevelopmentBootstrapSummary
} from "./seed.js";
export {
  type ConsumedMagicLinkResult,
  consumeMagicLinkToken,
  deriveDisplayName,
  getAuthContextForSessionToken,
  issueMagicLinkForEmail,
  refreshSession,
  revokeSession,
  upsertUserByEmail,
  type IssuedMagicLinkToken,
  type IssuedSession,
  type MagicLinkRequestResult,
  type UpsertUserInput
} from "./auth.js";
export {
  claimNextQueuedExportJob,
  createAsset,
  createComment,
  createDerivedAssetRecord,
  createExportJob,
  createFileWithPages,
  createFileShareLink,
  createPage,
  failStaleRunningExportJobs,
  findNextFileMissingThumbnail,
  findNextPageMissingThumbnail,
  getAuthorizedExportJob,
  getAuthorizedAsset,
  getAuthorizedCollabPageSession,
  getFileById,
  getPageById,
  getSharedAsset,
  getSharedCollabPageSession,
  getSharedFileOpenDetails,
  getWorkspaceLaunchpad,
  hardDeleteAssetRecord,
  listDeletedThumbnailAssetsForCleanup,
  listRenderableAssetsForFile,
  createProject,
  listAssets,
  listComments,
  listFileShareLinks,
  listPagesForFileId,
  listSharedAssets,
  markAssetDeleted,
  markExportJobFailed,
  markExportJobSucceeded,
  getFileOpenDetails,
  listAuthorizedWorkspaces,
  listFilePages,
  listProjectFiles,
  listWorkspaceProjects,
  replaceFileThumbnailAsset,
  replacePageThumbnailAsset,
  revokeFileShareLink,
  resolveComment,
  renameFile,
  renamePage,
  renameProject
} from "./metadata.js";

export function getApplicationVersionInfo(
  release: string
): ApplicationVersionInfo {
  return {
    release,
    schemaVersion: "unmigrated"
  };
}
