import { readFileSync } from 'node:fs';
import * as path from 'node:path';

/** Version aus package.json (im Container liegt sie neben dist/) */
export const version: string = (JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;
