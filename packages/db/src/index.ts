import { type ApplicationVersionInfo } from "@openmirage/types";
export {
  checkMetadataStore,
  createMetadataStoreContract,
  type MetadataStoreContract
} from "./contracts.js";
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

export function getApplicationVersionInfo(
  release: string
): ApplicationVersionInfo {
  return {
    release,
    schemaVersion: "unmigrated"
  };
}
