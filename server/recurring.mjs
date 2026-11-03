// Recurring: festival and compliance events, greeting pieces and announcement
// drafting. [recurring]
//
// Events keep `tiers` and `community` (whoGets): they are the calendar's
// definition of which network tiers a festival goes to. Nothing about a person
// lives here; the Network tool reads events over GET /api/link/events.
//
// Routes (all under /api/recurring):
//   POST /import               seed data/events.source.json into events (idempotent on date + name)
//   POST /expand               { year? } copy annual-fixed national days into the next year
//   GET  /upcoming?days=30     events from today, with the greeting wording and the tiers it goes to
//   POST /generate             { from, to, eventId? } greeting pieces on the eve's Status slot
//   POST /templates            { eventId, tiers?, dryRun?, save? } run the greetingTemplates op
//   POST /announce             { campaignId, targets, dryRun? } run the announcement op, one piece per target
//   GET  /rules                the standing rules this module enforces, with the mourning-rule text
//   GET  /api/occasions/concepts?days=365      festivals in the next year that allow a concept, with their unused angles and proposals
//   POST /api/occasions/concepts/propose       { eventId, handOutput? } three concepts from the festivalConcept op, saved on the event by year
//   POST /api/occasions/concepts/make          { eventId, index, type? } the piece from a chosen concept, placed before the festival; the angle is marked used
//
// Plain event and campaign CRUD goes through the generic routes (/api/events, /api/campaigns).

import fs from 'node:fs';
import path from 'node:path';
import { store } from './store.mjs';

export const TIER_ORDER = ['platinum', 'gold', 'silver', 'bronze'];
export const GREETING_KINDS = new Set(['greeting', 'greeting-only']);
const SEED_FILE = 'events.source.json';
const WA_STATUS_ACCOUNT = 'wa-st';
const GREETING_TIME = '19:00';

// ------------------------------------------------------------------ dates

