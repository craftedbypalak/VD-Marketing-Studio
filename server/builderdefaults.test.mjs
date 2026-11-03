// Builder defaults: Video defaults (settings.video, settings.website) and Occasions (settings.occasions)
// are read when present and fall back to today's values when absent.
//   node --test server/

import test from 'node:test';
import assert from 'node:assert/strict';
import { videoConfig, VIDEO_DEFAULTS, useVideoSettings, defaultMinutes, scriptChunks } from './video.mjs';
import { occasionsConfig, OCCASION_DEFAULTS } from './recurring.mjs';
import { startScratch } from './_scratch.mjs';

// ------------------------------------------------------------------ pure config

test('videoConfig falls back to the defaults when settings.video is absent', () => {
  const c = videoConfig({});
  assert.equal(c.wpm, 140);
  assert.deepEqual([c.minMinutes, c.targetMinutes, c.maxMinutes], [30, 38, 45]);
  assert.deepEqual(c.faceChapters, [1, 5, 6]);
  assert.equal(c.maxFacePerChapter, 3);
  assert.equal(c.partWords, 600);
  assert.equal(c.chapterPlan.length, 6);
  assert.deepEqual([c.shortsMin, c.shortsMax, c.maxUploadMb], [2, 4, 60]);
  assert.deepEqual(videoConfig(null), c);
  assert.deepEqual(c.chapterPlan, VIDEO_DEFAULTS.chapterPlan);
});

test('videoConfig reads settings.video and repairs bad values', () => {
  const c = videoConfig({ video: { wpm: 150, minMinutes: 20, maxMinutes: 25, targetMinutes: 40, faceChapters: [2, 1, 2], chapterPlan: [{ title: 'One', min: 5, max: 3 }, { title: '' }], shortsMin: 1, shortsMax: 0, partWords: 'x' } });
  assert.equal(c.wpm, 150);
  assert.equal(c.targetMinutes, 25, 'target clamped into the range');
  assert.deepEqual(c.faceChapters, [1, 2]);
  assert.deepEqual(c.chapterPlan, [{ title: 'One', min: 5, max: 5, brief: '' }], 'empty rows dropped, max at least min');
  assert.deepEqual([c.shortsMin, c.shortsMax], [1, 1]);
  assert.equal(c.partWords, 600);
});

test('useVideoSettings sets the values the AI steps read, and resets with no settings', () => {
  try {
    useVideoSettings({ video: { chapterPlan: [{ title: 'A', min: 2, max: 10 }, { title: 'B', min: 2, max: 3 }], minMinutes: 5, maxMinutes: 12, targetMinutes: 10, partWords: 100 } });
    assert.deepEqual(defaultMinutes(), [7, 3]);
    const script = Array.from({ length: 60 }, () => 'One two three four.').join(' ');
    assert.ok(scriptChunks(`## 1. A\n\n${script}`).length >= 3, 'parts of about 100 words');
  } finally { useVideoSettings(null); }
  assert.deepEqual(defaultMinutes(), [4, 4, 5, 17, 5, 3]);
});

test('occasionsConfig: settings.occasions, then settings.calendar.greetingTime, then the defaults', () => {
  assert.deepEqual(occasionsConfig({}), { greetingTime: '19:00', statusAccount: 'wa-st', conceptYears: 4, conceptTypes: { ...OCCASION_DEFAULTS.conceptTypes } });
  assert.equal(occasionsConfig({ calendar: { greetingTime: '18:30' } }).greetingTime, '18:30');
  const c = occasionsConfig({ calendar: { greetingTime: '18:30' }, occasions: { greetingTime: '20:15', statusAccount: 'fam', conceptYears: 2, conceptTypes: { carousel: 'carousel' } } });
  assert.deepEqual(c, { greetingTime: '20:15', statusAccount: 'fam', conceptYears: 2, conceptTypes: { carousel: 'carousel' } });
  assert.equal(occasionsConfig({ occasions: { greetingTime: '7pm', conceptYears: 0 } }).greetingTime, '19:00');
  assert.equal(occasionsConfig({ occasions: { conceptYears: 0 } }).conceptYears, 4);
});

