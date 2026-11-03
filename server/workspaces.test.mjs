// Workspaces: one company each, the owner role and the isolation between them.
// docs/WORKSPACES.md.   node --test server/*.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import { startScratch } from './_scratch.mjs';

const scratch = await startScratch({ label: 'studio-workspaces' });
after(() => scratch.stop());
const B = scratch.base + '/api';
const master = JSON.parse(fs.readFileSync(path.join(scratch.dataDir, 'master', 'owners.json'), 'utf8'));
const OWNER = master[0].email;
const FIRST = JSON.parse(fs.readFileSync(path.join(scratch.dataDir, 'master', 'workspaces.json'), 'utf8'))[0].id;
const EMP = JSON.parse(fs.readFileSync(path.join(scratch.dataDir, 'settings.json'), 'utf8'))[0].users.find((u) => u.role === 'employee').email;
const BOSS = 'director@acme.example.test';

const H = (u, ws) => ({ 'content-type': 'application/json', ...(u ? { 'X-Studio-User': u } : {}), ...(ws ? { 'X-Studio-Workspace': ws } : {}) });
const call = (method, p, body, headers) => fetch(B + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

test('the owner sees the first workspace, and a request without a workspace works in it', async () => {
  const r = await call('GET', '/workspaces', undefined, H(OWNER));
  assert.equal(r.status, 200);
  assert.equal(r.body.owner, true);
  assert.equal(r.body.current.id, FIRST);
  assert.equal(r.body.workspaces.find((w) => w.id === FIRST).role, 'director');
  assert.equal(r.body.workspaces[0].dataDir, undefined);
  const me = await call('GET', '/me', undefined, H(OWNER));
  assert.equal(me.body.workspace.id, FIRST);
  assert.equal(me.body.owner, true);
});

test('an unknown workspace is refused with 404', async () => {
  const r = await call('GET', '/pieces', undefined, H(OWNER, 'nobody-here'));
  assert.equal(r.status, 404);
});

test('only an owner can create a workspace; a name and a director are required', async () => {
  assert.equal((await call('POST', '/workspaces', { name: 'Acme Foods', director: { email: BOSS } }, H(EMP))).status, 403);
  assert.equal((await call('POST', '/workspaces', { name: 'Acme Foods', director: { email: BOSS } })).status, 401);
  assert.equal((await call('POST', '/workspaces', { director: { email: BOSS } }, H(OWNER))).status, 400);
  assert.equal((await call('POST', '/workspaces', { name: 'Acme Foods' }, H(OWNER))).status, 400);
});

test('the owner creates a workspace with its own store and one director', async () => {
  const r = await call('POST', '/workspaces', { name: 'Acme Foods', director: { email: BOSS, name: 'Acme director' } }, H(OWNER));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.id, 'acme-foods');
  assert.equal(r.body.status, 'active');
  assert.equal(r.body.role, 'owner');
  const dir = path.join(scratch.root, 'data', 'workspaces', 'acme-foods');
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))[0];
  assert.deepEqual(settings.users, [{ email: BOSS, name: 'Acme director', role: 'director' }]);
  assert.ok(fs.existsSync(path.join(dir, 'rules.json')));
  assert.equal((await call('POST', '/workspaces', { name: 'Acme Foods', director: { email: BOSS } }, H(OWNER))).status, 409);
});

test('a workspace\'s data stays in it', async () => {
  const before = (await call('GET', '/pieces', undefined, H(EMP))).body.length;
  const made = await call('POST', '/pieces', { type: 'linkedin-text', pillar: 'problem', status: 'draft', hook: 'Only for Acme' }, H(BOSS, 'acme-foods'));
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.id, 'pc-0001');
  const theirs = (await call('GET', '/pieces', undefined, H(BOSS, 'acme-foods'))).body;
  assert.deepEqual(theirs.map((p) => p.hook), ['Only for Acme']);
  const ours = (await call('GET', '/pieces', undefined, H(EMP))).body;
  assert.equal(ours.length, before);
  assert.ok(!ours.some((p) => p.hook === 'Only for Acme'));
  const file = path.join(scratch.root, 'data', 'workspaces', 'acme-foods', 'pieces.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].hook, 'Only for Acme');
});

