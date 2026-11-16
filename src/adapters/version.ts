import fs from 'fs';
import path from 'path';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string };

export const VERSION: string = pkg.version;
