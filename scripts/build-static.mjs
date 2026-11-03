// Vercel build: copies app/ to public/, the only folder served as static files.
// Nothing else in the repo (data/, server/, docs/) is reachable as a plain file;
// the API answers for the data.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'app'), out, { recursive: true });
const count = fs.readdirSync(out, { recursive: true }).length;
console.log(`Studio static build: app/ -> public/ (${count} entries)`);
