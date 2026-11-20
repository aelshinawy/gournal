import fs from 'fs';
import path from 'path';

/** Write a small gournal package: package.json, dist/cli.js, and each dependency under node_modules. */
export function makeFakePackage(dir: string, version: string, deps: Record<string, string> = { dep: '1.0.0' }): string {
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'gournal', version, dependencies: deps }));
  fs.writeFileSync(path.join(dir, 'dist', 'cli.js'), "console.log('fake')");
  for (const [name, depVersion] of Object.entries(deps)) {
    const depDir = path.join(dir, 'node_modules', name);
    fs.mkdirSync(depDir, { recursive: true });
    fs.writeFileSync(path.join(depDir, 'package.json'), JSON.stringify({ name, version: depVersion }));
  }
  return dir;
}