export function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayIST(tz = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

export function weekdayOf(ymd) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${ymd}T00:00:00Z`).getUTCDay()];
}

/** The evening before: where a greeting goes on Status. */
export const eveOf = (ymd) => addDays(ymd, -1);

// --------------------------------------------------- naming and classifying

// A short festival name for hooks and lists. Hooks are eight words or fewer.
const SHORT_NAMES = [
  [/^Diwali(,|\s*$)/i, 'Diwali'],
  [/^Dhanteras/i, 'Dhanteras'],
  [/^Holi\b/i, 'Holi'],
  [/^Rangpanchami/i, 'Rangpanchami'],
  [/^Makar Sankranti/i, 'Makar Sankranti'],
  [/^Dussehra \(Vijayadashami\)/i, 'Dussehra'],
  [/^Chhath/i, 'Chhath Puja'],
  [/^Guru Nanak/i, 'Guru Nanak Jayanti'],
  [/^Christmas Eve/i, 'Christmas Eve'],
  [/^Christmas/i, 'Christmas'],
  [/^New Year/i, 'New Year'],
  [/^Republic Day/i, 'Republic Day'],
  [/^Independence Day/i, 'Independence Day'],
  [/^Gandhi Jayanti/i, 'Gandhi Jayanti'],
  [/^Lohri/i, 'Lohri'],
  [/^Ramadan/i, 'Ramadan'],
  [/^Vasant Panchami/i, 'Vasant Panchami'],
  [/^Maha Shivaratri/i, 'Maha Shivaratri'],
  [/^Eid al-Fitr/i, 'Eid al-Fitr'],
  [/^Eid al-Adha/i, 'Eid al-Adha'],
  [/^Easter/i, 'Easter'],
  [/^Gudi Padwa/i, 'Gudi Padwa'],
  [/^Dr B\. R\. Ambedkar/i, 'Ambedkar Jayanti'],
  [/^Ram Navami/i, 'Ram Navami'],
  [/^Mahavir Jayanti/i, 'Mahavir Jayanti'],
  [/^Akshaya Tritiya/i, 'Akshaya Tritiya'],
  [/^Buddha Purnima/i, 'Buddha Purnima'],
  [/^Devi Ahilyabai/i, 'Ahilyabai Holkar Jayanti'],
  [/^Milad-un-Nabi/i, 'Milad-un-Nabi'],
  [/^Raksha Bandhan/i, 'Raksha Bandhan'],
  [/^Krishna Janmashtami/i, 'Janmashtami'],
  [/^Samvatsari/i, 'Samvatsari'],
  [/^Ganesh Chaturthi/i, 'Ganesh Chaturthi'],
  [/^Onam/i, 'Onam'],
  [/^Vishwakarma Puja/i, 'Vishwakarma Puja'],
  [/^Sharad Navratri/i, 'Navratri'],
  [/^Madhya Pradesh Foundation Day/i, 'Madhya Pradesh Foundation Day'],
];

export function shortName(name) {
  const full = String(name || '').trim();
  for (const [re, short] of SHORT_NAMES) if (re.test(full)) return short;
  let s = full.split(/;|:|\s\(|\sper\s|\sas listed/i)[0].trim();
  const words = s.split(/\s+/);
  if (words.length > 8) s = words.slice(0, 8).join(' ');
  return s || full.slice(0, 60);
}

// Records that repeat a festival under another reckoning. The primary record
// carries the greeting; the alternate stays on the calendar for its posting
// rule but never produces a second greeting.
const ALTERNATE = [
  /^Christmas Eve/i,
  /^Eid al-Fitr per the tentative MP list/i,
  /^Eid al-Adha \(Bakrid\) if the moon/i,
  /^Makar Sankranti per most general calendars/i,
];
export const isAlternate = (name) => ALTERNATE.some((re) => re.test(String(name || '')));

const ANNUAL_FIXED = [
  /^Republic Day/i, /^Independence Day/i, /^Gandhi Jayanti/i, /^Christmas/i, /^New Year/i,
  /^Dr B\. R\. Ambedkar/i, /^Madhya Pradesh Foundation Day/i, /^Devi Ahilyabai/i, /^Lohri/i,
];
const LUNAR_EVENT = /Ekadashi|Sankranti|Tulsi|Purnima|Navami|Ashtami|Ashura|Muharram|Islamic New Year|Jamat|Ravidas|Parashurama|Hanuman|Valmiki|Birsa|Teg Bahadur|Vasubaras|Paryushan|Pitru|Anant|Dussehra|Ramadan|Mauni|Mahavir|Good Friday|Guru Nanak|Holika|Holi|Diwali|Govardhan|Bhai Dooj|Naraka|Dhanteras|Kharmas|Chaturdashi/i;

export function recurrenceFor(rec) {
  const name = String(rec.name || '');
  if (rec.kind === 'compliance') return 'annual-fixed';
  if (ANNUAL_FIXED.some((re) => re.test(name))) return 'annual-fixed';
  if (rec.kind === 'wedding-muhurat') return 'lunar';
  if (GREETING_KINDS.has(rec.kind)) return 'lunar';
  if (rec.kind === 'dark') return LUNAR_EVENT.test(name) ? 'lunar' : 'none';
  if (rec.kind === 'event' || rec.kind === 'mourning') return LUNAR_EVENT.test(name) ? 'lunar' : 'none';
  return 'none';
}

// Festival wishes go to everyone (decided 3 November 2026): every network tier,
// every community. Network reads `tiers` over the link; an alternate reckoning
// of a festival carries none, so nobody receives two wishes.
export const ALL_TIERS = ['platinum', 'gold', 'silver', 'bronze'];

export function tiersFor(rec) {
  if (!GREETING_KINDS.has(rec.kind) || !rec.greetingText) return [];
  if (isAlternate(rec.name)) return [];
  return [...ALL_TIERS];
}

// What an occasion is, for the Occasions page. Stored on each event as `category`.
export const CATEGORIES = ['festival', 'national', 'business', 'wedding', 'local', 'break'];
const NATIONAL = /^(Republic Day|Independence Day|Gandhi Jayanti|Dr B\. R\. Ambedkar|Ambedkar Jayanti|Madhya Pradesh Foundation Day|Devi Ahilyabai|Ahilyabai Holkar|Birsa Munda)/i;
const BUSINESS = /Budget|Economic Survey|GST|TDS|Advance tax|financial year/i;
const LOCAL = /Marathon|summit|Board Class|examinations/i;
const BREAK = /block begins|Year-end dark day|Day after Holi/i;

export function categoryOf(rec) {
  const name = String(rec.name || '');
  const short = String(rec.shortName || '');
  const head = short || name;   // the long name often mentions other days; decide on the short one
  if (rec.kind === 'wedding-muhurat' || /^Last wedding muhurat/i.test(head)) return 'wedding';
  if (rec.kind === 'compliance' || rec.kind === 'budget' || BUSINESS.test(head)) return 'business';
  if (NATIONAL.test(name) || NATIONAL.test(short)) return 'national';
  if (LOCAL.test(head)) return 'local';
  if (BREAK.test(head)) return 'break';
  return 'festival';
}

// -------------------------------------------------------------------- import

function seedPath(file) {
  return path.resolve(store.dataDir, file || SEED_FILE);
}

function readSeed(file) {
  const p = seedPath(file);
  if (!fs.existsSync(p)) throw new Error(`Seed file not found: ${p}`);
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('The seed must be a JSON array');
  return rows;
}

const keyOf = (e) => `${e.date}|${e.name}`;

function summarise() {
  const events = store.list('events');
  const count = (f) => events.reduce((m, e) => { const k = f(e) || 'none'; m[k] = (m[k] || 0) + 1; return m; }, {});
  return { total: events.length, byKind: count((e) => e.kind), byPostingRule: count((e) => e.postingRule) };
}

export async function importSeed({ file, by } = {}) {
  const seed = readSeed(file);
  const existing = new Map(store.list('events').map((e) => [keyOf(e), e]));
  const skipped = [];
  let created = 0;
  let already = 0;
  const sorted = seed.map((r, i) => ({ r, i })).sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.i - b.i)).map((x) => x.r);
  for (const rec of sorted) {
    if (!rec || !isYmd(rec.date) || !rec.name) { skipped.push({ reason: 'incomplete record', name: rec?.name }); continue; }
    // The standing mourning rule is a rule, not a dated event: the Rules panel shows its text.
    if (rec.kind === 'mourning-rule' && /^Standing mourning rule/i.test(rec.name)) { skipped.push({ reason: 'standing mourning rule', name: rec.name.slice(0, 60) }); continue; }
    if (existing.has(keyOf(rec))) { already += 1; continue; }

    const kind = rec.kind === 'mourning-rule' ? 'mourning' : rec.kind;
    const postingRule = kind === 'compliance' ? 'quiet' : (rec.postingRule || 'normal');
    const ev = {
      id: store.nextId('ev'),
      date: rec.date,
      weekday: rec.weekday || weekdayOf(rec.date),
      name: rec.name,
      shortName: shortName(rec.name),
      kind,
      scope: rec.scope || 'national',
      greetingText: rec.greetingText || '',
      whoGets: GREETING_KINDS.has(kind) && rec.greetingText ? 'everyone' : 'none',
      postingRule,
      confidence: rec.confidence || 'expected',
      source: rec.source || '',
      note: rec.note || '',
      recurrence: recurrenceFor({ ...rec, kind }),
      tiers: tiersFor({ ...rec, kind }),
      category: categoryOf({ ...rec, kind }),
      templates: {},
      generated: {},
    };
    if (kind === 'compliance' && rec.postingRule && rec.postingRule !== 'quiet') ev.seedPostingRule = rec.postingRule;
    if (isAlternate(rec.name)) ev.noGenerate = true;
    if (by) ev.by = by;
    await store.put('events', ev);
    existing.set(keyOf(ev), ev);
    created += 1;
  }
  await store.log(by, 'recurring.import', { created, already, skipped: skipped.length });
  return { file: path.basename(seedPath(file)), seedRecords: seed.length, created, alreadyPresent: already, skipped, ...summarise() };
}

/** Copy annual-fixed national days (not the monthly compliance dates) into `year`. */
export async function expandAnnual({ year, by } = {}) {
  const events = store.list('events');
  if (!events.length) return { year: null, created: 0, note: 'No events to expand' };
  const target = Number(year) || Math.max(...events.map((e) => Number(e.date.slice(0, 4)))) + 1;
  const have = new Set(events.map(keyOf));
  const bases = events.filter((e) => e.recurrence === 'annual-fixed' && e.kind !== 'compliance' && Number(e.date.slice(0, 4)) < target);
  let created = 0;
  const seen = new Set();
  for (const b of bases) {
    const md = b.date.slice(5);
    const date = `${target}-${md}`;
    const k = `${date}|${b.name.replace(/\s*\(gazetted\)$/, '')}`;
    if (seen.has(k) || have.has(`${date}|${b.name}`) || events.some((e) => e.date === date && shortName(e.name) === shortName(b.name))) continue;
    if (!isYmd(date)) continue;
    seen.add(k);
    const { id: _id, createdAt: _c, updatedAt: _u, generated: _g, templates, seedPostingRule: _s, ...rest } = b;
    await store.put('events', {
      ...rest,
      id: store.nextId('ev'),
      date,
      weekday: weekdayOf(date),
      confidence: 'expected',
      source: `Expanded from ${b.date} (${b.id})`,
      note: b.note,
      templates: templates || {},
      generated: {},
      ...(by ? { by } : {}),
    });
    created += 1;
  }
  await store.log(by, 'recurring.expand', { year: target, created });
  return { year: target, created, ...summarise() };
}

// ------------------------------------------------------------------ wording

// The WhatsApp line is kept on the event for the Network tool, which reads it
// over the link and addresses it to each person there.
export const wording = (ev) => ({
  status: ev.templates?.status || ev.greetingText || '',
  linkedin: ev.templates?.linkedin || ev.greetingText || '',
  whatsapp: ev.templates?.whatsapp || ev.greetingText || '',
});

function annotate(ev) {
  const pieceId = ev.generated?.pieceId;
  const pieceExists = Boolean(pieceId && store.get('pieces', pieceId));
  return {
    ...ev,
    shortName: ev.shortName || shortName(ev.name),
    eve: eveOf(ev.date),
    hasGreeting: GREETING_KINDS.has(ev.kind) && Boolean(ev.greetingText),
    alternate: Boolean(ev.noGenerate),
    wording: wording(ev),
    pieceGenerated: pieceExists,
    pieceId: pieceExists ? pieceId : null,
  };
}

// ----------------------------------------------------------------- generate

function makePiece(ev, by) {
  const w = wording(ev);
  const renditions = { waStatus: { text: w.status } };
  if (/^(Diwali|New Year)/i.test(ev.name)) renditions.li = { text: w.linkedin };
  return {
    id: store.nextId('pc'),
    type: 'greeting',
    pillar: 'greeting',
    status: 'draft',
    hook: ev.shortName || shortName(ev.name),
    renditions,
    targets: [WA_STATUS_ACCOUNT],
    plannedDate: eveOf(ev.date),
    plannedTime: GREETING_TIME,
    eventId: ev.id,
    tags: ['greeting'],
    notes: `Greeting for ${ev.shortName || shortName(ev.name)} on ${ev.date}: the branded greeting image (Visuals, Festival greeting) on Status the evening before. No offer.`,
    ...(by ? { by } : {}),
  };
}

export async function generate({ from, to, eventId, eventIds, by } = {}) {
  if (!isYmd(from) || !isYmd(to)) throw new Error('from and to must be dates (YYYY-MM-DD)');
  if (to < from) throw new Error('to must not be before from');
  const wanted = new Set([...(eventIds || []), ...(eventId ? [eventId] : [])]);
  const events = store.list('events', (e) => e.date >= from && e.date <= to && GREETING_KINDS.has(e.kind) && e.greetingText
    && (!wanted.size || wanted.has(e.id))).sort((a, b) => a.date.localeCompare(b.date));

  const out = [];
  const totals = { events: 0, piecesCreated: 0, piecesExisting: 0, alternates: 0 };
  for (const ev of events) {
    const row = { eventId: ev.id, name: ev.shortName || shortName(ev.name), date: ev.date, eve: eveOf(ev.date) };
    if (ev.noGenerate) {
      row.skipped = 'Alternate date of a festival that has its own greeting';
      totals.alternates += 1;
      out.push(row);
      continue;
    }
    totals.events += 1;
    const generated = { ...(ev.generated || {}) };

    const existing = generated.pieceId ? store.get('pieces', generated.pieceId) : null;
    if (existing) {
      row.piece = 'exists';
      row.pieceId = existing.id;
      totals.piecesExisting += 1;
    } else {
      const piece = await store.put('pieces', makePiece(ev, by));
      await store.put('versions', {
        id: store.nextId('vr'), pieceId: piece.id, n: 1, snapshot: piece, by: by || null,
        at: new Date().toISOString(), changeNote: `Generated for ${row.name}`,
      });
      generated.pieceId = piece.id;
      generated.pieceAt = new Date().toISOString();
      row.piece = 'created';
      row.pieceId = piece.id;
      totals.piecesCreated += 1;
    }

    await store.patch('events', ev.id, { generated });
    out.push(row);
  }
  await store.log(by, 'recurring.generate', { from, to, ...totals });
  return { from, to, events: out, totals };
}

// ----------------------------------------------------------------- upcoming

export function upcoming({ days = 30, date } = {}) {
  const settings = store.getSingleton('settings') || {};
  const today = isYmd(date) ? date : todayIST(settings.timezone);
  const to = addDays(today, Math.max(1, Math.min(Number(days) || 30, 400)));
  const items = store.list('events', (e) => e.date >= today && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
    .map(annotate)
    .map((e) => ({ ...e, daysAway: Math.round((new Date(`${e.date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000) }));
  return { today, from: today, to, goDark: settings.goDark || { on: false }, items };
}

