// slots.mjs: slot generation, the calendar range, placement and the calendar.csv bridge. [calendar]
//
//   generate(from, to)       slots from accounts (weekly, monthly) and events (dark, greeting-only)
//   routes                   regenerate, calendar range, place, unplace, export-csv, import-rows
//   enrichToday(payload)     openSlots for the next seven days, with what is still missing
//
// Dark and greeting-only days come from the events collection (kinds dark and
// greeting-only, and any event whose postingRule is dark or greeting-only). When
// that collection holds no such event, the dark map in
// ../Marketing/POSTING/channels.json is used instead. Quiet windows come from
// channels.json and are a marker, never a block. Compliance dates are quiet
// markers ("move by a day"), never blocks.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { store } from './store.mjs';
import { HttpError } from './api.mjs';

// ------------------------------------------------------------------ rules

/** Kind of slot -> piece types it takes (MODULES.md section B). */
export const FIT = {
  reel: ['reel-animated', 'episode', 'broll', 'youtube-short'],
  trial: ['reel-animated', 'episode'],
  carousel: ['carousel'],
  li: ['linkedin-text', 'field-story', 'announcement'],
  'li-carousel': ['linkedin-carousel', 'carousel'],
  status: ['status-rule', 'greeting', 'episode', 'reel-animated'],
  'status-opt': ['status-rule', 'greeting', 'episode', 'reel-animated'],
  note: ['wa-note'],
  'yt-long': ['youtube-long'],
  'yt-short': ['youtube-short', 'reel-animated', 'episode', 'broll'],
  greeting: ['greeting'],
};
const DERIVED_KINDS = ['reshare', 'family'];

const KIND_NAME = {
  reel: 'Reel', trial: 'Trial Reel', carousel: 'Instagram carousel', li: 'LinkedIn post', 'li-carousel': 'LinkedIn PDF carousel',
  status: 'Status', 'status-opt': 'optional Status', note: 'monthly note', 'yt-long': 'YouTube long video', 'yt-short': 'YouTube Short',
  reshare: 'company page reshare', family: 'family Status', greeting: 'greeting',
};
const TYPE_NAME = {
  'reel-animated': 'animated Reel', episode: 'episode', carousel: 'carousel', broll: 'B-roll Reel', 'linkedin-text': 'LinkedIn text post',
  'linkedin-carousel': 'LinkedIn carousel', 'status-rule': 'Status rule', greeting: 'greeting', 'wa-note': 'WhatsApp note',
  'youtube-long': 'YouTube long video', 'youtube-short': 'YouTube Short', 'field-story': 'field story', announcement: 'announcement',
  'image-post': 'image post',
};

// Calendar constants from the phase 1 design (section 10, item 5). A
// settings.calendar document may override them.
const DEFAULTS = {
  singleLinkedInBefore: '2026-11-16',   // before this Monday: one LinkedIn slot a week
  carouselFrom: '2026-11-25',           // fortnightly LinkedIn carousel Wednesdays from here
  carouselEveryDays: 14,
  monthlyFrom: { 'yt-long': '2026-12-01' }, // "one long video a month from December"
  greetingTime: '19:00',
  maxRangeDays: 450,
};

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ------------------------------------------------------------- date helpers

const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
const toDate = (ymd) => new Date(`${ymd}T00:00:00Z`);
const toYmd = (d) => d.toISOString().slice(0, 10);
const addDays = (ymd, n) => { const d = toDate(ymd); d.setUTCDate(d.getUTCDate() + n); return toYmd(d); };
const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const dowOf = (ymd) => DOW[toDate(ymd).getUTCDay()];
const mondayOf = (ymd) => { const k = (toDate(ymd).getUTCDay() + 6) % 7; return addDays(ymd, -k); };
const nthRule = (ymd, rule) => {
  const [n, wd] = String(rule).split(' ');
  return dowOf(ymd) === wd && Math.ceil(parseInt(ymd.slice(8, 10), 10) / 7) === parseInt(n, 10);
};
function* eachDay(from, to) { for (let d = from; d <= to; d = addDays(d, 1)) yield d; }

