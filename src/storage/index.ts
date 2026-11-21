// Public entry of the storage layer.
export { openJournal } from './journal';
export type { Journal } from './journal';
export { exportBundle, importBundle } from './bundle';
export { gournalHome, userHomePath } from './home';
export { ensurePrivateDir, writeViaTemp, writePrivateFile, writeExportFile, assertExportTarget } from './private-files';
export { rebuildSearchIndex, hasFts5 } from './search-index';
