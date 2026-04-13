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

export function getApplicationVersionInfo(
  release: string
): ApplicationVersionInfo {
  return {
    release,
    schemaVersion: "unmigrated"
  };
}
