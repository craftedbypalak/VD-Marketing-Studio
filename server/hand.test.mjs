// The by-hand AI path and Record as posted.
//   node --test server/   (or: node server/hand.test.mjs)

import assert from 'node:assert/strict';
import { startScratch } from './_scratch.mjs';

const scratch = await startScratch({ label: 'studio-hand' });
const B = scratch.base + '/api';
const APPROVER = 'tools@vspindia.com';
const H = (u = APPROVER) => ({ 'content-type': 'application/json', 'X-Studio-User': u });
const call = (method, p, body, headers = H()) => fetch(B + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (err) { failed += 1; console.log(`FAIL ${name}\n     ${err.message}`); }
}

try {
  await test('an op accepts a hand-written output and logs it as such', async () => {
    const piece = (await call('GET', '/pieces/e01-follow-up')).body;
    const r = await call('POST', '/ai/refine', { piece, instruction: 'Test', handOutput: { changeNote: 'Written by hand for the test.', noChange: false, hook: 'Seven in the evening. Still asking.' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.mode, 'hand');
    assert.equal(r.body.output.patch.hook, 'Seven in the evening. Still asking.');
    const today = (await call('GET', '/today')).body;
    assert.equal(today.month.ai.last.mode, 'hand');
  });
  await test('the review pass applies hand outputs as version 2 through its own path', async () => {
    const fresh = (await call('POST', '/pieces', { type: 'status-rule', pillar: 'problem', status: 'in-review', hook: 'A fresh piece for the pass test', targets: ['wa-st'], renditions: { waStatus: { text: 'A plain *line*.' } } })).body;
    const r = await call('POST', '/content/review-pass', { ids: [fresh.id], handOutputs: { [fresh.id]: { changeNote: 'Review pass by hand: hook shortened.', noChange: false, hook: 'Seven in the evening. Still asking.' } } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.jobId);
    let st;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((res) => setTimeout(res, 250));
      st = (await call('GET', `/content/review-pass/${r.body.jobId}`)).body;
      if (st.appliedAt) break;
    }
    assert.ok(st.appliedAt, JSON.stringify(st));
    const versions = (await call('GET', `/pieces/${fresh.id}/versions`)).body;
    assert.equal(versions.length, 2);
    assert.match(versions[1].changeNote, /by hand/);
    const piece = (await call('GET', `/pieces/${fresh.id}`)).body;
    assert.equal(piece.hook, 'Seven in the evening. Still asking.');
    assert.equal(piece.status, 'in-review');
    await call('DELETE', `/pieces/${fresh.id}`);
  });
  await test('record as posted needs an approved piece, then marks it posted by hand', async () => {
    const p = (await call('POST', '/pieces', { type: 'status-rule', pillar: 'problem', status: 'in-review', hook: 'Posted test', targets: ['wa-st'], renditions: { waStatus: { text: 'A plain line.' } } })).body;
    const early = await call('POST', `/pieces/${p.id}/record-posted`, { postedAt: '2026-10-01', accountId: 'wa-st' });
    assert.equal(early.status, 409);
    assert.equal((await call('POST', `/pieces/${p.id}/approve`, {})).status, 200);
    const bad = await call('POST', `/pieces/${p.id}/record-posted`, { postedAt: '2026-10-01', accountId: 'wa-st', url: 'not a link' });
    assert.equal(bad.status, 400);
    const future = await call('POST', `/pieces/${p.id}/record-posted`, { postedAt: '2099-01-01T09:00', accountId: 'wa-st' });
    assert.equal(future.status, 400);
    assert.match(future.body.error, /not arrived/);
    const ok = await call('POST', `/pieces/${p.id}/record-posted`, { postedAt: '2026-10-01T09:00', accountId: 'wa-st', url: 'https://example.test/post/1' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'posted');
    assert.equal(ok.body.measure.recordedByHand, true);
    assert.equal(ok.body.measure.postedBy, APPROVER);
    const again = (await call('GET', `/pieces/${p.id}`)).body;
    assert.equal(again.measure.postedLink, 'https://example.test/post/1');
    await call('DELETE', `/pieces/${p.id}`);
  });
  await test('the pending list is empty and answering an unknown id is a 404', async () => {
    const list = (await call('GET', '/ai/pending')).body;
    assert.ok(Array.isArray(list));
    const r = await call('POST', '/ai/pending/rq-none/answer', { output: {} });
    assert.equal(r.status, 404);
  });
} finally {
  await scratch.stop();
}
console.log(failed ? `\n${failed} failed` : '\nall hand tests passed');
process.exit(failed ? 1 : 0);
