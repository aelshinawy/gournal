// Public entry of the storage layer.
export { openJournal } from './journal';
export type { Journal } from './journal';
export { createActivityRepository } from './activity-repository';
export { exportBundle, importBundle } from './bundle';
export { backupDbIfNeeded } from './backup';
export { gournalHome, userHomePath } from './home';
export { ensurePrivateDir, renameWithRetry, writePrivateFile, writeExportFile, assertExportTarget, assertTargetDir } from './private-files';
export { importLegacy, applyPlan, renderPlanDiff } from './migrate';
export type { MigrationPlan } from './migrate';
export { CorruptDatabaseError } from './db';
export { AmbiguousIdError } from './sqlite-repository';
export { rebuildSearchIndex, hasFts5 } from './schema';
