// Public entry of the storage layer.
export { openJournal } from './journal';
export type { Journal } from './journal';
export { exportBundle, importBundle } from './bundle';
export { backupDbIfNeeded } from './backup';
export { gournalHome } from './home';
export { importLegacy, applyPlan, renderPlanDiff } from './migrate';
export type { MigrationPlan } from './migrate';
export { CorruptDatabaseError } from './db';
export { AmbiguousIdError } from './sqlite-repository';
export { rebuildSearchIndex, hasFts5 } from './schema';
