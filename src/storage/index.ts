// Public entry of the storage layer.
export { openJournal } from './journal';
export type { Journal } from './journal';
export { exportBundle, importBundle } from './bundle';
export { gournalHome, userHomePath } from './home';
export { ensurePrivateDir, renameWithRetry, writePrivateFile, writeExportFile, assertExportTarget, assertTargetDir } from './private-files';
export { importLegacy, applyPlan, renderPlanDiff } from './migrate';
export type { MigrationPlan } from './migrate';
export { rebuildSearchIndex, hasFts5 } from './schema';
