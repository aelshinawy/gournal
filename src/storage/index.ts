// Public entry of the storage layer.
export { openJournal } from './journal';
export type { Journal } from './journal';
export { exportBundle, importBundle } from './bundle';
export { gournalHome, userHomePath } from './home';
export { ensurePrivateDir, writeViaTemp, writePrivateFile, writeExportFile, assertExportTarget, assertTargetDir } from './private-files';
export { importLegacy } from './legacy/legacy-import';
export { applyPlan, renderPlanDiff } from './legacy/migration-plan';
export type { MigrationPlan } from './legacy/migration-plan';
export { rebuildSearchIndex, hasFts5 } from './schema';
