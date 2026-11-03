// One-time update of data/events.json (3 November 2026), safe to re-run:
//   - every event gets a `category` (festival, national, business, wedding, local, break)
//   - festival wishes go to everyone: whoGets 'everyone' and every tier
//
//   node scripts/migrate-occasions.mjs [dataDir]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.argv[2] || path.join(root, 'data'));
process.env.STUDIO_ROOT = path.dirname(dataDir);
const { categoryOf, tiersFor } = await import('../server/recurring.mjs');

const file = path.join(dataDir, 'events.json');
const events = JSON.parse(fs.readFileSync(file, 'utf8'));
const counts = {};
let wishes = 0;
for (const ev of events) {
  ev.category = categoryOf(ev);
  counts[ev.category] = (counts[ev.category] || 0) + 1;
  const tiers = tiersFor(ev);
  if (ev.greetingText && ['greeting', 'greeting-only'].includes(ev.kind)) {
    ev.whoGets = 'everyone';
    ev.tiers = tiers;
    wishes += 1;
  }
}
fs.writeFileSync(file, JSON.stringify(events, null, 2) + '\n');
console.log(`events: ${events.length}; categories: ${JSON.stringify(counts)}; wishes to everyone: ${wishes}`);