// -------------------------------------------------------------------- rules

const FALLBACK_MOURNING = 'On the death of a national figure or a mass-casualty event, pause every scheduled post within the hour; stay dark through the funeral day; during declared national or state mourning resume only non-promotional posts from day three; a plain-text condolence is optional, never a designed card.';

function mourningRule() {
  try {
    const rec = readSeed().find((r) => r.kind === 'mourning-rule' && /^Standing mourning rule/i.test(r.name));
    if (rec) {
      const text = rec.name.replace(/^Standing mourning rule\s*\(applies on any day\):\s*/i, '');
      return { text: text.charAt(0).toUpperCase() + text.slice(1) + '.', note: rec.note || '', source: rec.source || '' };
    }
  } catch { /* fall through */ }
  return { text: FALLBACK_MOURNING, note: '', source: '' };
}

// ---------------------------------------------------------- AI op plumbing

async function loadOp(ctx, name) {
  // ai.run loads ops itself; the dry run needs the op module for its prompt and schema.
  const mod = await import(`./ops/${name}.mjs?v=${fs.statSync(new URL(`./ops/${name}.mjs`, import.meta.url)).mtimeMs}`);
  return mod;
}

function opInputError(ctx, message) {
  return new ctx.HttpError(400, message);
}

// --------------------------------------------------------------- concepts
//
// A festival concept is the piece beside the greeting: a festival image, an owner's scene and
// one tool we sell, different every year. Angles live in data/festival-angles.json with the
// years they were used; a festival never repeats an angle within four years.