function todayIst(settings) {
  const tz = settings?.timezone || 'Asia/Kolkata';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** "7:30 pm" -> "19:30"; words such as "evening" or "any" -> "". */
function parseTime(t) {
  const s = String(t || '').trim().toLowerCase();
  let m = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/.exec(s);
  let h; let min;
  if (m) { h = parseInt(m[1], 10); min = parseInt(m[2], 10); }
  else {
    m = /^(\d{1,2})\s*(am|pm)$/.exec(s);
    if (!m) return '';
    h = parseInt(m[1], 10); min = 0;
  }
  const ap = m[3] || (m.length === 3 ? m[2] : undefined);
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
function humanTime(hhmm, note) {
  if (!hhmm) return note || 'any';
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

// ------------------------------------------------------------ sources

function settingsDoc() { return store.getSingleton('settings') || { id: 'settings' }; }
function config(settings) { return { ...DEFAULTS, ...(settings?.calendar || {}) }; }

function marketingRoot(settings) {
  return process.env.STUDIO_MARKETING_ROOT || settings?.marketingRoot || path.resolve(store.root, '..', 'Marketing');
}

const channelsCache = { file: null, mtime: 0, doc: null };
/** channels.json from Marketing/POSTING, or the copy kept in data/. */
function loadChannels(settings) {
  const candidates = [
    path.join(marketingRoot(settings), 'POSTING', 'channels.json'),
    path.join(store.dataDir, 'channels.source.json'),
  ];
  for (const file of candidates) {
    try {
      const st = fs.statSync(file);
      if (channelsCache.file === file && channelsCache.mtime === st.mtimeMs) return channelsCache.doc;
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      Object.assign(channelsCache, { file, mtime: st.mtimeMs, doc });
      return doc;
    } catch { /* try the next */ }
  }
  return null;
}

// ------------------------------------------------- the rule of a day

/**
 * What an event does to its day.
 * rule: 'dark' | 'greeting-only' | null. marker: how the view shows it.
 */
export function eventEffect(e) {
  const kind = e.kind;
  const pr = e.postingRule;
  if (kind === 'mourning-rule') return { rule: null, marker: 'rule' };            // a standing rule, not a date
  if (kind === 'compliance') return { rule: null, marker: 'compliance', hint: 'Compliance date: move any post by a day.' };
  if (kind === 'dark' || pr === 'dark') return { rule: 'dark', marker: 'dark' };
  if (kind === 'greeting-only' || pr === 'greeting-only') return { rule: 'greeting-only', marker: 'greeting-only' };
  if (kind === 'quiet' || pr === 'quiet') return { rule: null, marker: 'quiet', shade: kind === 'quiet' };
  if (kind === 'greeting') return { rule: null, marker: 'greeting' };
  return { rule: null, marker: 'event' };
}

/**
 * Pseudo events built from channels.json: the dark map (the signed-off "do not
 * post" days) and its events map. They stand in for the events collection when
 * it is empty and fill the gaps when it is not: a date the events already make
 * dark, or an event already listed for that date, is not added twice.
 */
function mapEvents(channels, all) {
  const out = [];
  const onDate = (date) => all.filter((e) => e.date === date);
  for (const [date, text] of Object.entries(channels?.dark || {})) {
    const gOnly = /greeting only/i.test(text);
    const dark = !gOnly;
    const here = onDate(date).map((e) => eventEffect(e).rule);
    if (here.includes(dark ? 'dark' : 'greeting-only') || (!dark && here.includes('dark'))) continue;
    out.push({ id: `map-${date}`, date, name: text, kind: gOnly ? 'greeting-only' : 'dark', postingRule: gOnly ? 'greeting-only' : 'dark', scope: 'ours', source: 'channels.json', synthetic: true });
  }
  for (const [date, text] of Object.entries(channels?.events || {})) {
    const word = String(text).split(/[\s,]/)[0].toLowerCase();
    if (onDate(date).some((e) => String(e.name).toLowerCase().includes(word))) continue;
    out.push({ id: `map-ev-${date}`, date, name: text, kind: 'event', postingRule: 'normal', scope: 'ours', source: 'channels.json', synthetic: true });
  }
  return out;
}

/**
 * The calendar context for a range: events with their effect, one record per
 * day, quiet windows, greeting eves, and the go-dark switch.
 */
function dayContext(from, to) {
  const settings = settingsDoc();
  const channels = loadChannels(settings);
  const all = store.list('events');
  const extra = mapEvents(channels, all);
  let events = all.concat(extra);
  const lo = addDays(from, -9); const hi = addDays(to, 9);
  events = events.filter((e) => e.date >= lo && e.date <= hi);

  const days = new Map();
  const dayRec = (date) => {
    if (!days.has(date)) days.set(date, { date, rule: 'normal', reasons: [], eventIds: [], quiet: false, quietLabel: '', goDark: false });
    return days.get(date);
  };
  for (const date of eachDay(lo, hi)) dayRec(date);

  const joined = [];
  for (const e of events) {
    const fx = eventEffect(e);
    const rec = dayRec(e.date);
    rec.eventIds.push(e.id);
    if (fx.rule === 'dark') { rec.rule = 'dark'; rec.reasons.push(e.name); }
    else if (fx.rule === 'greeting-only') {
      if (rec.rule !== 'dark') rec.rule = 'greeting-only';
      rec.reasons.push(e.name);
    }
    if (fx.shade) { rec.quiet = true; rec.quietLabel = rec.quietLabel || e.name; }
    joined.push({ ...e, marker: fx.marker, hint: fx.hint, effect: fx.rule });
  }
  // Greeting-only reasons are listed after dark ones; keep the order stable.
  for (const [a, b] of channels?.quiet || []) {
    for (const date of eachDay(a < lo ? lo : a, b > hi ? hi : b)) {
      const rec = dayRec(date);
      rec.quiet = true; rec.quietLabel = 'Quiet window: calls come first; nothing new is tried.';
    }
  }
  // Go dark (settings): every date from `from` (and up to `to`, when given).
  const gd = settings.goDark;
  if (gd?.on) {
    const gFrom = gd.from || todayIst(settings);
    for (const date of eachDay(lo, hi)) {
      if (date >= gFrom && (!gd.to || date <= gd.to)) {
        const rec = dayRec(date);
        rec.goDark = true;
        rec.goDarkReason = gd.reason ? `Go dark: ${gd.reason}` : 'Go dark is on';
      }
    }
  }
  // Greeting eves: a greeting event gets a Status slot the evening before.
  const greetingEves = new Map();
  for (const e of events) {
    if (e.kind === 'greeting' && e.whoGets !== 'none') {
      const eve = addDays(e.date, -1);
      if (!greetingEves.has(eve)) greetingEves.set(eve, []);
      greetingEves.get(eve).push(e);
    }
  }
  const greetingDays = new Map();     // pure observance days: kind greeting-only
  for (const e of events) {
    if (e.kind === 'greeting-only') {
      if (!greetingDays.has(e.date)) greetingDays.set(e.date, []);
      greetingDays.get(e.date).push(e);
    }
  }
  return { settings, channels, events: joined, days, greetingEves, greetingDays, cfg: config(settings), usedMap: extra.length > 0, eventsEmpty: all.length === 0 };
}

const dayOf = (dc, date) => dc.days.get(date) || { date, rule: 'normal', reasons: [], eventIds: [], quiet: false, goDark: false };

function goDarkApplies(settings, date) {
  const gd = settings.goDark;
  if (!gd?.on) return false;
  const from = gd.from || todayIst(settings);
  return date >= from && (!gd.to || date <= gd.to);
}

// ------------------------------------------------------------ generation

function isCarouselWeek(monday, cfg) {
  const start = mondayOf(cfg.carouselFrom);
  return monday >= start && diffDays(start, monday) % cfg.carouselEveryDays === 0;
}

/** Whether a weekly LinkedIn rule produces a slot on this date. */
function linkedInAllowed(acc, rule, date, dc) {
  const wk = mondayOf(date);
  if (rule.kind === 'li-carousel') return isCarouselWeek(wk, dc.cfg);
  // kind li
  if (wk < mondayOf(dc.cfg.singleLinkedInBefore)) {
    // One LinkedIn slot a week: the first rule day (Tuesday) that is not dark; else the next (Thursday).
    const cands = (acc.weekly || []).filter((w) => w.kind === 'li')
      .sort((a, b) => WEEK_ORDER.indexOf(a.day) - WEEK_ORDER.indexOf(b.day));
    for (const w of cands) {
      const date2 = addDays(wk, WEEK_ORDER.indexOf(w.day));
      if (dayOf(dc, date2).rule === 'normal') return w.day === rule.day;
    }
    return false;
  }
  if (rule.alternate) return !isCarouselWeek(wk, dc.cfg);   // the Thursday post, in weeks without a carousel
  return true;
}

const keyOf = (s) => `${s.date}|${s.accountId}|${s.kind}`;

/** The slots the rules call for in [from, to]. */
function computeDesired(from, to, dc, accounts) {
  const out = [];
  const push = (s) => out.push(s);
  const greetAcc = accounts.find((a) => (a.weekly || []).some((w) => w.kind === 'status'))?.id;
  for (const date of eachDay(from, to)) {
    const info = dayOf(dc, date);
    const dow = dowOf(date);
    const free = info.rule === 'normal';
    // A scheduled upload (the fortnightly long video) is generated even inside a dark or
    // greeting-only block: it needs no live reply. Go dark (the mourning switch) still holds it.
    for (const acc of accounts) {
      for (const w of acc.weekly || []) {
        if (w.day !== dow) continue;
        if (!free && !w.scheduledUpload) continue;
          // A fortnightly (or every-n-weeks) rule: anchored on a date, it fires every `every` weeks from there.
          if (w.every > 1) {
            if (!isYmd(w.anchor)) continue;
            const gap = diffDays(w.anchor, date);
            if (gap < 0 || gap % (7 * w.every) !== 0) continue;
          }
          if (w.from && date < w.from) continue;
          if ((w.kind === 'li' || w.kind === 'li-carousel') && !linkedInAllowed(acc, w, date, dc)) continue;
          push({
            date, time: w.time || '', timeNote: w.timeNote, accountId: acc.id, kind: w.kind, label: w.label || w.kind,
            state: w.optional ? 'optional' : w.derived ? 'derived' : 'open',
            optional: w.optional || undefined,
            scheduledUpload: w.scheduledUpload || undefined,
          });
      }
    }
    if (free) {
      for (const acc of accounts) {
        for (const m of acc.monthly || []) {
          if (!nthRule(date, m.rule)) continue;
          if ((m.skipMonths || []).includes(date.slice(0, 7))) continue;
          const from2 = m.from || dc.cfg.monthlyFrom?.[m.kind];
          if (from2 && date < from2) continue;
          push({
            date, time: m.time || '', timeNote: m.timeNote, accountId: acc.id, kind: m.kind, label: m.label || m.kind,
            state: m.optional ? 'optional' : m.derived ? 'derived' : 'open',
            optional: m.optional || undefined,
          });
        }
      }
    }
  }
  // Greeting slots: the evening before a greeting event, and on a greeting-only day.
  if (greetAcc) {
    const wanted = new Map();
    const add = (date, names, time, timeNote, forceGreetingOnly, reason) => {
      if (date < from || date > to) return;
      const k = `${date}|${greetAcc}|greeting`;
      const prev = wanted.get(k);
      if (prev) { prev.names.push(...names); return; }
      wanted.set(k, { date, names: [...names], time, timeNote, forceGreetingOnly, reason });
    };
    for (const [eve, evs] of dc.greetingEves) add(eve, evs.map((e) => e.name), dc.cfg.greetingTime, 'evening before', false, evs.map((e) => e.name).join('; '));
    for (const [date, evs] of dc.greetingDays) add(date, evs.map((e) => e.name), '09:00', '', true, evs.map((e) => e.name).join('; '));
    for (const w of wanted.values()) {
      const rule = dayOf(dc, w.date).rule;
      const names = [...new Set(w.names)];
      push({
        date: w.date, time: w.time, timeNote: w.timeNote || undefined, accountId: greetAcc, kind: 'greeting',
        label: `Greeting: ${names.join(', ')}`, reason: w.reason,
        state: w.forceGreetingOnly || rule !== 'normal' ? 'greeting-only' : 'open',
      });
    }
  }
  return out;
}

/** The state a slot is in, given what it holds and whether go dark applies. */
export function effectiveState(slot, settings) {
  if (goDarkApplies(settings, slot.date)) return 'dark';
  if (slot.pieceId || slot.csv) return 'filled';
  return slot.baseState || 'open';
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Regenerates slots in [from, to]. Idempotent: filled slots (those holding a
 * piece or a calendar row) are never deleted or overwritten; open ones are
 * rebuilt. Tolerant of pieces that are not imported yet: a slot whose piece
 * cannot be found stays filled.
 */
export async function generate(from, to) {
  if (!isYmd(from) || !isYmd(to)) throw new HttpError(400, 'from and to must be dates (YYYY-MM-DD)');
  if (to < from) throw new HttpError(400, 'to must not be before from');
  const settings0 = settingsDoc();
  const cfg0 = config(settings0);
  if (diffDays(from, to) > cfg0.maxRangeDays) throw new HttpError(400, `Choose a range of ${cfg0.maxRangeDays} days or fewer`);

  const accounts = store.list('accounts');
  const dc = dayContext(from, to);
  const desired = computeDesired(from, to, dc, accounts);
  const existing = store.list('slots', (s) => s.date >= from && s.date <= to);
  const byKey = new Map();
  for (const s of existing) { const k = keyOf(s); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(s); }

  const seen = new Set();
  const summary = { from, to, created: 0, updated: 0, removed: 0, kept: 0 };

  for (const want of desired) {
    const group = byKey.get(keyOf(want)) || [];
    const target = group.find((s) => s.generated) || group[0];
    const quiet = dayOf(dc, want.date).quiet || undefined;
    if (!target) {
      const rec = {
        id: store.nextId('sl'), date: want.date, time: want.time, timeNote: want.timeNote, accountId: want.accountId, kind: want.kind,
        label: want.label, reason: want.reason, optional: want.optional, quiet, scheduledUpload: want.scheduledUpload,
        baseState: want.state, generated: true,
      };
      rec.state = effectiveState(rec, dc.settings);
      if (rec.state === 'dark' && dc.settings.goDark?.on) rec.reason = dc.settings.goDark.reason || 'Go dark is on';
      await store.put('slots', clean(rec));
      summary.created += 1;
      continue;
    }
    seen.add(target.id);
    if (target.pieceId || target.csv || target.state === 'filled' || !target.generated) {
      // Filled (or hand-made): leave the content alone; only the quiet marker and go dark follow the rules.
      const next = { ...target, quiet };
      next.state = effectiveState(next, dc.settings);
      if (!same(next, target)) { await store.put('slots', clean(next)); summary.updated += 1; } else summary.kept += 1;
      continue;
    }
    const next = {
      ...target, time: want.time, timeNote: want.timeNote, label: want.label, reason: want.reason, optional: want.optional, quiet, scheduledUpload: want.scheduledUpload,
      baseState: want.state,
    };
    next.state = effectiveState(next, dc.settings);
    if (next.state === 'dark' && dc.settings.goDark?.on) next.reason = dc.settings.goDark.reason || 'Go dark is on';
    if (!same(clean(next), clean(target))) { await store.put('slots', clean(next)); summary.updated += 1; }
  }

  // Slots the rules no longer call for: drop the empty generated ones; keep everything else.
  for (const s of existing) {
    if (seen.has(s.id)) continue;
    const empty = s.generated && !s.pieceId && !s.csv && s.state !== 'filled';
    if (empty) { await store.remove('slots', s.id); summary.removed += 1; continue; }
    summary.kept += 1;
    const next = { ...s };
    next.state = effectiveState(next, dc.settings);
    if (next.state !== s.state) { await store.put('slots', clean(next)); summary.updated += 1; }
  }
  await linkDerived(from, to);
  summary.total = store.list('slots', (s) => s.date >= from && s.date <= to).length;
  summary.quietWindows = (dc.channels?.quiet || []).map(([a, b]) => ({ from: a, to: b }));
  await store.log(null, 'slots.regenerate', summary);
  return summary;
}

function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== '') out[k] = v;
  if (obj.time === '') out.time = '';
  return out;
}

/** Derived slots point at the slot they follow (the week's LinkedIn post for the company page). */
async function linkDerived(from, to) {
  const accounts = store.list('accounts');
  const slots = store.list('slots', (s) => s.date >= addDays(from, -7) && s.date <= addDays(to, 7));
  for (const s of slots) {
    if (s.state !== 'derived' || s.derivedFrom) continue;
    const src = accounts.find((a) => (a.repurposeTo || []).some((r) => r.accountId === s.accountId && (!r.when?.kind || r.when.kind === s.kind)));
    if (!src) continue;
    const wk = mondayOf(s.date);
    const sib = slots.filter((x) => x.accountId === src.id && mondayOf(x.date) === wk && x.state !== 'derived');
    const pick = sib.find((x) => x.pieceId) || sib[0];
    if (pick) await store.patch('slots', s.id, { derivedFrom: pick.id });
  }
}

// --------------------------------------------------------- placement rules

function pieceSlots(pieceId) { return store.list('slots', (s) => s.pieceId === pieceId); }

/** Keeps piece.plannedDate and plannedTime at the earliest slot that holds it. */
async function syncPiece(pieceId) {
  const piece = store.get('pieces', pieceId);
  if (!piece) return;
  const mine = pieceSlots(pieceId).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const first = mine[0];
  const plannedDate = first?.date; const plannedTime = first?.time || undefined;
  if (piece.plannedDate !== plannedDate || piece.plannedTime !== plannedTime) {
    const next = { ...piece };
    if (plannedDate) next.plannedDate = plannedDate; else delete next.plannedDate;
    if (plannedTime) next.plannedTime = plannedTime; else delete next.plannedTime;
    await store.put('pieces', next);
  }
}

/**
 * Why a piece cannot go into a slot (an object with kind, date, accountId), or
 * null when it can. The text is shown to the person, so it is a full sentence.
 */
export function placementProblem(piece, slot, dc = dayContext(slot.date, slot.date)) {
  const kindName = KIND_NAME[slot.kind] || slot.kind;
  const typeName = TYPE_NAME[piece.type] || piece.type;
  if (piece.status === 'retired') return 'This piece is retired and cannot be scheduled.';
  if (DERIVED_KINDS.includes(slot.kind) || slot.state === 'derived') {
    if (slot.kind === 'reshare') return 'The company page reshares the week\'s strongest post, so nothing is placed in this slot.';
    if (slot.kind === 'family') return 'The family Status uses the month\'s most-sent Reel, chosen at the time, so nothing is placed in this slot.';
    return `A ${kindName} slot is derived from another post; nothing is placed in it.`;
  }
  const fits = FIT[slot.kind];
  if (!fits) return `No piece type is defined for a ${kindName} slot.`;
  if (!fits.includes(piece.type)) {
    return `A ${typeName} does not fit a ${kindName} slot. A ${kindName} slot takes: ${fits.map((t) => TYPE_NAME[t] || t).join(', ')}.`;
  }
  const info = dayOf(dc, slot.date);
  if (info.goDark || goDarkApplies(dc.settings, slot.date)) {
    return `${fmtDay(slot.date)} falls under go dark (${info.goDarkReason || 'nothing is posted'}). Turn go dark off in Settings, or choose another date.`;
  }
  if (info.rule === 'dark' && !slot.scheduledUpload) {
    // A plain greeting may sit on a dark day when a greeting event falls on that day or the next.
    const eveOk = piece.type === 'greeting' && ['greeting', 'status', 'status-opt'].includes(slot.kind)
      && (dc.events.some((e) => e.kind === 'greeting' && (e.date === slot.date || e.date === addDays(slot.date, 1))));
    if (!eveOk) return `${fmtDay(slot.date)} is a dark day (${info.reasons.join('; ') || 'do not post'}). Choose another date.`;
  }
  if (info.rule === 'greeting-only' && piece.type !== 'greeting' && !slot.scheduledUpload) {
    return `${fmtDay(slot.date)} is a greeting-only day (${info.reasons.join('; ') || 'greeting only'}). Only a plain greeting can be placed.`;
  }
  return null;
}

function fmtDay(date) {
  const d = toDate(date);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}

function occupiedBy(slot, pieceId) {
  if (!slot.pieceId || slot.pieceId === pieceId) return null;
  const other = store.get('pieces', slot.pieceId);
  return other ? other : null;   // a dangling reference (piece not imported yet) does not count as occupied
}

/** Releases a slot: empties it, or deletes it when it only existed for an imported or hand-made row. */
async function release(slot) {
  const fresh = store.get('slots', slot.id);
  if (!fresh) return;
  const generatedOrOpen = fresh.generated === true;
  if (!generatedOrOpen && fresh.source === 'import') {
    await store.remove('slots', fresh.id);       // created for an imported row: nothing left to show
    return;
  }
  const next = { ...fresh };
  delete next.pieceId; delete next.csv;
  next.state = effectiveState(next, settingsDoc());
  await store.put('slots', clean(next));
}

// ------------------------------------------------------------- the routes

function validRange(query) {
  const { from, to } = query;
  if (!isYmd(from) || !isYmd(to)) throw new HttpError(400, 'from and to are required (YYYY-MM-DD)');
  if (to < from) throw new HttpError(400, 'to must not be before from');
  if (diffDays(from, to) > 400) throw new HttpError(400, 'Choose a range of 400 days or fewer');
  return { from, to };
}

function defaultRange(settings, body) {
  const accounts = store.list('accounts');
  const today = todayIst(settings);
  const from = isYmd(body?.from) ? body.from : `${today.slice(0, 7)}-01`;
  const lastOpen = accounts.map((a) => a.openSlotsTo).filter(Boolean).sort().pop();
  const to = isYmd(body?.to) ? body.to : (lastOpen && lastOpen > from ? lastOpen : addDays(from, 150));
  return { from, to };
}

async function reconcileGoDark(from, to) {
  const settings = settingsDoc();
  for (const s of store.list('slots', (x) => x.date >= from && x.date <= to)) {
    const state = effectiveState(s, settings);
    if (state !== s.state) {
      const next = { ...s, state };
      if (state === 'dark') next.reason = settings.goDark?.reason || 'Go dark is on'; else if (s.state === 'dark') delete next.reason;
      await store.put('slots', clean(next));
    }
  }
}

const channelNames = {
  'vd-ig': 'Instagram', 'p-li': 'LinkedIn', 'vd-li': 'LinkedIn', 'wa-st': 'WhatsApp Status', 'wa-note': 'WhatsApp',
  yt: 'YouTube', fam: 'WhatsApp Status', 'p-ig': 'Instagram', 'p-fb': 'Facebook', 'vd-fb': 'Facebook', irl: 'Instagram Stories and WhatsApp Status',
};
const formatNames = {
  reel: 'Reel', trial: 'Trial Reel (not on the grid)', carousel: 'Carousel', li: 'Text only', 'li-carousel': 'PDF carousel',
  status: 'Text', 'status-opt': 'Text', note: 'Monthly note (opted-in contacts only)', 'yt-long': 'Long video', 'yt-short': 'Short',
  greeting: 'Plain greeting', family: 'Video', reshare: 'Reshare',
};

const CSV_HEAD = ['Week', 'Date', 'Day', 'Time (IST)', 'Channel', 'Format', 'Id', 'Hook', 'Your face', 'Ready?',
  'Caption or text (when not in a source file)', 'Notes', 'Status', 'Posted link', 'Real replies', 'Calls booked'];

function csvEscape(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function readyFor(piece) {
  if (!piece) return '';
  if (['approved', 'scheduled', 'posted', 'measured'].includes(piece.status)) return 'Ready';
  return piece.status === 'idea' ? 'To write' : 'Draft';
}

/** Rows of calendar.csv, in the file's order: by date, then the order they were imported in. */
export function buildCsvRows() {
  const accounts = Object.fromEntries(store.list('accounts').map((a) => [a.id, a]));
  const slots = store.list('slots', (s) => (s.pieceId || s.csv) && !DERIVED_KINDS.includes(s.kind));
  const pieces = Object.fromEntries(store.list('pieces').map((p) => [p.id, p]));
  const weekLabels = new Map();
  for (const s of slots) if (s.csv?.week) weekLabels.set(mondayOf(s.date), s.csv.week);
  slots.sort((a, b) => a.date.localeCompare(b.date)
    || (a.csv?.seq ?? 1e9) - (b.csv?.seq ?? 1e9)
    || String(a.time).localeCompare(String(b.time)));
  return slots.map((s) => {
    const c = s.csv || {};
    const p = pieces[s.pieceId] || null;
    const acc = accounts[s.accountId];
    const hookEdited = p && p.hook && c.pieceHook !== undefined && p.hook !== c.pieceHook;
    const hook = hookEdited ? p.hook : (c.hook ?? p?.hook ?? '');
    const posted = p && ['posted', 'measured'].includes(p.status);
    const m = p?.measure || {};
    return [
      c.week ?? weekLabels.get(mondayOf(s.date)) ?? '',
      s.date,
      c.day ?? dowOf(s.date),
      c.time ?? humanTime(s.time, s.timeNote),
      c.channel ?? channelNames[s.accountId] ?? acc?.label ?? '',
      c.format ?? formatNames[s.kind] ?? '',
      c.id ?? p?.source?.id ?? p?.id ?? s.pieceId ?? '',
      hook,
      c.face ?? '',
      c.ready ?? readyFor(p),
      c.caption ?? '',
      c.notes ?? '',
      posted ? 'Posted' : (c.status || 'To do'),
      m.postedLink ?? c.postedLink ?? '',
      m.realReplies ?? c.realReplies ?? '',
      m.callsBooked ?? c.callsBooked ?? '',
    ];
  });
}

export function csvText() {
  const rows = [CSV_HEAD, ...buildCsvRows()];
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

// ---- import of the calendar.csv rows (data/import-calendar.json)

const FALLBACK_CHANNELS = {
  Instagram: ['vd-ig'], LinkedIn: ['p-li'], 'WhatsApp Status': ['wa-st'], WhatsApp: ['wa-note'], YouTube: ['yt'],
  'Instagram and WhatsApp Status': ['vd-ig', 'wa-st'], 'Instagram Stories and WhatsApp Status': ['vd-ig', 'wa-st', 'irl'],
};

function slotTarget(row, channels) {
  const list = (Array.isArray(row.accounts) && row.accounts.length ? row.accounts : null)
    || channels?.channelMap?.[row.channel] || FALLBACK_CHANNELS[row.channel] || ['vd-ig'];
  const f = String(row.format || '');
  if (/greeting/i.test(f) || row.id === 'greeting') return { accountId: 'wa-st', kind: 'greeting' };
  if (list.includes('irl')) return { accountId: 'wa-st', kind: 'status-opt' };
  const accountId = list[0];
  let kind;
  if (accountId === 'vd-ig') kind = /^trial/i.test(f) ? 'trial' : /^carousel/i.test(f) ? 'carousel' : 'reel';
  else if (accountId === 'p-li') kind = /carousel/i.test(f) ? 'li-carousel' : 'li';
  else if (accountId === 'wa-st') kind = 'status';
  else if (accountId === 'wa-note') kind = 'note';
  else if (accountId === 'yt') kind = /short/i.test(f) ? 'yt-short' : 'yt-long';
  else kind = 'status';
  return { accountId, kind };
}

function findPiece(row, pieces) {
  const byPieceId = row.pieceId ? pieces.find((p) => p.id === row.pieceId) : null;
  if (byPieceId) return byPieceId;
  const byId = pieces.find((p) => p.id === row.id);
  if (byId) return byId;
  const bySource = pieces.filter((p) => p.source?.id === row.id);
  if (bySource.length === 1) return bySource[0];
  if (bySource.length > 1) return bySource.find((p) => p.hook === row.hook) || null;
  const byHook = pieces.find((p) => row.hook && p.hook === row.hook && (row.id === 'rule' || row.id === 'greeting'));
  return byHook || null;
}

async function importRows(by) {
  const settings = settingsDoc();
  const file = path.join(store.dataDir, 'import-calendar.json');
  if (!fs.existsSync(file)) {
    return {
      ok: false, imported: 0,
      message: 'The file data/import-calendar.json does not exist yet. It is written by the content import (run server/import/run.mjs); then run this again.',
    };
  }
  let doc;
  try { doc = JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (err) { throw new HttpError(400, `data/import-calendar.json is not valid JSON: ${err.message}`); }
  const rows = Array.isArray(doc) ? doc : doc?.rows;
  if (!Array.isArray(rows)) throw new HttpError(400, 'data/import-calendar.json must hold an array of rows, or { rows: [...] }');

  const channels = loadChannels(settings);
  const pieces = store.list('pieces');
  const idCount = new Map();
  for (const r of rows) idCount.set(r.id, (idCount.get(r.id) || 0) + 1);
  const claimed = new Set();
  const out = { ok: true, rows: rows.length, filled: 0, created: 0, refreshed: 0, dropped: 0, skipped: 0, piecesMissing: [] };
  const createdByRow = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!isYmd(row?.date)) { out.skipped += 1; continue; }
    const { accountId, kind } = slotTarget(row, channels);
    // The content import writes time as HH:MM with the original wording in timeLabel; the plain CSV columns are accepted too.
    const timeText = String(row.timeLabel ?? row.time ?? '');
    const time = parseTime(row.time) || parseTime(timeText);
    const piece = findPiece(row, pieces);
    const csv = {
      seq: i, week: row.week, day: row.day, time: timeText, channel: row.channel ?? '', format: row.format ?? '', id: row.id ?? '',
      hook: row.hook ?? '', face: row.yourFace ?? row.face, ready: row.ready, caption: row.text ?? row.caption, notes: row.notes ?? '', status: row.status || 'To do',
      postedLink: row.postedLink, realReplies: row.realReplies, callsBooked: row.callsBooked, pieceHook: piece?.hook,
    };
    const slots = store.list('slots', (s) => s.date === row.date && s.accountId === accountId && s.kind === kind);
    // Already imported (same row id on the same date and account): refresh the row, keep the slot.
    let slot = slots.find((s) => s.csv && s.csv.id === row.id && !claimed.has(s.id));
    let isNew = false;
    if (!slot) slot = slots.find((s) => !s.pieceId && !s.csv && !claimed.has(s.id) && (s.baseState || s.state) !== 'derived');
    const pieceId = piece ? piece.id : (row.pieceId || (idCount.get(row.id) === 1 && row.id ? row.id : undefined));
    if (!slot) {
      slot = {
        id: store.nextId('sl'), date: row.date, time, timeNote: time ? undefined : timeText || undefined, accountId, kind,
        label: row.hook || row.format || kind, baseState: 'open', source: 'import', generated: false,
      };
      isNew = true;
    } else if (time) slot.time = time;
    claimed.add(slot.id);
    const next = { ...slot, pieceId, csv: clean(csv) };
    next.state = effectiveState(next, settings);
    await store.put('slots', clean(next));
    if (isNew) { out.created += 1; createdByRow.push({ row, slot: next }); } else if (slot.csv) out.refreshed += 1; else out.filled += 1;
    if (piece) await syncPiece(piece.id); else out.piecesMissing.push(row.id);
  }

  // Rows that moved a post leave an empty generated slot behind: drop it.
  for (const { row, slot } of createdByRow) {
    const movedNote = /moved/i.test(row.notes || '');
    const isGreeting = slot.kind === 'greeting';
    if (!movedNote && !isGreeting) continue;
    const near = store.list('slots', (s) => s.generated && !s.pieceId && !s.csv && s.accountId === slot.accountId && s.kind === slot.kind
      && s.id !== slot.id && !claimed.has(s.id)
      && (isGreeting ? Math.abs(diffDays(s.date, slot.date)) <= 1 : mondayOf(s.date) === mondayOf(slot.date)));
    for (const s of near) { await store.remove('slots', s.id); out.dropped += 1; }
  }
  out.imported = out.filled + out.created + out.refreshed;
  out.piecesMissing = [...new Set(out.piecesMissing)];
  out.message = `${out.imported} of ${rows.length} rows are in the calendar (${out.filled} filled generated slots, ${out.created} new slots, ${out.refreshed} refreshed).`
    + (out.piecesMissing.length ? ` ${out.piecesMissing.length} ids have no piece in the library yet; the slots keep the row until the content import runs.` : '');
  await store.log(by, 'calendar.import-rows', out);
  return out;
}

// ---- place and unplace

async function placePiece(ctx) {
  const piece = store.get('pieces', ctx.params.id);
  if (!piece) throw new HttpError(404, 'Piece not found');
  const body = ctx.body || {};
  const settings = settingsDoc();
  const fromSlot = body.fromSlotId ? store.get('slots', body.fromSlotId) : null;
  if (body.fromSlotId && !fromSlot) throw new HttpError(404, 'The slot to move from was not found');
  if (fromSlot && fromSlot.pieceId !== piece.id) throw new HttpError(409, 'That slot does not hold this piece');

  let slot = null;
  let created = false;
  if (body.slotId) {
    slot = store.get('slots', body.slotId);
    if (!slot) throw new HttpError(404, 'Slot not found');
  } else if (isYmd(body.date)) {
    const dc = dayContext(body.date, body.date);
    const wantAcc = body.accountId || fromSlot?.accountId;
    const probeKind = body.kind || fromSlot?.kind || Object.keys(FIT).find((k) => FIT[k].includes(piece.type));
    if (probeKind) {
      const existingOfKind = store.list('slots', (s) => s.date === body.date && s.kind === probeKind)[0];
      const refusal = placementProblem(piece, { date: body.date, kind: probeKind, accountId: wantAcc, state: 'open', scheduledUpload: existingOfKind?.scheduledUpload }, dc);
      const info0 = dayOf(dc, body.date);
      if (refusal && (info0.rule !== 'normal' || info0.goDark)) throw new HttpError(422, refusal);
    }
    const candidates = store.list('slots', (s) => s.date === body.date && (!wantAcc || s.accountId === wantAcc)
      && ['open', 'optional', 'greeting-only'].includes(s.state) && !occupiedBy(s, piece.id) && !s.pieceId && !s.csv);
    const fit = candidates.find((s) => !placementProblem(piece, s, dc));
    if (fit) slot = fit;
    else if (body.create || body.kind) {
      const acc = wantAcc || (piece.targets || [])[0];
      const kind = body.kind || fromSlot?.kind || probeKind;
      if (!acc || !kind) throw new HttpError(400, 'Say which account and kind the new slot is for');
      slot = {
        id: '__new__', date: body.date, time: fromSlot?.time || '', timeNote: fromSlot?.timeNote, accountId: acc, kind,
        label: fromSlot?.label || KIND_NAME[kind] || kind, baseState: 'open', source: 'manual', generated: false, state: 'open',
      };
      created = true;
    } else {
      const problem = candidates[0] ? placementProblem(piece, candidates[0], dc) : null;
      const info = dayOf(dc, body.date);
      throw new HttpError(422, problem || (info.rule !== 'normal'
        ? `${fmtDay(body.date)} is ${info.rule === 'dark' ? 'a dark day' : 'a greeting-only day'} (${info.reasons.join('; ')}). Choose another date.`
        : `There is no open slot on ${fmtDay(body.date)} that takes a ${TYPE_NAME[piece.type] || piece.type}.`));
    }
  } else {
    throw new HttpError(400, 'Send slotId, or a date');
  }

  const problem = placementProblem(piece, slot);
  if (problem) throw new HttpError(422, problem);
  if (slot.state === 'dark') throw new HttpError(422, `${fmtDay(slot.date)} is dark: ${slot.reason || 'do not post'}.`);
  const other = occupiedBy(slot, piece.id);
  if (other) throw new HttpError(409, `This slot already holds "${other.hook || other.id}". Move or unplace that piece first.`);

  if (created) {
    slot = { ...slot, id: store.nextId('sl') };
  }
  const carriedCsv = fromSlot?.csv ? { ...fromSlot.csv, week: undefined, day: undefined, time: undefined, channel: undefined } : slot.csv;
  const next = { ...slot, pieceId: piece.id };
  if (carriedCsv && !slot.csv) next.csv = clean({ ...carriedCsv, time: undefined });
  next.state = effectiveState(next, settings);
  const stored = await store.put('slots', clean(next));
  if (fromSlot && fromSlot.id !== stored.id) await release(fromSlot);
  await syncPiece(piece.id);
  await store.log(ctx.by, 'piece.place', { pieceId: piece.id, slotId: stored.id, from: fromSlot?.id || null });

  const warnings = [];
  if (piece.targets?.length && !piece.targets.includes(stored.accountId)) {
    warnings.push(`This piece targets ${piece.targets.join(', ')}; the slot belongs to ${stored.accountId}.`);
  }
  if (!['approved', 'scheduled', 'posted', 'measured'].includes(piece.status)) warnings.push('The piece is not approved yet.');
  return { ok: true, slot: stored, piece: store.get('pieces', piece.id), moved: Boolean(fromSlot), createdSlot: created, warnings };
}

async function unplacePiece(ctx) {
  // The piece may not be in the library yet (a calendar row kept until the content import runs).
  const piece = store.get('pieces', ctx.params.id) || { id: ctx.params.id, missing: true };
  const mine = pieceSlots(piece.id);
  if (piece.missing && !mine.length) throw new HttpError(404, 'Piece not found');
  const wanted = ctx.body?.slotId;
  let targets = mine;
  if (wanted) targets = mine.filter((s) => s.id === wanted);
  else if (mine.length > 1) throw new HttpError(409, `This piece sits in ${mine.length} slots; say which one with slotId.`);
  if (!targets.length) return { ok: true, released: [], piece };
  for (const s of targets) await release(s);
  await syncPiece(piece.id);
  await store.log(ctx.by, 'piece.unplace', { pieceId: piece.id, slots: targets.map((s) => s.id) });
  return { ok: true, released: targets.map((s) => s.id), piece: store.get('pieces', piece.id) };
}

// ---- the calendar range

function calendarRange(query) {
  const { from, to } = validRange(query);
  const dc = dayContext(from, to);
  const slots = store.list('slots', (s) => s.date >= from && s.date <= to)
    .sort((a, b) => `${a.date} ${a.time || '99:99'} ${a.accountId}`.localeCompare(`${b.date} ${b.time || '99:99'} ${b.accountId}`));
  const pieceIds = new Set(slots.map((s) => s.pieceId).filter(Boolean));
  const pieces = new Map(store.list('pieces', (p) => pieceIds.has(p.id)).map((p) => [p.id, p]));
  const days = {};
  for (const date of eachDay(from, to)) {
    const d = dayOf(dc, date);
    days[date] = { rule: d.rule, reasons: d.reasons, quiet: d.quiet, quietLabel: d.quietLabel, goDark: d.goDark, goDarkReason: d.goDarkReason, eventIds: d.eventIds };
  }
  const events = dc.events.filter((e) => e.date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  return {
    from, to, today: todayIst(dc.settings), goDark: dc.settings.goDark || { on: false },
    slots: slots.map((s) => ({ ...s, piece: s.pieceId ? (pieces.get(s.pieceId) || null) : null })),
    events, days, quietWindows: (dc.channels?.quiet || []).map(([a, b]) => ({ from: a, to: b })),
    fit: FIT, kindNames: KIND_NAME, typeNames: TYPE_NAME, usingDarkMap: dc.usedMap, eventsEmpty: dc.eventsEmpty,
  };
}

export const routes = [
  {
    method: 'POST', path: '/api/slots/regenerate',
    handler: async (ctx) => {
      ctx.requireApprover('regenerate the slots');
      const { from, to } = defaultRange(settingsDoc(), ctx.body);
      return generate(from, to);
    },
  },
  {
    method: 'GET', path: '/api/calendar',
    handler: async (ctx) => {
      const { from, to } = validRange(ctx.query);
      await reconcileGoDark(from, to);
      return calendarRange(ctx.query);
    },
  },
  { method: 'POST', path: '/api/pieces/:id/place', handler: placePiece },
  { method: 'POST', path: '/api/pieces/:id/unplace', handler: unplacePiece },
  {
    method: 'POST', path: '/api/calendar/export-csv',
    handler: async (ctx) => {
      if (!ctx.body?.dryRun) ctx.requireApprover('write calendar.csv');
      const settings = settingsDoc();
      const text = csvText();
      const rows = buildCsvRows().length;
      if (ctx.body?.dryRun) return { ok: true, dryRun: true, rows, csv: text };
      const dir = path.join(marketingRoot(settings), 'POSTING');
      if (!fs.existsSync(dir)) throw new HttpError(404, `The folder ${dir} was not found, so calendar.csv was not written.`);
      const target = path.join(dir, 'calendar.csv');
      let backup = null;
      if (fs.existsSync(target)) {
        backup = `${target}.bak`;
        await fsp.copyFile(target, backup);
      }
      const tmp = `${target}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, text, 'utf8');
      await fsp.rename(tmp, target);
      await store.log(ctx.by, 'calendar.export-csv', { rows, target });
      return { ok: true, rows, path: target, backup, message: `Wrote ${rows} rows to ${target}${backup ? ` (the previous file is kept as ${path.basename(backup)})` : ''}.` };
    },
  },
  { method: 'POST', path: '/api/calendar/import-rows', handler: (ctx) => { ctx.requireApprover('import calendar rows'); return importRows(ctx.by); } },
];

// ------------------------------------------------------------ Today section

/** Adds the slots of the next seven days with what each still lacks. */
export async function enrichToday(payload) {
  const today = payload.date;
  const end = addDays(today, 7);
  await reconcileGoDark(today, end);
  const pieces = new Map(store.list('pieces').map((p) => [p.id, p]));
  const out = [];
  for (const s of store.list('slots', (x) => x.date >= today && x.date <= end)) {
    if (['dark', 'derived'].includes(s.state) && !s.pieceId) continue;
    const piece = s.pieceId ? pieces.get(s.pieceId) : null;
    if (s.state === 'optional' && !s.pieceId) continue;
    const missing = [];
    if (!piece) missing.push('no piece');
    else if (!['approved', 'scheduled', 'posted', 'measured'].includes(piece.status)) {
      const blocks = (piece.check?.violations || []).filter((v) => v.severity === 'block').length;
      missing.push(blocks ? 'blocked by the checker' : 'not approved');
    }
    if (!missing.length || s.state === 'dark') continue;
    out.push({
      ...s, slotLabel: s.label, label: `${s.label || s.kind} (${missing.join(', ')})`, missing,
      pieceId: s.pieceId, pieceHook: piece?.hook || s.csv?.hook || null, pieceStatus: piece?.status || null,
    });
  }
  payload.openSlots = out.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}
