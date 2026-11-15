import { execSync } from 'child_process';
import path from 'path';

export function getProjectName(cwd: string = process.cwd()): string {
  try {
    const gitDir = execSync('git rev-parse --show-toplevel 2> /dev/null', { cwd })
      .toString()
      .trim();
    return path.basename(gitDir);
  } catch (error) {
    return path.basename(`uncategorized`);
  }
}