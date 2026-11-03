// The JSON-file store against the store contract, and the workspace scope.
//   node --test server/*.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createJsonStore, store, withWorkspace, currentWorkspace } from './store.mjs';
import { storeContract } from './_storeContract.mjs';

const dirs = [];
const tmpDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-store-')); dirs.push(d); return d; };
process.on('exit', () => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

storeContract('json', () => createJsonStore(tmpDir()));

test('json: writes reach the file and a fresh store reads them back', async () => {
  const dir = tmpDir();
  const a = createJsonStore(dir);
  await a.put('pieces', { id: 'pc-0001', hook: 'Kept' });
  await a.flush();
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'pieces.json'), 'utf8'));
  assert.equal(onDisk[0].hook, 'Kept');
  assert.equal(createJsonStore(dir).get('pieces', 'pc-0001').hook, 'Kept');
});

test('the shared store follows the workspace of the current request, through awaits and timers', async () => {
  const one = createJsonStore(tmpDir());
  const two = createJsonStore(tmpDir());
  await one.put('pieces', { id: 'pc-0001', hook: 'One' });
  await two.put('pieces', { id: 'pc-0001', hook: 'Two' });
  const seen = await Promise.all([
    withWorkspace(one, async () => { await new Promise((r) => setTimeout(r, 10)); return [store.get('pieces', 'pc-0001').hook, currentWorkspace().id]; }, { id: 'one' }),
    withWorkspace(two, async () => { await new Promise((r) => setTimeout(r, 1)); return [store.get('pieces', 'pc-0001').hook, currentWorkspace().id]; }, { id: 'two' }),
  ]);
  assert.deepEqual(seen, [['One', 'one'], ['Two', 'two']]);
  await withWorkspace(two, () => store.put('pieces', { id: 'pc-0002', hook: 'Only two' }));
  assert.equal(one.get('pieces', 'pc-0002'), null);
  assert.equal(currentWorkspace(), null);
});
