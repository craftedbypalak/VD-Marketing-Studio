// Link routes test: the read-only routes the Network tool pulls from.
//   node --test server/   (or: node server/link.test.mjs)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startScratch } from './_scratch.mjs';

const scratch = await startScratch({ label: 'studio-link' });
const settings = JSON.parse(fs.readFileSync(path.join(scratch.dataDir, 'settings.json'), 'utf8'))[0];
const token = settings.linkToken;
const get = (p, headers = {}) => fetch(`${scratch.base}${p}`, { headers }).then(async (r) => ({ status: r.status, body: await r.json() }));

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (err) { failed += 1; console.log(`FAIL ${name}\n     ${err.message}`); }
}

try {
  await test('settings carry a link token', async () => { assert.ok(token && token.length >= 32); });

  await test('events without a token are refused with 401', async () => {
    const r = await get('/api/link/events?from=2026-11-01&to=2026-11-30');
    assert.equal(r.status, 401);
  });
  await test('events with a wrong token are refused with 401', async () => {
    const r = await get('/api/link/events?from=2026-11-01&to=2026-11-30', { 'X-Link-Token': 'wrong' });
    assert.equal(r.status, 401);
  });
  await test('pieces without a token are refused with 401', async () => {
    const r = await get('/api/link/pieces?status=approved');
    assert.equal(r.status, 401);
  });
  await test('events with the token answer in the link shape', async () => {
    const r = await get('/api/link/events?from=2026-11-01&to=2026-11-30', { 'X-Link-Token': token });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body) && r.body.length > 0);
    const diwali = r.body.find((e) => /^Diwali/.test(e.name) && e.kind === 'greeting');
    assert.ok(diwali, 'Diwali is in November 2026');
    assert.deepEqual(Object.keys(diwali).sort(), ['community', 'date', 'greetingText', 'id', 'kind', 'name', 'postingRule', 'scope', 'tiers', 'wording'].sort());
    assert.deepEqual(diwali.tiers, ['platinum', 'gold', 'silver', 'bronze']);
    assert.equal(typeof diwali.wording.whatsapp, 'string');
    assert.ok(r.body.every((e) => e.date >= '2026-11-01' && e.date <= '2026-11-30'));
  });
  await test('events need a valid range', async () => {
    const r = await get('/api/link/events?from=2026-11-01', { 'X-Link-Token': token });
    assert.equal(r.status, 400);
  });
  await test('pieces with the token answer in the link shape', async () => {
    const r = await get('/api/link/pieces?status=approved', { 'X-Link-Token': token });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    for (const p of r.body) assert.deepEqual(Object.keys(p).sort(), ['accountId', 'channel', 'hook', 'id', 'publishedAt', 'solutionId', 'title', 'url'].sort());
    const all = await get('/api/link/pieces', { 'X-Link-Token': token });
    assert.equal(all.status, 200);
  });
  await test('pieces refuse an unknown status', async () => {
    const r = await get('/api/link/pieces?status=draft', { 'X-Link-Token': token });
    assert.equal(r.status, 400);
  });
  await test('no person collection is served', async () => {
    const r = await get('/api/people');
    assert.equal(r.status, 404);
    const t = await get('/api/touches');
    assert.equal(t.status, 404);
  });
} finally {
  await scratch.stop();
}
console.log(failed ? `\n${failed} failed` : '\nall link tests passed');
process.exit(failed ? 1 : 0);
