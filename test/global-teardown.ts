import fs from 'fs';

export default function globalTeardown(): void {
  const dir = process.env.GOURNAL_TEST_HOME_ROOT;
  if (dir && dir.includes('gournal-test-home-')) fs.rmSync(dir, { recursive: true, force: true });
}
