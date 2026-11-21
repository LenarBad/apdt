export { PRODUCTION_MIGRATIONS } from "./registry.js";
export {
  resolveInstalledTemplateVersion,
  runPendingMigrations,
} from "./run.js";
export type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./types.js";
export { compareVersions, versionLt, versionLte } from "./versions.js";
