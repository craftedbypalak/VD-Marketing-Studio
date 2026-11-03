// Test helper: the store interface (ARCHITECTURE.md section 3) as one suite, so
// every adapter (the JSON files today, Google Sheets in phase 2) passes the same
// checks. `make()` returns a fresh, empty store with the standard collections.
//
//   import { storeContract } from './_storeContract.mjs';
//   storeContract('json', () => createJsonStore(tmpDir()));

import assert from 'node:assert/strict';
import { test } from 'node:test';

export function storeContract(label, make) {
  test(`${label}: put inserts, stamps createdAt and updatedAt, and get returns a copy`, async () => {
    const s = await make();
    const stored = await s.put('pieces', { id: 'pc-0001', hook: 'One', pis: { problem: 'p' } });
    assert.ok(stored.createdAt && stored.updatedAt);
    const got = s.get('pieces', 'pc-0001');
    assert.equal(got.hook, 'One');
    got.hook = 'changed outside';
    got.pis.problem = 'changed outside';
    assert.equal(s.get('pieces', 'pc-0001').hook, 'One');
    assert.equal(s.get('pieces', 'pc-0001').pis.problem, 'p');
    assert.equal(s.get('pieces', 'missing'), null);
  });

  test(`${label}: put replaces by id and keeps createdAt`, async () => {
    const s = await make();
    const first = await s.put('events', { id: 'ev-0001', name: 'A', createdAt: '2026-01-01T00:00:00.000Z' });
    await new Promise((r) => setTimeout(r, 5));
    const second = await s.put('events', { id: 'ev-0001', name: 'B' });
    assert.equal(second.createdAt, first.createdAt);
    assert.notEqual(second.updatedAt, first.updatedAt);
    assert.equal(s.list('events').length, 1);
    assert.equal(s.get('events', 'ev-0001').name, 'B');
  });

  test(`${label}: list filters and returns copies`, async () => {
    const s = await make();
    await s.put('pieces', { id: 'pc-0001', status: 'draft' });
    await s.put('pieces', { id: 'pc-0002', status: 'in-review' });
    assert.equal(s.list('pieces').length, 2);
    assert.deepEqual(s.list('pieces', (p) => p.status === 'in-review').map((p) => p.id), ['pc-0002']);
    s.list('pieces')[0].status = 'changed outside';
    assert.equal(s.get('pieces', 'pc-0001').status, 'draft');
  });

  test(`${label}: patch merges shallowly, keeps the id and createdAt; null when missing`, async () => {
    const s = await make();
    const first = await s.put('campaigns', { id: 'cp-0001', name: 'Launch', notes: 'n' });
    const patched = await s.patch('campaigns', 'cp-0001', { notes: 'm', id: 'other' });
    assert.equal(patched.id, 'cp-0001');
    assert.equal(patched.name, 'Launch');
    assert.equal(patched.notes, 'm');
    assert.equal(patched.createdAt, first.createdAt);
    assert.equal(await s.patch('campaigns', 'cp-9999', { notes: 'x' }), null);
  });

  test(`${label}: remove deletes and reports whether it did`, async () => {
    const s = await make();
    await s.put('videos', { id: 'vd-0001' });
    assert.equal(await s.remove('videos', 'vd-0001'), true);
    assert.equal(await s.remove('videos', 'vd-0001'), false);
    assert.equal(s.get('videos', 'vd-0001'), null);
  });

  test(`${label}: nextId counts up past existing ids within the collection`, async () => {
    const s = await make();
    assert.equal(s.nextId('pc'), 'pc-0001');
    await s.put('pieces', { id: 'pc-0041' });
    await s.put('pieces', { id: 'e01-follow-up' });
    assert.equal(s.nextId('pc'), 'pc-0042');
    assert.equal(s.nextId('sl'), 'sl-0001');
  });

  test(`${label}: log appends an entry with who, what and ref`, async () => {
    const s = await make();
    const a = await s.log('someone@example.test', 'piece.approve', { pieceId: 'pc-0001' });
    const b = await s.log(null, 'slots.regenerate');
    assert.equal(a.by, 'someone@example.test');
    assert.equal(b.ref, null);
    assert.notEqual(a.id, b.id);
    assert.deepEqual(s.list('log').map((e) => e.what), ['piece.approve', 'slots.regenerate']);
  });

  test(`${label}: getSingleton reads rules and settings; refuses other collections`, async () => {
    const s = await make();
    assert.equal(s.getSingleton('settings'), null);
    await s.put('settings', { id: 'settings', users: [] });
    assert.deepEqual(s.getSingleton('settings').users, []);
    assert.throws(() => s.getSingleton('pieces'));
  });

  test(`${label}: an unknown collection is refused`, async () => {
    const s = await make();
    assert.throws(() => s.list('people'));
  });
}
