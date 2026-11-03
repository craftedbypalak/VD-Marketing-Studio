// The review path: employee, manager, director (docs/ROLES.md sections 2 and 3).
//   node --test server/*.test.mjs   (or: node server/workflow.test.mjs)

import assert from 'node:assert/strict';
import { startScratch } from './_scratch.mjs';

const scratch = await startScratch({ label: 'studio-workflow' });
const B = scratch.base + '/api';
const EMP = 'employee@venturedrafters.test';
const MGR = 'manager@venturedrafters.test';
const DIR = 'tools@vspindia.com';
const H = (u, extra = {}) => ({ 'content-type': 'application/json', ...(u ? { 'X-Studio-User': u } : {}), ...extra });
const call = (method, p, body, headers) => fetch(B + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// A piece the checker passes; `pillar: 'offer'` makes it one that must reach the director.
const draft = (hook, extra = {}) => ({ type: 'status-rule', pillar: 'problem', status: 'draft', hook, targets: ['wa-st'], renditions: { waStatus: { text: 'A plain line.' } }, ...extra });
const create = async (hook, extra) => (await call('POST', '/pieces', draft(hook, extra), H(EMP))).body;
const submit = async (id) => (await call('PATCH', `/pieces/${id}`, { status: 'in-review' }, H(EMP))).body;
const get = async (id) => (await call('GET', `/pieces/${id}`, undefined, H(EMP))).body;

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (err) { failed += 1; console.log(`FAIL ${name}\n     ${err.message}`); }
}