test('the checker and the review path work in a new workspace with an empty profile', async () => {
  const check = await call('POST', '/pieces/pc-0001/check', {}, H(BOSS, 'acme-foods'));
  assert.equal(check.status, 200, JSON.stringify(check.body));
  const sub = await call('PATCH', '/pieces/pc-0001', { status: 'in-review' }, H(BOSS, 'acme-foods'));
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  const ok = await call('POST', '/pieces/pc-0001/approve', {}, H(BOSS, 'acme-foods'));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.piece.status, 'approved');
  assert.equal(ok.body.piece.approvedRole, 'director');
});

test('a member of one workspace cannot enter another', async () => {
  const outside = await call('GET', '/pieces', undefined, H(BOSS));
  assert.equal(outside.status, 403);
  assert.match(outside.body.error, /not a member/);
  assert.equal((await call('GET', '/pieces', undefined, H(EMP, 'acme-foods'))).status, 403);
  assert.equal((await call('GET', '/workspaces/acme-foods', undefined, H(EMP))).status, 403);
  // The workspace list still answers, and shows only their own.
  const list = await call('GET', '/workspaces', undefined, H(BOSS));
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.workspaces.map((w) => [w.id, w.role]), [['acme-foods', 'director']]);
  assert.equal(list.body.owner, false);
});

test('the owner enters any workspace as its director', async () => {
  const me = await call('GET', '/me', undefined, H(OWNER, 'acme-foods'));
  assert.equal(me.body.role, 'director');
  assert.equal(me.body.workspace.id, 'acme-foods');
  assert.equal(me.body.can.settings, true);
  const s = (await call('GET', '/settings/settings', undefined, H(OWNER, 'acme-foods'))).body;
  const saved = await call('PUT', '/settings/settings', { ...s, users: [...s.users, { email: 'writer@acme.example.test', name: 'Writer', role: 'employee' }] }, H(OWNER, 'acme-foods'));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const writer = await call('GET', '/me', undefined, H('writer@acme.example.test', 'acme-foods'));
  assert.equal(writer.body.role, 'employee');
  assert.equal((await call('POST', '/pieces/pc-0001/approve', {}, H('writer@acme.example.test', 'acme-foods'))).status, 403);
});

test('a paused or archived workspace is closed to its members, not to the owner', async () => {
  assert.equal((await call('PATCH', '/workspaces/acme-foods', { status: 'archived' }, H(BOSS, 'acme-foods'))).status, 403);
  assert.equal((await call('PATCH', '/workspaces/acme-foods', { status: 'gone' }, H(OWNER))).status, 400);
  const r = await call('PATCH', '/workspaces/acme-foods', { status: 'archived', sheetId: 'sheet-123' }, H(OWNER));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sheetId, 'sheet-123');
  assert.equal((await call('GET', '/pieces', undefined, H(BOSS, 'acme-foods'))).status, 403);
  assert.equal((await call('GET', '/pieces', undefined, H(OWNER, 'acme-foods'))).status, 200);
  assert.deepEqual((await call('GET', '/workspaces', undefined, H(BOSS))).body.workspaces, []);
  assert.equal((await call('PATCH', '/workspaces/acme-foods', { status: 'active' }, H(OWNER))).status, 200);
  assert.equal((await call('GET', '/pieces', undefined, H(BOSS, 'acme-foods'))).status, 200);
});

test('the master registry and other workspaces are not served under /data', async () => {
  assert.equal((await fetch(`${scratch.base}/data/master/workspaces.json`)).status, 403);
  assert.equal((await fetch(`${scratch.base}/data/master/owners.json`)).status, 403);
  assert.equal((await fetch(`${scratch.base}/data/workspaces/acme-foods/pieces.json`)).status, 403);
  assert.equal((await fetch(`${scratch.base}/data/pieces.json`)).status, 200);
});
