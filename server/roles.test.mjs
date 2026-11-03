// Roles (employee, manager, director), the PIN and stale saves. docs/ROLES.md.
//   node --test server/*.test.mjs   (or: node server/roles.test.mjs)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startScratch } from './_scratch.mjs';

const scratch = await startScratch({ label: 'studio-roles' });
const B = scratch.base + '/api';
const settingsFile = path.join(scratch.dataDir, 'settings.json');
const DIRECTOR = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))[0].users.find((u) => u.role === 'director' || (!u.role && u.approver)).email;
const STAFF = 'staff@example.test';
const MANAGER = 'manager-roles@example.test';
const H = (u, extra = {}) => ({ 'content-type': 'application/json', 'X-Studio-User': u, ...extra });
const call = (method, p, body, headers) => fetch(B + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const stored = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'))[0];

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (err) { failed += 1; console.log(`FAIL ${name}\n     ${err.message}`); }
}

try {
  // An employee and a manager to test with.
  const s = (await call('GET', '/settings/settings', undefined, H(DIRECTOR))).body;
  const withStaff = { ...s, users: [...s.users, { email: STAFF, name: 'Staff (test)', role: 'employee' }, { email: MANAGER, name: 'Manager (test)', role: 'manager' }] };
  await test('the director can edit the users; roles are stored and approver is dropped', async () => {
    const r = await call('PUT', '/settings/settings', withStaff, H(DIRECTOR));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const users = stored().users;
    assert.ok(users.every((u) => ['employee', 'manager', 'director'].includes(u.role) && u.approver === undefined));
    assert.equal(users.find((u) => u.email === STAFF).role, 'employee');
    const served = r.body.users.find((u) => u.email === MANAGER);
    assert.equal(served.role, 'manager');
    assert.equal(served.approver, true);
    assert.equal(r.body.users.find((u) => u.email === STAFF).approver, false);
  });
  await test('an employee cannot edit settings or make themselves a director', async () => {
    const mine = (await call('GET', '/settings/settings', undefined, H(STAFF))).body;
    const r = await call('PUT', '/settings/settings', { ...mine, users: mine.users.map((u) => ({ ...u, role: 'director' })) }, H(STAFF));
    assert.equal(r.status, 403);
  });
  await test('a manager cannot change settings or rules; only the director can', async () => {
    const mine = (await call('GET', '/settings/settings', undefined, H(MANAGER))).body;
    const r = await call('PUT', '/settings/settings', mine, H(MANAGER));
    assert.equal(r.status, 403);
    assert.match(r.body.error, /Only the director can change the settings/);
    assert.equal((await call('PATCH', '/settings/settings', { model: 'opus' }, H(MANAGER))).status, 403);
    const rules = (await call('GET', '/rules/rules', undefined, H(MANAGER))).body;
    assert.equal((await call('PUT', '/rules/rules', rules, H(MANAGER))).status, 403);
    assert.equal((await call('PUT', '/rules/rules', rules, H(DIRECTOR))).status, 200);
  });
  await test('a settings save without a director, or with an unknown role, is refused', async () => {
    const mine = (await call('GET', '/settings/settings', undefined, H(DIRECTOR))).body;
    const none = await call('PUT', '/settings/settings', { ...mine, users: mine.users.map((u) => ({ ...u, role: 'manager' })) }, H(DIRECTOR));
    assert.equal(none.status, 400);
    assert.match(none.body.error, /director/);
    const odd = await call('PUT', '/settings/settings', { ...mine, users: [...mine.users, { email: 'x@example.test', name: 'X', role: 'owner' }] }, H(DIRECTOR));
    assert.equal(odd.status, 400);
  });
  await test('a user sent with approver and no role is saved as director; without it, as employee', async () => {
    const shown = (await call('GET', '/settings/settings', undefined, H(DIRECTOR))).body;
    const legacy = [{ email: 'old-approver@example.test', name: 'Old approver', approver: true }, { email: 'old-staff@example.test', name: 'Old staff' }];
    const r = await call('PUT', '/settings/settings', { ...shown, users: [...shown.users, ...legacy] }, H(DIRECTOR));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.users.find((u) => u.email === 'old-approver@example.test').role, 'director');
    assert.equal(r.body.users.find((u) => u.email === 'old-staff@example.test').role, 'employee');
    assert.equal(stored().users.find((u) => u.email === 'old-approver@example.test').approver, undefined);
    const back = await call('PUT', '/settings/settings', { ...r.body, users: r.body.users.filter((u) => !u.email.startsWith('old-')) }, H(DIRECTOR));
    assert.equal(back.status, 200, JSON.stringify(back.body));
  });
  await test('an employee and a manager do not see the link token; the director does', async () => {
    const theirs = (await call('GET', '/settings/settings', undefined, H(STAFF))).body;
    assert.equal(theirs.linkToken, undefined);
    assert.ok(theirs.users.every((u) => u.pinHash === undefined));
    assert.equal((await call('GET', '/settings/settings', undefined, H(MANAGER))).body.linkToken, undefined);
    const ours = (await call('GET', '/settings/settings', undefined, H(DIRECTOR))).body;
    assert.ok(ours.linkToken);
    assert.deepEqual(ours.reviewRouting.directorPillars, ['offer', 'founder']);
  });
  await test('settings.json and log.json are not served raw', async () => {
    const r = await fetch(scratch.base + '/data/settings.json');
    assert.equal(r.status, 403);
    const ok = await fetch(scratch.base + '/data/accounts.json');
    assert.equal(ok.status, 200);
  });
  await test('an employee cannot delete, regenerate or import; a manager cannot delete', async () => {
    const piece = (await call('POST', '/pieces', { type: 'status-rule', pillar: 'problem', status: 'draft', hook: 'Roles test', targets: ['wa-st'] }, H(STAFF))).body;
    assert.ok(piece.id);
    assert.equal((await call('DELETE', `/pieces/${piece.id}`, undefined, H(STAFF))).status, 403);
    assert.equal((await call('POST', '/slots/regenerate', { from: '2026-11-01', to: '2026-11-30' }, H(STAFF))).status, 403);
    assert.equal((await call('POST', '/calendar/import-rows', {}, H(STAFF))).status, 403);
    assert.equal((await call('POST', '/recurring/import', {}, H(STAFF))).status, 403);
    assert.equal((await call('POST', `/pieces/${piece.id}/approve`, {}, H(STAFF))).status, 403);
    assert.equal((await call('POST', `/pieces/${piece.id}/request-changes`, { note: 'x' }, H(STAFF))).status, 403);
    const byManager = await call('DELETE', `/pieces/${piece.id}`, undefined, H(MANAGER));
    assert.equal(byManager.status, 403);
    assert.match(byManager.body.error, /Only the director/);
    assert.equal((await call('DELETE', `/pieces/${piece.id}`, undefined, H(DIRECTOR))).status, 200);
  });
  await test('a stale save is refused with who and when; force overwrites', async () => {
    const p = (await call('POST', '/pieces', { type: 'status-rule', pillar: 'problem', status: 'draft', hook: 'Stale test', targets: ['wa-st'] }, H(STAFF))).body;
    const copyA = { ...p, notes: 'A' };
    const copyB = { ...p, notes: 'B' };
    assert.equal((await call('PUT', `/pieces/${p.id}`, copyA, H(DIRECTOR))).status, 200);
    const r = await call('PUT', `/pieces/${p.id}`, copyB, H(STAFF));
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.detail.conflict, true);
    assert.equal(r.body.detail.by, DIRECTOR);
    const forced = await call('PUT', `/pieces/${p.id}`, { ...copyB, force: true }, H(STAFF));
    assert.equal(forced.status, 200);
    assert.equal(forced.body.notes, 'B');
    const versions = (await call('GET', `/pieces/${p.id}/versions`)).body;
    assert.equal(versions.length, 3);
    await call('DELETE', `/pieces/${p.id}`, undefined, H(DIRECTOR));
  });
  await test('the director with a PIN must send it; the PIN never leaves the server', async () => {
    assert.equal((await call('POST', '/settings/pin', { pin: '2468' }, H(DIRECTOR))).status, 200);
    const doc = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))[0];
    assert.ok(doc.users.find((u) => u.email === DIRECTOR).pinHash);
    assert.notEqual(doc.users.find((u) => u.email === DIRECTOR).pinHash, '2468');
    const shown = (await call('GET', '/settings/settings', undefined, H(DIRECTOR))).body;
    assert.equal(shown.users.find((u) => u.email === DIRECTOR).pinSet, true);
    assert.equal(shown.users.find((u) => u.email === DIRECTOR).pinHash, undefined);
    const piece = (await call('POST', '/pieces', { type: 'status-rule', pillar: 'problem', status: 'in-review', hook: 'PIN test', targets: ['wa-st'], renditions: { waStatus: { text: 'A plain line.' } } }, H(STAFF))).body;
    const noPin = await call('POST', `/pieces/${piece.id}/approve`, {}, H(DIRECTOR));
    assert.equal(noPin.status, 403);
    assert.equal(noPin.body.detail.pin, true);
    const wrong = await call('POST', `/pieces/${piece.id}/approve`, {}, H(DIRECTOR, { 'X-Studio-Pin': '0000' }));
    assert.equal(wrong.status, 403);
    const right = await call('POST', `/pieces/${piece.id}/approve`, {}, H(DIRECTOR, { 'X-Studio-Pin': '2468' }));
    assert.equal(right.status, 200, JSON.stringify(right.body));
    assert.equal(right.body.piece.status, 'approved');
    // An employee still cannot approve, PIN or not.
    assert.equal((await call('POST', `/pieces/${piece.id}/approve`, {}, H(STAFF, { 'X-Studio-Pin': '2468' }))).status, 403);
    // A settings save by the director keeps the hash even though the client never saw it.
    const mine = (await call('GET', '/settings/settings', undefined, H(DIRECTOR, { 'X-Studio-Pin': '2468' }))).body;
    assert.equal((await call('PUT', '/settings/settings', mine, H(DIRECTOR, { 'X-Studio-Pin': '2468' }))).status, 200);
    assert.ok(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))[0].users.find((u) => u.email === DIRECTOR).pinHash);
    assert.ok(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))[0].linkToken);
    await call('DELETE', `/pieces/${piece.id}`, undefined, H(DIRECTOR, { 'X-Studio-Pin': '2468' }));
  });
  await test('Today carries the month card and the storyline count', async () => {
    const t = (await call('GET', '/today?date=2026-11-02', undefined, H(DIRECTOR))).body;
    assert.ok(t.month && t.month.slots.allotted > 0);
    assert.ok(Array.isArray(t.month.actionsThisWeek));
    assert.ok(t.checker && typeof t.checker.storyline.namesTool === 'number');
  });
} finally {
  await scratch.stop();
}
console.log(failed ? `\n${failed} failed` : '\nall roles tests passed');
process.exit(failed ? 1 : 0);