try {
  await test('GET /api/me gives each role its can flags, and none without a user', async () => {
    const none = (await call('GET', '/me', undefined, H(null))).body;
    assert.equal(none.role, null);
    assert.ok(Object.values(none.can).every((v) => v === false));
    const emp = (await call('GET', '/me', undefined, H(EMP))).body;
    assert.equal(emp.role, 'employee');
    assert.equal(emp.name, 'Marketing Employee (demo)');
    assert.deepEqual(emp.can, { approve: false, escalate: false, approveForDirector: false, settings: false, delete: false, recordPosted: false });
    const mgr = (await call('GET', '/me', undefined, H(MGR))).body;
    assert.equal(mgr.role, 'manager');
    assert.deepEqual(mgr.can, { approve: true, escalate: true, approveForDirector: false, settings: false, delete: false, recordPosted: true });
    const dir = (await call('GET', '/me', undefined, H(DIR))).body;
    assert.equal(dir.role, 'director');
    assert.ok(Object.values(dir.can).every((v) => v === true));
    assert.equal(typeof dir.pinSet, 'boolean');
  });

  let plain;
  await test('submitting writes the trail; the review fields cannot be set by a client', async () => {
    plain = await create('Review path plain piece', { reviewTrail: [{ action: 'approved' }], escalation: { note: 'forged' } });
    assert.equal(plain.reviewTrail, undefined);
    assert.equal(plain.escalation, undefined);
    const p = await submit(plain.id);
    assert.equal(p.status, 'in-review');
    assert.equal(p.reviewTrail.length, 1);
    assert.equal(p.reviewTrail[0].action, 'submitted');
    assert.equal(p.reviewTrail[0].by, EMP);
    assert.equal(p.reviewTrail[0].role, 'employee');
    assert.ok(p.reviewTrail[0].at);
    // Saving again in in-review adds nothing.
    const again = (await call('PATCH', `/pieces/${plain.id}`, { notes: 'x', status: 'in-review' }, H(EMP))).body;
    assert.equal(again.reviewTrail.length, 1);
  });

  await test('an employee cannot approve, escalate, return or request changes, nor set the status by hand', async () => {
    assert.equal((await call('POST', `/pieces/${plain.id}/approve`, {}, H(EMP))).status, 403);
    const esc = await call('POST', `/pieces/${plain.id}/escalate`, { note: 'x' }, H(EMP));
    assert.equal(esc.status, 403);
    assert.match(esc.body.error, /Only a manager or the director/);
    assert.equal((await call('POST', `/pieces/${plain.id}/request-changes`, { note: 'x' }, H(EMP))).status, 403);
    assert.equal((await call('POST', `/pieces/${plain.id}/return`, { note: 'x' }, H(EMP))).status, 403);
    assert.equal((await call('PATCH', `/pieces/${plain.id}`, { status: 'approved' }, H(EMP))).status, 403);
    assert.equal((await call('PATCH', `/pieces/${plain.id}`, { status: 'director-review' }, H(EMP))).status, 403);
    assert.equal((await call('POST', '/pieces', draft('Forged approval', { status: 'approved' }), H(EMP))).status, 403);
    assert.equal((await call('POST', `/pieces/${plain.id}/approve`, {}, H(null))).status, 401);
  });

  let routed;
  await test('the queue has the three buckets, decorated, oldest first', async () => {
    routed = await create('Review path offer piece', { pillar: 'offer' });
    await submit(routed.id);
    const mgrQ = (await call('GET', '/review/queue', undefined, H(MGR))).body;
    assert.ok(Array.isArray(mgrQ.manager) && Array.isArray(mgrQ.director) && Array.isArray(mgrQ.mine));
    const ids = mgrQ.manager.map((p) => p.id);
    assert.ok(ids.includes(plain.id) && ids.includes(routed.id));
    assert.ok(ids.indexOf(plain.id) < ids.indexOf(routed.id), 'oldest first');
    const r = mgrQ.manager.find((p) => p.id === routed.id);
    assert.equal(r.needsDirector, true);
    assert.equal(r.needsDirectorWhy, 'Pieces on the offer pillar go to the director');
    const q = mgrQ.manager.find((p) => p.id === plain.id);
    assert.equal(q.needsDirector, false);
    assert.equal(q.needsDirectorWhy, null);
    assert.ok(!mgrQ.mine.some((p) => p.id === plain.id), 'the manager did not write it');
    const empQ = (await call('GET', '/review/queue', undefined, H(EMP))).body;
    assert.ok(empQ.mine.some((p) => p.id === plain.id) && empQ.mine.some((p) => p.id === routed.id));
  });

  await test('a manager approves an ordinary piece', async () => {
    const r = await call('POST', `/pieces/${plain.id}/approve`, {}, H(MGR));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.piece.status, 'approved');
    assert.equal(r.body.piece.approvedBy, MGR);
    assert.equal(r.body.piece.approvedRole, 'manager');
    assert.deepEqual(r.body.piece.reviewTrail.map((e) => e.action), ['submitted', 'approved']);
    assert.equal(r.body.piece.reviewTrail[1].role, 'manager');
    // Approving again is refused: it is no longer in review.
    assert.equal((await call('POST', `/pieces/${plain.id}/approve`, {}, H(MGR))).status, 409);
  });

  await test('a manager is refused on a piece that must reach the director, and sends it there', async () => {
    const r = await call('POST', `/pieces/${routed.id}/approve`, {}, H(MGR));
    assert.equal(r.status, 409);
    assert.equal(r.body.detail.needsDirector, true);
    assert.equal(r.body.detail.why, 'Pieces on the offer pillar go to the director');
    assert.equal((await get(routed.id)).status, 'in-review');
    assert.equal((await call('POST', `/pieces/${routed.id}/escalate`, {}, H(MGR))).status, 400);
    const e = await call('POST', `/pieces/${routed.id}/escalate`, { note: 'Offer wording, please check the price line.' }, H(MGR));
    assert.equal(e.status, 200, JSON.stringify(e.body));
    assert.equal(e.body.status, 'director-review');
    assert.equal(e.body.escalation.note, 'Offer wording, please check the price line.');
    assert.equal(e.body.escalation.by, MGR);
    assert.equal(e.body.reviewTrail.at(-1).action, 'escalated');
    // With the director, the manager can neither approve, request changes nor return it.
    assert.equal((await call('POST', `/pieces/${routed.id}/approve`, {}, H(MGR))).status, 403);
    assert.equal((await call('POST', `/pieces/${routed.id}/request-changes`, { note: 'x' }, H(MGR))).status, 403);
    assert.equal((await call('POST', `/pieces/${routed.id}/return`, { note: 'x' }, H(MGR))).status, 403);
    assert.equal((await call('POST', `/pieces/${routed.id}/escalate`, { note: 'x' }, H(MGR))).status, 409);
    const q = (await call('GET', '/review/queue', undefined, H(DIR))).body;
    assert.ok(q.director.some((p) => p.id === routed.id));
    assert.ok(!q.manager.some((p) => p.id === routed.id));
  });

  await test('the director returns a piece to the manager with a note', async () => {
    assert.equal((await call('POST', `/pieces/${routed.id}/return`, {}, H(DIR))).status, 400);
    const r = await call('POST', `/pieces/${routed.id}/return`, { note: 'Fine by me; your call on the wording.' }, H(DIR));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'in-review');
    const last = r.body.reviewTrail.at(-1);
    assert.equal(last.action, 'returned');
    assert.equal(last.role, 'director');
    assert.equal(last.note, 'Fine by me; your call on the wording.');
    assert.ok(!r.body.reviewTrail.slice(-1).some((e) => e.action === 'submitted'));
    assert.equal((await call('POST', `/pieces/${routed.id}/return`, { note: 'x' }, H(DIR))).status, 409);
  });

  await test('the director approves from director-review', async () => {
    await call('POST', `/pieces/${routed.id}/escalate`, { note: 'Back to you for the price line.' }, H(MGR));
    const r = await call('POST', `/pieces/${routed.id}/approve`, {}, H(DIR));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.piece.status, 'approved');
    assert.equal(r.body.piece.approvedRole, 'director');
    assert.deepEqual(r.body.piece.reviewTrail.map((e) => e.action), ['submitted', 'escalated', 'returned', 'escalated', 'approved']);
  });

  await test('changes are requested by the manager from in-review and by the director from director-review', async () => {
    const a = await create('Review path changes A');
    await submit(a.id);
    const byMgr = await call('POST', `/pieces/${a.id}/request-changes`, { note: 'Shorter hook.' }, H(MGR));
    assert.equal(byMgr.status, 200, JSON.stringify(byMgr.body));
    assert.equal(byMgr.body.status, 'changes-requested');
    assert.equal(byMgr.body.review.note, 'Shorter hook.');
    assert.equal(byMgr.body.reviewTrail.at(-1).action, 'changes-requested');
    // The employee revises and submits again with a full save.
    const back = await get(a.id);
    const re = await call('PUT', `/pieces/${a.id}`, { ...back, hook: 'Shorter', status: 'in-review' }, H(EMP));
    assert.equal(re.status, 200, JSON.stringify(re.body));
    assert.deepEqual(re.body.reviewTrail.map((e) => e.action), ['submitted', 'changes-requested', 'submitted']);
    const b = await create('Review path changes B', { type: 'announcement' });
    await submit(b.id);
    const routedB = (await call('POST', `/pieces/${b.id}/approve`, {}, H(MGR))).body;
    assert.equal(routedB.detail.why, 'Announcements go to the director');
    await call('POST', `/pieces/${b.id}/escalate`, { note: 'Announcement.' }, H(MGR));
    const byDir = await call('POST', `/pieces/${b.id}/request-changes`, { note: 'Name the date.' }, H(DIR));
    assert.equal(byDir.status, 200, JSON.stringify(byDir.body));
    assert.equal(byDir.body.status, 'changes-requested');
    assert.equal(byDir.body.reviewTrail.at(-1).role, 'director');
    // A draft is not in review.
    const c = await create('Review path changes C');
    assert.equal((await call('POST', `/pieces/${c.id}/request-changes`, { note: 'x' }, H(DIR))).status, 409);
    assert.equal((await call('POST', `/pieces/${c.id}/approve`, {}, H(DIR))).status, 409);
  });

  await test('an approved piece edited goes back to review with a submitted entry', async () => {
    const p = await get(plain.id);
    const r = await call('PUT', `/pieces/${plain.id}`, { ...p, hook: 'Review path plain piece, edited' }, H(EMP));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'in-review');
    assert.equal(r.body.approvedRole, undefined);
    assert.equal(r.body.reviewTrail.at(-1).action, 'submitted');
  });

  await test('Today carries the role, the review counts and director-review in the review list', async () => {
    const d = await create('Review path today piece', { type: 'episode' });
    await submit(d.id);
    await call('POST', `/pieces/${d.id}/escalate`, { note: 'An episode.' }, H(MGR));
    const t = (await call('GET', '/today?date=2026-11-02', undefined, H(EMP))).body;
    assert.equal(t.month.role, 'employee');
    assert.equal(t.month.approver, false);
    assert.ok(t.month.approversWithoutPin.includes('Marketing Manager (demo)'));
    const q = (await call('GET', '/review/queue', undefined, H(EMP))).body;
    assert.deepEqual(Object.keys(t.reviewCounts).sort(), ['changesRequested', 'director', 'manager', 'mine']);
    assert.equal(t.reviewCounts.manager, q.manager.length);
    assert.equal(t.reviewCounts.director, q.director.length);
    assert.equal(t.reviewCounts.mine, q.mine.length);
    assert.ok(t.reviewCounts.changesRequested >= 1);
    assert.ok(t.review.some((p) => p.id === d.id && p.status === 'director-review'));
    assert.equal((await call('GET', '/today?date=2026-11-02', undefined, H(MGR))).body.month.role, 'manager');
  });

  await test('a manager may set a PIN and must then send it; an employee has none', async () => {
    assert.equal((await call('POST', '/settings/pin', { pin: '1357' }, H(EMP))).status, 403);
    assert.equal((await call('POST', '/settings/pin', { pin: '1357' }, H(MGR))).status, 200);
    assert.equal((await call('GET', '/me', undefined, H(MGR))).body.pinSet, true);
    const p = await create('Review path PIN piece');
    await submit(p.id);
    const noPin = await call('POST', `/pieces/${p.id}/approve`, {}, H(MGR));
    assert.equal(noPin.status, 403);
    assert.equal(noPin.body.detail.pin, true);
    assert.equal((await call('POST', `/pieces/${p.id}/escalate`, { note: 'x' }, H(MGR))).body.detail.pin, true);
    const ok = await call('POST', `/pieces/${p.id}/approve`, {}, H(MGR, { 'X-Studio-Pin': '1357' }));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const t = (await call('GET', '/today?date=2026-11-02', undefined, H(MGR))).body;
    assert.ok(!t.month.approversWithoutPin.includes('Marketing Manager (demo)'));
  });
} finally {
  await scratch.stop();
}
console.log(failed ? `\n${failed} failed` : '\nall workflow tests passed');
process.exit(failed ? 1 : 0);