// ------------------------------------------------------------------ through the server

test('the server uses settings.video, settings.website and settings.occasions, and falls back without them', async (t) => {
  const scratch = await startScratch({ label: 'studio-builderdefaults' });
  t.after(() => scratch.stop());
  const B = scratch.base + '/api';
  const H = { 'content-type': 'application/json', 'X-Studio-User': 'tools@vspindia.com' };
  const call = (method, p, body) => fetch(B + p, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const setSettings = async (apply) => {
    const doc = (await call('GET', '/settings/settings')).body;
    apply(doc);
    const r = await call('PUT', '/settings/settings', doc);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  };
  const words140 = Array.from({ length: 140 }, () => 'word').join(' ');
  const check = (yt, id) => yt.checks.find((c) => c.id === id);

  // fallback
  let r = await call('POST', '/video/spoken', { text: words140 });
  assert.equal(r.body.minutes, 1);
  r = await call('GET', '/video/vd-0001/youtube');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(check(r.body, 'length').label, 'Length 30 to 45 minutes');
  assert.equal(check(r.body, 'shorts').label, '2 to 4 Shorts made');
  r = await call('POST', '/video', { subject: 'Test subject', targetMinutes: 90 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.video.targetMinutes, 45);
  const firstId = r.body.video.id;
  assert.ok((await call('GET', `/video/${firstId}/youtube`)).body.description.includes('[add the website link'), 'placeholder without settings.website');
  r = await call('GET', '/recurring/rules');
  assert.equal(r.body.greetingTime, '19:00');
  assert.equal(r.body.greetingAccount, 'wa-st');
  assert.equal(r.body.conceptYears, 4);

  // the calendar's greeting time when Occasions has none
  await setSettings((d) => { d.calendar = { ...(d.calendar || {}), greetingTime: '18:30' }; });
  r = await call('GET', '/recurring/rules');
  assert.equal(r.body.greetingTime, '18:30');

  // settings present
  await setSettings((d) => {
    d.video = { wpm: 70, minMinutes: 50, maxMinutes: 60, targetMinutes: 55, shortsMin: 1, shortsMax: 1 };
    d.website = 'https://example.test/call';
    d.occasions = { greetingTime: '20:15', statusAccount: 'fam', conceptYears: 2 };
  });
  r = await call('POST', '/video/spoken', { text: words140 });
  assert.equal(r.body.minutes, 2, 'minutes at 70 words a minute');
  r = await call('GET', '/video/vd-0001/youtube');
  assert.equal(check(r.body, 'length').label, 'Length 50 to 60 minutes');
  assert.equal(check(r.body, 'shorts').label, '1 Shorts made');
  r = await call('POST', '/video', { subject: 'Second subject', targetMinutes: 90 });
  assert.equal(r.body.video.targetMinutes, 60);
  r = await call('POST', '/video/vd-0001/outline', { dryRun: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call('GET', '/recurring/rules');
  assert.deepEqual([r.body.greetingTime, r.body.greetingAccount, r.body.conceptYears], ['20:15', 'fam', 2]);

  // a greeting made now goes on the configured account at the configured time
  const events = (await call('GET', '/events')).body;
  const ev = events.find((e) => ['greeting', 'greeting-only'].includes(e.kind) && e.greetingText && !e.generated?.pieceId && e.date > '2026-11-03');
  assert.ok(ev, 'an event that takes a greeting');
  r = await call('POST', '/recurring/generate', { from: ev.date, to: ev.date, eventId: ev.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = (r.body.rows || r.body.items || r.body.events || []).find((x) => x.pieceId) || r.body;
  const pieceId = row.pieceId || (await call('GET', '/events')).body.find((e) => e.id === ev.id)?.generated?.pieceId;
  assert.ok(pieceId, JSON.stringify(r.body).slice(0, 300));
  const piece = (await call('GET', `/pieces/${pieceId}`)).body;
  assert.equal(piece.plannedTime, '20:15');
  assert.deepEqual(piece.targets, ['fam']);

  // the YouTube description takes the website
  r = await call('GET', `/video/${firstId}/youtube`);
  assert.ok(r.body.description.includes('https://example.test/call'), r.body.description);
});
