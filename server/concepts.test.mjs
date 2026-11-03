// Festival concepts: the angle bank, the propose route with a hand output, the piece made and placed, the angle marked used.
//   node --test server/   (or: node server/concepts.test.mjs)

import assert from 'node:assert/strict';
import { startScratch } from './_scratch.mjs';

const scratch = await startScratch({ label: 'studio-concepts' });
const B = scratch.base + '/api';
const H = { 'content-type': 'application/json', 'X-Studio-User': 'tools@vspindia.com' };
const call = (method, p, body) => fetch(B + p, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (err) { failed += 1; console.log(`FAIL ${name}\n     ${err.message}`); }
}

try {
  // Diwali 2026 (8 November) allows a concept; its series has a bank. Add two angles of our own so the test does not depend on the seed.
  const diwali = (await call('GET', '/events')).body.find((e) => /^Diwali/.test(e.name) && e.date === '2026-11-08');
  await test('Diwali 2026 carries its series key and allows a concept', async () => {
    assert.ok(diwali, 'Diwali 2026 exists');
    assert.equal(diwali.series, 'diwali');
    assert.equal(diwali.conceptAllowed, true);
  });
  const a1 = (await call('POST', '/festival-angles', { id: 'test-diwali-lamps', series: 'diwali', title: 'A diya for every open question', image: 'A row of diyas.', scene: 'The owner answers the same questions all evening.', solutionId: 'question-tray', solutionName: 'The question tray', line: 'Every question gets a tray before the lamps are lit.', usedIn: [] })).body;
  const a2 = (await call('POST', '/festival-angles', { id: 'test-diwali-books', series: 'diwali', title: 'New books, old pending list', image: 'The new account book opened on Diwali.', scene: 'The pending list from last year is still in the owner\'s head.', solutionId: 'one-off-tasks', solutionName: 'One-off tasks', line: 'Start the year with every pending task written down.', usedIn: [] })).body;
  await test('the concepts list shows Diwali with unused angles', async () => {
    const r = await call('GET', '/occasions/concepts?days=365');
    assert.equal(r.status, 200);
    const item = r.body.items.find((i) => i.id === diwali.id);
    assert.ok(item && item.conceptAllowed && item.anglesUnused >= 2, JSON.stringify(item));
  });
  await test('a greeting-only occasion refuses a concept', async () => {
    const gandhi = (await call('GET', '/events')).body.find((e) => /^Gandhi Jayanti/.test(e.name));
    const r = await call('POST', '/occasions/concepts/propose', { eventId: gandhi.id, handOutput: { concepts: [] } });
    assert.equal(r.status, 409);
  });
  const hand = { concepts: [
    { angleId: a1.id, idea: 'Light a diya for every question that waited for you this year.', solutionId: 'question-tray', solutionName: 'The question tray', scene: 'Diwali evening, and the phone still carries the day\'s questions.', type: 'broll', reelHook: 'A diya for every open question', reelCaption: 'Diwali evening. The lamps are lit, and the phone still carries the day\'s questions: is it done, can I send it, who signs. Every one waited for you, and the evening is yours only after the last one. The question tray gives each question a place and a time: you answer the tray once a day, and the rest of the day is the business, not the questions. Save this for the evening after Diwali.', statusLine: 'A diya for every *open question*. Give them a tray.', linkedinOpening: 'This Diwali I counted something other than lamps: the questions that waited for me on the phone.\nThere were more questions than diyas.', carouselCover: 'A diya for every *open question*' },
    { angleId: a2.id, idea: 'New account books, and an old pending list still in your head.', solutionId: 'one-off-tasks', solutionName: 'One-off tasks', scene: 'The new books open on Diwali; the pending work from last year has no page.', type: 'carousel', reelHook: 'New books. Old pending list.', reelCaption: 'The new account books open on Diwali. The pending list from last year does not: it lives in your head, and it comes back on the first working day, one call at a time. Write each pending task once, with an owner and a date, and the new year starts with a page instead of a memory. Send this to the owner who keeps the list in their head.', statusLine: 'New books. *Old pending list.* Write it down.', linkedinOpening: 'We opened the new account books this Diwali. The old pending list did not get a page.\nIt is still in my head.', carouselCover: 'New books, *old pending list*' },
    { angleId: a1.id, idea: 'A third concept on the same angle, to be ignored by the test.', solutionId: 'question-tray', solutionName: 'The question tray', scene: 'Scene.', type: 'status-rule', reelHook: 'Hook', reelCaption: 'Caption.', statusLine: 'A *line*.', linkedinOpening: 'Opening.', carouselCover: '*Cover*' },
  ] };
  await test('propose with a hand output saves three concepts on the event, marked by hand', async () => {
    const r = await call('POST', '/occasions/concepts/propose', { eventId: diwali.id, handOutput: hand });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.mode, 'hand');
    assert.equal(r.body.event.proposals.length, 3);
    assert.equal(r.body.event.proposedMode, 'hand');
  });
  await test('make the piece: in review, placed three to seven days before, never on a dark day, the angle marked used', async () => {
    const r = await call('POST', '/occasions/concepts/make', { eventId: diwali.id, index: 1, type: 'carousel' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const p = r.body.piece;
    assert.equal(p.status, 'in-review');
    assert.equal(p.type, 'carousel');
    assert.equal(p.tags.includes('festival'), true);
    assert.ok(p.pis.solution[0].startsWith('One-off tasks'));
    assert.ok(r.body.placed, 'placed in the window');
    assert.ok(r.body.placed.date >= '2026-11-01' && r.body.placed.date <= '2026-11-05', r.body.placed.date);
    const days = (await call('GET', `/calendar?from=${r.body.placed.date}&to=${r.body.placed.date}`)).body.days;
    assert.equal(days[r.body.placed.date].rule, 'normal');
    const angle = (await call('GET', `/festival-angles/${a2.id}`)).body;
    assert.deepEqual(angle.usedIn, [2026]);
    const second = await call('POST', '/occasions/concepts/make', { eventId: diwali.id, index: 0 });
    assert.equal(second.status, 409);
  });
  await test('a used angle is not offered again within four years', async () => {
    const list = (await call('GET', '/occasions/concepts?days=365')).body;
    const item = list.items.find((i) => i.id === diwali.id);
    assert.equal(item.usedAngleId, a2.id);
    const dry = await call('POST', '/occasions/concepts/propose', { eventId: diwali.id, dryRun: true });
    assert.equal(dry.status, 200);
    assert.ok(dry.body.user.includes(a1.id) && !dry.body.user.includes(a2.id), 'the used angle is left out of the prompt');
  });
} finally {
  await scratch.stop();
}
console.log(failed ? `\n${failed} failed` : '\nall concept tests passed');
process.exit(failed ? 1 : 0);