const CONCEPT_YEARS = 4;
const CONCEPT_TYPES = { 'reel-animated': 'reel', broll: 'reel', carousel: 'carousel', 'status-rule': 'status' };

function unusedAngles(series, year) {
  return store.list('festival-angles', (a) => a.series === series && !(a.usedIn || []).some((y) => Number(y) > year - CONCEPT_YEARS && Number(y) <= year));
}

function conceptView(ev, today) {
  const year = Number(ev.date.slice(0, 4));
  const angles = unusedAngles(ev.series, year);
  const saved = ev.concepts?.[String(year)] || null;
  const pieceId = ev.generated?.conceptPieceId;
  const piece = pieceId ? store.get('pieces', pieceId) : null;
  return {
    id: ev.id, name: ev.name, shortName: ev.shortName || shortName(ev.name), date: ev.date, year, series: ev.series || null,
    whoGets: ev.whoGets, postingRule: ev.postingRule, conceptAllowed: Boolean(ev.conceptAllowed), alternate: Boolean(ev.noGenerate),
    daysAway: Math.round((new Date(`${ev.date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000),
    anglesUnused: angles.length, anglesTotal: store.list('festival-angles', (a) => a.series === ev.series).length,
    proposals: saved ? saved.proposals : [], proposedAt: saved?.at || null, proposedMode: saved?.mode || null,
    pieceId: piece ? piece.id : null, pieceHook: piece?.hook || null, pieceStatus: piece?.status || null, pieceDate: piece?.plannedDate || null,
    usedAngleId: ev.generated?.conceptAngleId || null,
  };
}

/** The nearest allotted slot in the three to seven days before the festival that takes the piece, never on a dark or greeting-only day. */
function slotBefore(ev, type) {
  const kind = CONCEPT_TYPES[type] || 'reel';
  const from = addDays(ev.date, -7);
  const to = addDays(ev.date, -3);
  const dark = new Set(store.list('events', (e) => e.date >= from && e.date <= to && (e.kind === 'dark' || e.postingRule === 'dark' || e.kind === 'greeting-only' || e.postingRule === 'greeting-only')).map((e) => e.date));
  const settings = store.getSingleton('settings') || {};
  const gd = settings.goDark?.on ? settings.goDark : null;
  const held = (d) => gd && (!gd.from || d >= gd.from) && (!gd.to || d <= gd.to);
  return store.list('slots', (s) => s.date >= from && s.date <= to && !s.pieceId && !s.csv && ['open', 'optional'].includes(s.state)
    && (s.kind === kind || (kind === 'reel' && s.kind === 'trial')) && !dark.has(s.date) && !held(s.date))
    .sort((a, b) => b.date.localeCompare(a.date) || String(a.kind === kind ? 0 : 1).localeCompare(String(b.kind === kind ? 0 : 1)))[0] || null;
}

/** The latest day in the three-to-seven-day window before the festival that allows a post. */
function freeDayBefore(ev) {
  const from = addDays(ev.date, -7);
  const to = addDays(ev.date, -3);
  const blocked = new Set(store.list('events', (e) => e.date >= from && e.date <= to && ['dark', 'greeting-only'].includes(e.kind === 'dark' || e.kind === 'greeting-only' ? e.kind : e.postingRule)).map((e) => e.date));
  const settings = store.getSingleton('settings') || {};
  const gd = settings.goDark?.on ? settings.goDark : null;
  for (let d = to; d >= from; d = addDays(d, -1)) {
    if (blocked.has(d)) continue;
    if (gd && (!gd.from || d >= gd.from) && (!gd.to || d <= gd.to)) continue;
    if (weekdayOf(d) === 'Sun') continue;
    return d;
  }
  return null;
}

function pieceFromConcept(ev, c, type, by) {
  const solution = store.get('solutions', c.solutionId);
  const sol = solution?.publicName || c.solutionName || '';
  const renditions = {};
  if (type === 'status-rule') renditions.waStatus = { text: c.statusLine };
  else {
    renditions.ig = { caption: c.reelCaption, hashtags: [], firstComment: '' };
    renditions.waStatus = { text: c.statusLine };
    renditions.li = { text: `${c.linkedinOpening}\n\n[the rest of the post: the scene, what it costs, and ${sol}]`, firstComment: '' };
  }
  const targets = type === 'status-rule' ? ['wa-st'] : type === 'carousel' ? ['vd-ig', 'p-li', 'wa-st'] : ['vd-ig', 'p-li', 'wa-st'];
  const piece = {
    id: store.nextId('pc'), type, pillar: 'problem', status: 'in-review',
    hook: type === 'carousel' ? c.carouselCover.replace(/\*/g, '') : c.reelHook,
    pis: { problem: c.scene, impact: '', solution: [sol ? `${sol}: ${c.idea}` : c.idea], close: c.statusLine.replace(/\*/g, '') },
    renditions, targets,
    ...(type === 'carousel' ? { slides: [{ t: 'cover', eyebrow: ev.shortName || shortName(ev.name), head: c.carouselCover, body: c.scene }, { t: 'cta', head: `*${sol}*`, body: c.idea, foot: 'Run the business. Not the follow-ups.' }] } : {}),
    tags: ['festival', ev.series].filter(Boolean),
    eventId: ev.id, solutionId: c.solutionId || undefined,
    notes: `Festival concept for ${ev.shortName || shortName(ev.name)} ${ev.date.slice(0, 4)} (angle ${c.angleId}): ${c.idea} Sells ${sol}. Goes out in the three to seven days before the festival; the greeting itself stays plain, on the eve.`,
    ...(by ? { by } : {}),
  };
  return piece;
}

const conceptRoutes = [
  {
    method: 'GET', path: '/api/occasions/concepts',
    handler: async (ctx) => {
      const settings = ctx.settings();
      const today = todayIST(settings.timezone);
      const to = addDays(today, Math.max(30, Math.min(Number(ctx.query.days) || 365, 400)));
      const items = store.list('events', (e) => e.date >= today && e.date <= to && GREETING_KINDS.has(e.kind) && e.series && !e.noGenerate)
        .sort((a, b) => a.date.localeCompare(b.date)).map((e) => conceptView(e, today));
      return { today, to, items };
    },
  },
  {
    method: 'POST', path: '/api/occasions/concepts/propose',
    handler: async (ctx) => {
      const b = bodyOf(ctx);
      const ev = store.get('events', String(b.eventId || ''));
      if (!ev) throw new ctx.HttpError(404, 'Event not found');
      if (!ev.conceptAllowed) throw new ctx.HttpError(409, 'This occasion takes the greeting only; an approver can allow a concept on the event.');
      if (!ev.series) throw new ctx.HttpError(409, 'This event has no series key, so it has no angle bank.');
      const year = Number(ev.date.slice(0, 4));
      const angles = unusedAngles(ev.series, year);
      if (!angles.length) throw new ctx.HttpError(409, `Every angle for ${ev.shortName || ev.name} was used in the last ${CONCEPT_YEARS} years; add angles to the bank in data/festival-angles.json.`);
      const input = {
        event: { id: ev.id, name: ev.name, shortName: ev.shortName || shortName(ev.name), date: ev.date, series: ev.series, whoGets: ev.whoGets, note: ev.note || '' },
        angles: angles.map(({ id, title, image, scene, solutionId, solutionName, line }) => ({ id, title, image, scene, solutionId, solutionName, line })),
        year,
        ...(b.handOutput ? { handOutput: b.handOutput } : {}),
      };
      const aiCtx = ctx.ai.buildCtx({ by: ctx.by });
      if (b.dryRun) { const op = await loadOp(ctx, 'festivalConcept'); return { ...op.buildPrompt(input, aiCtx), schema: op.schema }; }
      const result = await ctx.ai.run('festivalConcept', input, aiCtx);
      const concepts = { ...(ev.concepts || {}), [String(year)]: { proposals: result.output.concepts, at: new Date().toISOString(), mode: result.mode, by: ctx.by || null } };
      const stored = await store.patch('events', ev.id, { concepts });
      await store.log(ctx.by, 'occasions.concepts.propose', { eventId: ev.id, year, mode: result.mode, n: result.output.concepts.length });
      return { event: conceptView(stored, todayIST(ctx.settings().timezone)), mode: result.mode, ms: result.ms };
    },
  },
  {
    method: 'POST', path: '/api/occasions/concepts/make',
    handler: async (ctx) => {
      const b = bodyOf(ctx);
      const ev = store.get('events', String(b.eventId || ''));
      if (!ev) throw new ctx.HttpError(404, 'Event not found');
      const year = String(ev.date.slice(0, 4));
      const saved = ev.concepts?.[year];
      const c = saved?.proposals?.[Number(b.index)];
      if (!c) throw new ctx.HttpError(400, 'Choose one of the proposed concepts first');
      if (ev.generated?.conceptPieceId && store.get('pieces', ev.generated.conceptPieceId)) throw new ctx.HttpError(409, `A concept piece already exists for this year (${ev.generated.conceptPieceId})`);
      const type = ['reel-animated', 'broll', 'carousel', 'status-rule'].includes(b.type) ? b.type : (c.type || 'broll');
      const piece = await store.put('pieces', pieceFromConcept(ev, c, type, ctx.by));
      await store.put('versions', { id: store.nextId('vr'), pieceId: piece.id, n: 1, snapshot: piece, by: ctx.by || null, at: new Date().toISOString(), changeNote: `Made from the ${ev.shortName || shortName(ev.name)} concept "${c.idea.slice(0, 60)}"` });
      // Place it on the nearest allotted slot in the three to seven days before the festival; when the
      // plan has filled every fitting slot in that window, a slot of the right kind is added on the
      // nearest day that allows a post (the same choice the calendar's Move dialog offers).
      let slot = slotBefore(ev, type);
      let added = false;
      if (!slot) {
        const day = freeDayBefore(ev);
        if (day) {
          const kind = CONCEPT_TYPES[type] || 'reel';
          const accountId = piece.targets[0];
          const time = kind === 'status' ? '09:00' : kind === 'carousel' || kind === 'reel' ? '19:30' : '';
          slot = await store.put('slots', { id: store.nextId('sl'), date: day, time, accountId, kind, label: `${ev.shortName || shortName(ev.name)} concept`, baseState: 'open', state: 'open', source: 'manual', generated: false, reason: `Added for the ${ev.shortName || shortName(ev.name)} concept: every allotted slot in the window was filled.` });
          added = true;
        }
      }
      let placed = null;
      if (slot) {
        await store.patch('slots', slot.id, { pieceId: piece.id, state: 'filled' });
        await store.patch('pieces', piece.id, { plannedDate: slot.date, plannedTime: slot.time || undefined });
        placed = { slotId: slot.id, date: slot.date, time: slot.time, added };
      }
      // The angle is used for this year.
      const angle = store.get('festival-angles', c.angleId);
      if (angle) await store.patch('festival-angles', angle.id, { usedIn: [...new Set([...(angle.usedIn || []), Number(year)])] });
      const generated = { ...(ev.generated || {}), conceptPieceId: piece.id, conceptAngleId: c.angleId, conceptAt: new Date().toISOString() };
      const stored = await store.patch('events', ev.id, { generated });
      await store.log(ctx.by, 'occasions.concepts.make', { eventId: ev.id, pieceId: piece.id, angleId: c.angleId, placed });
      return { piece: store.get('pieces', piece.id), placed, event: conceptView(stored, todayIST(ctx.settings().timezone)), note: placed ? null : 'No open slot of that kind in the three to seven days before the festival; the piece is in the library unplaced.' };
    },
  },
];

// ------------------------------------------------------------------- routes

const bodyOf = (ctx) => (ctx.body && typeof ctx.body === 'object' ? ctx.body : {});

export const routes = [
  ...conceptRoutes,
  {
    method: 'POST', path: '/api/recurring/import',
    handler: async (ctx) => {
      ctx.requireApprover('import events');
      try { return await importSeed({ file: bodyOf(ctx).file, by: ctx.by }); }
      catch (err) { throw new ctx.HttpError(400, err.message); }
    },
  },
  {
    method: 'POST', path: '/api/recurring/expand',
    handler: async (ctx) => { ctx.requireApprover('expand the calendar'); return expandAnnual({ year: bodyOf(ctx).year, by: ctx.by }); },
  },
  {
    method: 'GET', path: '/api/recurring/upcoming',
    handler: async (ctx) => upcoming({ days: ctx.query.days, date: ctx.query.date }),
  },
  {
    method: 'GET', path: '/api/recurring/rules',
    handler: async (ctx) => {
      const settings = ctx.settings();
      return {
        mourningRule: mourningRule(),
        goDark: settings.goDark || { on: false },
        greetingTime: GREETING_TIME,
        greetingAccount: WA_STATUS_ACCOUNT,
      };
    },
  },
  {
    method: 'POST', path: '/api/recurring/generate',
    handler: async (ctx) => {
      const b = bodyOf(ctx);
      try { return await generate({ from: b.from, to: b.to, eventId: b.eventId, eventIds: b.eventIds, by: ctx.by }); }
      catch (err) { throw new ctx.HttpError(400, err.message); }
    },
  },
  {
    // Wording for one event from the greetingTemplates op. dryRun returns the prompt only.
    method: 'POST', path: '/api/recurring/templates',
    handler: async (ctx) => {
      const b = bodyOf(ctx);
      const ev = ctx.store.get('events', String(b.eventId || ''));
      if (!ev) throw new ctx.HttpError(404, 'Event not found');
      const tiers = Array.isArray(b.tiers) && b.tiers.length ? b.tiers : (ev.tiers || []);
      const input = { event: pickEvent(ev), tiers, ...(b.handOutput ? { handOutput: b.handOutput } : {}) };
      const aiCtx = ctx.ai.buildCtx({ by: ctx.by });
      if (b.dryRun) {
        const op = await loadOp(ctx, 'greetingTemplates');
        return { ...op.buildPrompt(input, aiCtx), schema: op.schema };
      }
      const result = await ctx.ai.run('greetingTemplates', input, aiCtx);
      let event = ev;
      if (b.save !== false) {
        const { status, linkedin, whatsapp } = result.output;
        event = await ctx.store.patch('events', ev.id, { templates: { status, linkedin, whatsapp } });
        await ctx.store.log(ctx.by, 'recurring.templates', ev.id);
      }
      return { output: result.output, event, mode: result.mode, ms: result.ms };
    },
  },
  {
    method: 'POST', path: '/api/recurring/announce',
    handler: async (ctx) => {
      const b = bodyOf(ctx);
      const campaign = ctx.store.get('campaigns', String(b.campaignId || ''));
      if (!campaign) throw new ctx.HttpError(404, 'Campaign not found');
      const accounts = ctx.store.list('accounts');
      const targetIds = (Array.isArray(b.targets) && b.targets.length ? b.targets : campaign.targets || []).map(String);
      if (!targetIds.length) throw opInputError(ctx, 'Choose at least one account to draft for');
      const unknown = targetIds.filter((id) => !accounts.some((a) => a.id === id));
      if (unknown.length) throw opInputError(ctx, `Unknown account: ${unknown.join(', ')}`);
      const facts = Array.isArray(b.facts) ? b.facts : campaign.facts;
      const input = {
        campaign: {
          name: campaign.name, kind: campaign.kind, from: campaign.from, to: campaign.to,
          facts: (facts || []).map(String).filter(Boolean), notes: campaign.notes || '',
          thirdParty: b.thirdParty ?? campaign.thirdParty ?? '',
        },
        targets: targetIds,
        ...(b.handOutput ? { handOutput: b.handOutput } : {}),
      };
      if (!input.campaign.facts.length) throw opInputError(ctx, 'Add the facts of the campaign first, one plain line each');
      const aiCtx = ctx.ai.buildCtx({ by: ctx.by });
      if (b.dryRun) {
        const op = await loadOp(ctx, 'announcement');
        return { ...op.buildPrompt(input, aiCtx), schema: op.schema };
      }
      const result = await ctx.ai.run('announcement', input, aiCtx);
      const pieces = [];
      for (const item of result.output.pieces || []) {
        const account = accounts.find((a) => a.id === item.target);
        if (!account) continue;
        const piece = buildAnnouncementPiece(item, account, campaign, ctx.by);
        const stored = await ctx.store.put('pieces', { ...piece, id: ctx.store.nextId('pc') });
        await ctx.store.put('versions', {
          id: ctx.store.nextId('vr'), pieceId: stored.id, n: 1, snapshot: stored, by: ctx.by || null,
          at: new Date().toISOString(), changeNote: `Drafted for ${campaign.name}`,
        });
        pieces.push(stored);
      }
      const pieceIds = [...new Set([...(campaign.pieceIds || []), ...pieces.map((p) => p.id)])];
      const updated = await ctx.store.patch('campaigns', campaign.id, { pieceIds, ...(facts ? { facts: input.campaign.facts } : {}) });
      await ctx.store.log(ctx.by, 'recurring.announce', { campaignId: campaign.id, pieces: pieces.map((p) => p.id) });
      return { campaign: updated, pieces, mode: result.mode, ms: result.ms };
    },
  },
];

function pickEvent(ev) {
  return {
    name: ev.name, shortName: ev.shortName || shortName(ev.name), date: ev.date, kind: ev.kind, scope: ev.scope,
    whoGets: ev.whoGets, postingRule: ev.postingRule, greetingText: ev.greetingText || '', note: ev.note || '',
  };
}

// Account id -> rendition key.
const RENDITION_KEY = {
  'vd-ig': 'ig', 'p-ig': 'ig', 'vd-fb': 'fb', 'p-fb': 'fb', 'vd-li': 'liCo', 'p-li': 'li',
  'wa-st': 'waStatus', fam: 'waStatus', 'wa-note': 'waNote', yt: 'yt',
};

export function buildAnnouncementPiece(item, account, campaign, by) {
  const key = RENDITION_KEY[account.id] || 'li';
  const text = String(item.text || '').trim();
  const tags = (item.hashtags || []).map(String);
  let rendition;
  if (key === 'ig') rendition = { caption: text, hashtags: tags, firstComment: item.firstComment || '' };
  else if (key === 'li') rendition = { text, firstComment: item.firstComment || '' };
  else if (key === 'yt') rendition = { title: item.title || item.hook || campaign.name, description: text, tags };
  else rendition = { text };
  return {
    type: 'announcement',
    pillar: 'announcement',
    status: 'draft',
    hook: String(item.hook || campaign.name).trim(),
    renditions: { [key]: rendition },
    targets: [account.id],
    campaignId: campaign.id,
    tags: ['announcement', campaign.kind].filter(Boolean),
    notes: `Drafted for the campaign "${campaign.name}" for ${account.label}.`,
    ...(by ? { by } : {}),
  };
}

// ------------------------------------------------------------------- today

export async function enrichToday(payload) {
  const today = payload.date;
  const next14 = (payload.events || store.list('events', (e) => e.date >= today && e.date <= addDays(today, 14)))
    .map((e) => store.get('events', e.id) || e)
    .map(annotate)
    .map((e) => ({
      ...e,
      greetingsGenerated: e.hasGreeting && !e.alternate && e.pieceGenerated,
    }));
  payload.events = next14;
  payload.recurring = { next14 };
}
