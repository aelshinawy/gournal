import fs from 'fs-extra';
import path from 'path';

export const VERSION: string = fs.readJsonSync(path.join(__dirname, '..', 'package.json')).version;
