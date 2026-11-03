// video.mjs: video projects, the AI steps, the footage search and the hand-off
// to the brand-video pipeline (`bv`). [video]
//
// A project (contract 4.10) lives in the `videos` collection. Its folder is
// video/<id>/ and holds what the hand-off writes: script.md, brand.json,
// scenes-plan.json, footage-list.md, shot-plan.md, HANDOFF.md, plus clips/
// (own clips) and voice/ (the recorded voice).
//
// Routes (all under /api/video):
//   GET  /api/video/bv                        status of the bv runner and its setup
//   POST /api/video/spoken                    { text, marks?, chapter? } -> spoken form, segments, lint
//   POST /api/video                           create from { pieceId } | { solutionId } | { subject }
//   GET  /api/video/:id/chunks                the script cut into parts for scene planning
//   GET  /api/video/:id/files                 clips/ and voice/ on disk
//   GET  /api/video/:id/voice-script          the script as it is read aloud, by chapter
//   GET  /api/video/:id/footage-list          footage-list.md and shot-plan.md as text
//   GET  /api/video/:id/youtube               title, description, chapter timestamps, readiness checks
//   POST /api/video/:id/outline | script | scenes | shorts    AI steps
//   POST /api/video/:id/footage               { scene, query } -> runs `bv broll search`
//   POST /api/video/:id/handoff               writes the project folder, returns commands and the prompt
//   POST /api/video/:id/own-clips             multipart upload, or JSON register | map | remove
//   POST /api/video/:id/voice                 multipart upload of the recorded voice
//   POST /api/video/:id/done                  records the final MP4, title, description; status done
//
// Every AI step accepts { dryRun: true } and returns { system, user, schema }
// without calling Claude, and { output } to apply a result obtained elsewhere
// (it goes through the same schema check and postProcess).
//
// ctx = { req, res, params, query, body, rawBody, by, store, ai, settings(), rules(), HttpError }.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { parseMultipart } from './multipart.mjs';

// ------------------------------------------------------------------ constants

export const STEPS = ['outline', 'script', 'scenes', 'footage', 'voice', 'own-clips', 'edit', 'done'];
export const STEP_LABEL = {
  outline: 'Outline', script: 'Script', scenes: 'Scenes', footage: 'Footage', voice: 'Voice',
  'own-clips': 'Own clips', edit: 'Edit', done: 'Done',
};
const NEXT_ACTION = {
  outline: 'Draft the outline', script: 'Write the script', scenes: 'Plan the scenes', footage: 'Choose the footage',
  voice: 'Record the voice', 'own-clips': 'Add your own clips', edit: 'Hand off to Claude Code', done: 'Finished',
};

export const WPM = 140;                 // spoken words a minute, the planning rate
export const FACE_CHAPTERS = [1, 5, 6]; // the three face moments: problem, what changed, close
export const MAX_FACE_PER_CHAPTER = 3;
export const SCENE_KINDS = ['broll', 'screen', 'face', 'card'];
export const PART_WORDS = 600;          // scene planning works on parts of about this many words

/** The six chapters of the case study (phase 1 design 5.8). */
export const CHAPTER_PLAN = [
  { n: 1, key: 'problem', title: "The owner's problem", min: 3, max: 5, face: true,
    brief: "The owner's problem, told as one scene a managing director recognises, from the problem bank. It opens with the problem and its cost inside the first 30 seconds." },
  { n: 2, key: 'cost', title: 'What it cost us', min: 3, max: 5, face: false,
    brief: "What the same problem cost VSP, in VSP's own words. No client, lender or staff detail." },
  { n: 3, key: 'design', title: 'The design question', min: 4, max: 6, face: false,
    brief: 'Why this is a design problem, not a discipline problem: where the work had no home, no visible state and no feedback loop.' },
  { n: 4, key: 'build', title: 'The build', min: 15, max: 24, face: false,
    brief: 'The system on the masked copy, walked through step by step. Every frame is checked for real names before it is shown. The build stays on screen.' },
  { n: 5, key: 'changed', title: 'What changed, and the honest limit', min: 4, max: 6, face: true,
    brief: 'What changed once the system ran, and the honest limit: we run the system, the team still does the work.' },
  { n: 6, key: 'start', title: 'How to start with one process', min: 2, max: 4, face: true,
    brief: 'How an owner would start with one process. The call to action is the 30-minute call.' },
];

/** Whole minutes per chapter that sum to `target`, inside each chapter's range. */
export function defaultMinutes(target = 38) {
  const t = Math.max(30, Math.min(45, Math.round(target)));
  const mins = CHAPTER_PLAN.map((c) => c.min);
  let left = t - mins.reduce((a, b) => a + b, 0);
  const order = [3, 2, 4, 1, 0, 5]; // the build first, then the design question, what changed...
  let guard = 0;
  while (left > 0 && guard++ < 200) {
    for (const i of order) {
      if (left > 0 && mins[i] < CHAPTER_PLAN[i].max) { mins[i] += 1; left -= 1; }
    }
  }
  return mins;
}

// ------------------------------------------------------------------ small helpers

export const wordCount = (s) => (String(s || '').match(/\S+/g) || []).length;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const splitSentences = (line) => String(line || '').split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
const normWords = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const roundUpHalf = (x) => Math.ceil(x * 2) / 2;

/** Seconds a run of spoken text takes at the planning rate, rounded up to half a second, at least 3. */
export function sceneSeconds(text) {
  return Math.max(3, roundUpHalf((wordCount(text) / WPM) * 60));
}

export function fmtClock(sec, forceHours = false) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h || forceHours ? `${h}:${two(m)}:${two(r)}` : `${two(m)}:${two(r)}`;
}

/** 'm:ss', 'mm:ss' or 'h:mm:ss' to seconds; null when it is not a timecode. */
export function parseClock(text) {
  const m = /^\s*(?:(\d+):)?(\d{1,3}):(\d{2})\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  return (m[1] ? parseInt(m[1], 10) * 3600 : 0) + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}

const slugify = (s, max = 40) => {
  const full = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (full.length <= max) return full || 'chapter';
  const cut = full.slice(0, max);
  return (cut.includes('-') && full[max] !== '-' ? cut.slice(0, cut.lastIndexOf('-')) : cut) || 'chapter';
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmtLong = (sec) => {
  const m = Math.round(sec / 60);
  return m < 90 ? `${Math.max(1, m)} minutes` : `${Math.round((sec / 3600) * 10) / 10} hours`;
};
const pad = (n, w = 2) => String(n).padStart(w, '0');
const safeName = (name) => {
  const base = path.basename(String(name || 'file')).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
  const ext = path.extname(base);
  return base.slice(0, base.length - ext.length).slice(0, 60) + ext.toLowerCase();
};
const uniqueName = (dir, name) => {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let out = name; let n = 1;
  while (fs.existsSync(path.join(dir, out))) out = `${stem}-${++n}${ext}`;
  return out;
};
const linkOrCopy = (src, dst) => {
  try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); }
};

// ------------------------------------------------------------------ the script text

/** '## 1. Title' headings split the script into chapters. */
export function parseScript(script) {
  const text = String(script || '').replace(/\r\n/g, '\n');
  const re = /^##\s+(\d+)\.\s*(.*)$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ n: parseInt(m[1], 10), title: m[2].trim(), at: m.index, end: m.index + m[0].length });
  if (!marks.length) return text.trim() ? [{ n: 1, title: '', text: text.trim() }] : [];
  return marks.map((mk, i) => ({
    n: mk.n, title: mk.title,
    text: text.slice(mk.end, i + 1 < marks.length ? marks[i + 1].at : text.length).trim(),
  }));
}

export function joinScript(chapters) {
  return chapters
    .filter((c) => c && (c.text || c.title))
    .sort((a, b) => a.n - b.n)
    .map((c) => `## ${c.n}. ${c.title || ''}`.trimEnd() + `\n\n${String(c.text || '').trim()}`)
    .join('\n\n') + '\n';
}

/** The script cut into parts of about PART_WORDS for scene planning. Paragraph boundaries are kept where possible. */
export function scriptChunks(script, limit = PART_WORDS) {
  const chunks = [];
  for (const ch of parseScript(script)) {
    const paragraphs = ch.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    let cur = [];
    let curWords = 0;
    const flush = () => {
      if (cur.length) chunks.push({ part: chunks.length + 1, chapter: ch.n, words: curWords, sentences: cur });
      cur = []; curWords = 0;
    };
    for (const p of paragraphs) {
      for (const para of p.split('\n').map((l) => l.trim()).filter(Boolean)) {
        const sents = splitSentences(para);
        const w = wordCount(para);
        if (curWords && curWords + w > limit) flush();
        if (w > limit * 1.5) {
          // a very long paragraph: add it sentence by sentence
          for (const s of sents) {
            const sw = wordCount(s);
            if (curWords && curWords + sw > limit) flush();
            cur.push(s); curWords += sw;
          }
        } else { cur.push(...sents); curWords += w; }
      }
    }
    flush();
  }
  return chunks;
}

// ------------------------------------------------------------------ read-aloud forms

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh',
  'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth',
  'twenty-first', 'twenty-second', 'twenty-third', 'twenty-fourth', 'twenty-fifth', 'twenty-sixth', 'twenty-seventh',
  'twenty-eighth', 'twenty-ninth', 'thirtieth', 'thirty-first'];
const below100 = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ''));
const below1000 = (n) => {
  const h = Math.floor(n / 100); const r = n % 100;
  return (h ? `${ONES[h]} hundred${r ? ' ' : ''}` : '') + (r ? below100(r) : '');
};

/** An integer in words, Indian grouping: thousand, lakh, crore. */
export function numberToWords(n) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n === 0) return 'zero';
  if (n >= 1e12) return String(n).split('').map((d) => ONES[+d]).join(' ');
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${numberToWords(crore)} crore`);
  if (lakh) parts.push(`${below100(lakh)} lakh`);
  if (th) parts.push(`${below100(th)} thousand`);
  if (n) parts.push(below1000(n));
  return parts.join(' ');
}

/** '1.5' to 'one point five'. Commas are ignored. */
function decimalToWords(text) {
  const [whole, frac] = String(text).replace(/,/g, '').split('.');
  const w = numberToWords(parseInt(whole || '0', 10));
  return frac ? `${w} point ${frac.split('').map((d) => ONES[+d]).join(' ')}` : w;
}

function yearToWords(y) {
  if (y === 2000) return 'two thousand';
  if (y > 2000 && y < 2010) return `two thousand and ${ONES[y - 2000]}`;
  if (y >= 2010 && y < 2100) return `twenty ${below100(y - 2000)}`;
  const hi = Math.floor(y / 100); const lo = y % 100;
  if (lo === 0) return `${below100(hi)} hundred`;
  return `${below100(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : below100(lo)}`;
}

const AS_WORD = new Set(['NASA', 'FIFO', 'LIFO']);
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const NUM = String.raw`\d(?:[\d,]*\d)?(?:\.\d+)?`;
const READ_RX = new RegExp([
  String.raw`(?<rs>\bRs\.?\s?(?<rsn>${NUM})(?:\s?(?<rsu>crore|cr|lakhs|lakh|thousand))?\b)`,
  String.raw`(?<pct>\b${NUM}\s?%)`,
  String.raw`(?<ord>\b\d{1,2}(?:st|nd|rd|th)\b)`,
  String.raw`(?<sl>\b24\/7\b)`,
  String.raw`(?<frac>\b\d+\/\d+\b)`,
  String.raw`(?<year>(?<=\b(?:[Ii]n|[Ss]ince|[Ff]rom|[Bb]y|[Oo]f|[Yy]ear|[Uu]ntil|[Tt]ill|[Bb]efore|[Aa]fter|${MONTHS})\s)(?:19|20)\d{2}\b)`,
  String.raw`(?<num>\b${NUM}\b)`,
  String.raw`(?<acr>\b[A-Z]{2,6}s?\b)`,
].join('|'), 'g');

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The text cut into segments: { text } for plain runs and { written, spoken }
 * for every number, amount, percent, year, date and acronym. `marks` is a list
 * of { written, spoken } the writer supplied; they win over the rules.
 */
export function spokenSegments(text, marks = []) {
  const src = String(text || '');
  const list = (marks || []).filter((m) => m && m.written && m.spoken && m.written !== m.spoken)
    .sort((a, b) => b.written.length - a.written.length);
  const bySource = new Map(list.map((m) => [m.written, m.spoken]));
  const rx = list.length
    ? new RegExp(`(?<mark>${list.map((m) => escapeRx(m.written)).join('|')})|${READ_RX.source}`, 'g')
    : new RegExp(READ_RX.source, 'g');
  const out = [];
  let last = 0;
  let m;
  while ((m = rx.exec(src))) {
    if (m[0] === '') { rx.lastIndex++; continue; }
    const g = m.groups || {};
    let spoken = null;
    if (g.mark) spoken = bySource.get(g.mark);
    else if (g.rs) {
      const unit = g.rsu ? ({ cr: 'crore', lakhs: 'lakh' }[g.rsu] || g.rsu) : '';
      const value = parseFloat(g.rsn.replace(/,/g, ''));
      spoken = `${decimalToWords(g.rsn)}${unit ? ` ${unit}` : ''} ${value === 1 && !unit ? 'rupee' : 'rupees'}`;
    } else if (g.pct) spoken = `${decimalToWords(g.pct.replace(/\s?%/, ''))} percent`;
    else if (g.ord) spoken = ORDINALS[parseInt(g.ord, 10)] || g.ord;
    else if (g.sl) spoken = 'twenty-four seven';
    else if (g.frac) { const [a, b] = g.frac.split('/'); spoken = `${numberToWords(+a)} out of ${numberToWords(+b)}`; }
    else if (g.year) spoken = yearToWords(parseInt(g.year, 10));
    else if (g.num) spoken = decimalToWords(g.num);
    else if (g.acr) {
      if (AS_WORD.has(g.acr)) spoken = null;
      else {
        const plural = g.acr.endsWith('s');
        const core = plural ? g.acr.slice(0, -1) : g.acr;
        spoken = core.split('').join('-') + (plural ? 's' : '');
      }
    }
    if (!spoken) continue;
    if (/(^|[.?!]\s+|\n\s*)$/.test(src.slice(0, m.index))) spoken = spoken.charAt(0).toUpperCase() + spoken.slice(1);
    if (m.index > last) out.push({ text: src.slice(last, m.index) });
    out.push({ written: m[0], spoken });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out;
}

export const toSpoken = (text, marks) => spokenSegments(text, marks).map((s) => (s.spoken ?? s.text)).join('');

/** Checks a chapter's script text against the house rules. Returns plain-language warnings. */
export function lintScript(text, { chapter, rules } = {}) {
  const w = [];
  const t = String(text || '');
  if (!t.trim()) return w;
  if (/!/.test(t)) w.push('Contains an exclamation mark.');
  if (/\p{Extended_Pictographic}/u.test(t)) w.push('Contains an emoji.');
  if (/\.\.\.|…/.test(t)) w.push('Contains an ellipsis, which breaks sentence splitting.');
  if (/[;—–]/.test(t)) w.push('Contains a semicolon or a dash, which reads badly aloud.');
  if (/\b(?:e\.g\.|i\.e\.|etc\.|Rs\.)/.test(t)) w.push('Contains an abbreviation that ends in a full stop; write it out.');
  const head = t.split(/\s+/).slice(0, 40).join(' ');
  if (/\b(welcome|hello|hi everyone|hey guys|namaste|in this video|today we|today i)\b/i.test(head)) w.push('Opens like an introduction. Start on the problem.');
  if (/\b(subscribe|smash|like and share|hit the bell)\b/i.test(t)) w.push('Asks for a subscribe or a like. Remove it.');
  if (/\b(autopilot|runs by itself|run by itself|without people|assigns itself)\b/i.test(t)) w.push('Says the business runs by itself, which we never say.');
  const terms = (rules?.courseTerms || ['FMS', 'PMS', 'MIS', 'PISAT', 'Systems Master']).filter((x) => x && x.length > 2);
  const hit = terms.filter((x) => new RegExp(`\\b${escapeRx(x)}\\b`).test(t));
  if (hit.length) w.push(`Uses internal terms that must not be public: ${hit.join(', ')}.`);
  if (rules?.never) {
    const any = rules.never.filter((n) => n.scope === 'any' && n.phrase).map((n) => n.phrase);
    const bad = any.filter((p) => t.toLowerCase().includes(p.toLowerCase()));
    if (bad.length) w.push(`Uses phrases the brief bans: ${bad.join('; ')}.`);
  }
  if (Number(chapter) === 1) {
    const first = t.split(/\s+/).slice(0, 100).join(' ');
    if (!/(Rs|\d|hour|day|week|month|lakh|crore|percent|%)/i.test(first)) w.push('The first 30 seconds should state the cost of the problem; no cost appears in the first 100 words.');
  }
  return w;
}

// ------------------------------------------------------------------ a small schema check

/** Minimal JSON-schema check (type, required, properties, items, enum) for output supplied by the caller. */
export function validateAgainst(schema, value, at = '$') {
  const errors = [];
  if (!schema) return errors;
  const t = schema.type;
  const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
  if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${at} must be an object`];
    for (const k of schema.required || []) if (value[k] === undefined) errors.push(`${at}.${k} is required`);
    for (const [k, sub] of Object.entries(schema.properties || {})) if (value[k] !== undefined) errors.push(...validateAgainst(sub, value[k], `${at}.${k}`));
  } else if (t === 'array') {
    if (!Array.isArray(value)) return [`${at} must be an array`];
    value.forEach((v, i) => errors.push(...validateAgainst(schema.items, v, `${at}[${i}]`)));
  } else if (t === 'string') { if (typeof value !== 'string') errors.push(`${at} must be a string`); }
  else if (t === 'integer') { if (!isInt(value)) errors.push(`${at} must be an integer`); }
  else if (t === 'number') { if (typeof value !== 'number') errors.push(`${at} must be a number`); }
  else if (t === 'boolean') { if (typeof value !== 'boolean') errors.push(`${at} must be true or false`); }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at} must be one of ${schema.enum.join(', ')}`);
  return errors;
}

// ------------------------------------------------------------------ the bv runner

const HOME = os.homedir();
export const BV = path.join(HOME, '.claude', 'skills', 'brand-video', 'scripts', 'bv');
export const BV_SETUP_COMMAND = `${BV} setup`;

/** Whether the bv runner is there and `bv setup` has been run on this Mac. Nothing is executed. */
export function bvStatus() {
  const cache = process.env.BV_HOME || path.join(HOME, '.cache', 'brand-video');
  const runnerFound = fs.existsSync(BV);
  const venv = fs.existsSync(path.join(cache, 'venv', 'bin', 'python'));
  const playwright = fs.existsSync(path.join(cache, 'node', 'node_modules', 'playwright-core'));
  const chrome = fs.existsSync(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  const setupDone = venv && playwright;
  const ok = runnerFound && setupDone;
  let message = 'The bv runner and its setup are in place.';
  if (!runnerFound) message = `The brand-video runner was not found at ${BV}. Install the brand-video skill under ~/.claude/skills first.`;
  else if (!setupDone) message = `bv setup has not been run on this Mac. Run this once in a terminal: ${BV_SETUP_COMMAND}`;
  else if (!chrome) message = 'The runner is ready for stock search, but Google Chrome was not found, so bv check and bv render will fail. Install Chrome or set CHROME.';
  return { ok, runner: BV, runnerFound, setupDone, chrome, command: ok ? null : BV_SETUP_COMMAND, message };
}

const searchCache = new Map(); // query -> { at, results }

const cleanQuery = (q) => String(q || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

/** Runs `bv broll search "<words>"` through child_process and parses the id and title lines. */
export function bvSearch(query) {
  const q = cleanQuery(query);
  if (!q) return Promise.reject(Object.assign(new Error('Give one or two plain words to search for'), { status: 400 }));
  const hit = searchCache.get(q);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return Promise.resolve({ query: q, results: hit.results, cached: true });
  return new Promise((resolve, reject) => {
    execFile(BV, ['broll', 'search', q], { timeout: 90_000, maxBuffer: 4 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      const out = String(stdout || '');
      if (err && /bv setup/i.test(out + String(stderr || ''))) {
        return reject(Object.assign(new Error(`bv setup has not been run on this Mac. Run this once in a terminal: ${BV_SETUP_COMMAND}`), { status: 424, command: BV_SETUP_COMMAND }));
      }
      if (err && !out.trim()) {
        const timedOut = err.killed || err.signal === 'SIGTERM';
        return reject(Object.assign(new Error(timedOut ? 'The stock search timed out after 90 seconds. Check the internet connection and try again.' : `bv broll search failed: ${String(stderr || err.message).trim().slice(0, 300)}`), { status: 502 }));
      }
      const results = [];
      for (const line of out.split('\n')) {
        const m = /^\s*(\d{3,9})\s{2,}(.+?)\s*$/.exec(line);
        if (!m) continue;
        const id = m[1]; const title = m[2];
        results.push({
          id, title,
          thumb: `https://assets.mixkit.co/videos/${id}/${id}-thumb-360-0.jpg`,
          url: `https://mixkit.co/free-stock-video/${slugify(title, 120)}-${id}/`,
        });
      }
      searchCache.set(q, { at: Date.now(), results });
      resolve({ query: q, results, cached: false, note: results.length ? null : out.trim().slice(0, 200) || null });
    });
  });
}

// ------------------------------------------------------------------ chapters and timeline

/** Chapter start and end times: from the planned scenes when every chapter has some, else from the outline minutes. */
export function chapterTimeline(video) {
  const outline = video.outline || [];
  const scenes = video.scenes || [];
  const nums = outline.length ? outline.map((c) => c.n) : [...new Set(scenes.map((s) => s.chapter))].sort((a, b) => a - b);
  const fromScenes = scenes.length && nums.length && nums.every((n) => scenes.some((s) => s.chapter === n));
  let t = 0;
  return nums.map((n) => {
    const ch = outline.find((c) => c.n === n) || {};
    const secs = fromScenes
      ? scenes.filter((s) => s.chapter === n).reduce((a, s) => a + (Number(s.seconds) || 0), 0)
      : (Number(ch.minutes) || 0) * 60;
    const row = { n, title: ch.title || `Chapter ${n}`, start: t, end: t + secs, seconds: secs, source: fromScenes ? 'scenes' : 'outline' };
    t += secs;
    return row;
  });
}

const totalSeconds = (video) => { const tl = chapterTimeline(video); return tl.length ? tl[tl.length - 1].end : 0; };

// ------------------------------------------------------------------ YouTube text

const WEBSITE_PLACEHOLDER = '[add the website link before publishing]';

function descriptionFor(video, settings) {
  const intro = (video.descriptionIntro || video.pis?.problem || video.title || '').replace(/\s+/g, ' ').trim().slice(0, 150);
  const tl = chapterTimeline(video);
  const long = tl.length && tl[tl.length - 1].end >= 3600;
  const lines = tl.map((c) => `${fmtClock(c.start, long)} ${c.title}`);
  const site = settings?.website || WEBSITE_PLACEHOLDER;
  return [intro, '', 'Chapters', ...lines, '', `Book the 30-minute call: ${site}`].join('\n').replace(/\n{3,}/g, '\n\n');
}

function youtubeInfo(video, piece, settings) {
  const yt = piece?.renditions?.yt || {};
  const title = (video.final?.title ?? yt.title ?? video.title ?? '').trim();
  const description = video.final?.description ?? (yt.description || descriptionFor(video, settings));
  const tl = chapterTimeline(video);
  const long = tl.length && tl[tl.length - 1].end >= 3600;
  const chapters = tl.map((c) => ({ n: c.n, title: c.title, start: c.start, stamp: fmtClock(c.start, long) }));
  const total = tl.length ? tl[tl.length - 1].end : 0;
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });
  add('title-length', 'Title under 70 characters', title.length === 0 ? 'fail' : title.length < 70 ? 'pass' : title.length <= 100 ? 'warn' : 'fail',
    `${title.length} characters${title.length >= 70 ? '; keep it under 70 so it is not cut off' : ''}`);
  add('title-clean', 'Title has no exclamation mark or emoji', /!|\p{Extended_Pictographic}/u.test(title) ? 'fail' : 'pass', null);
  const firstLine = description.split('\n')[0] || '';
  add('desc-start', 'First 150 characters name the system and the outcome', firstLine.length >= 40 && firstLine.length <= 150 ? 'pass' : 'warn',
    `${firstLine.length} characters in the first line`);
  add('desc-length', 'Description within 5,000 characters', description.length <= 5000 ? 'pass' : 'fail', `${description.length} characters`);
  const starts = chapters.map((c) => c.start);
  const ascending = starts.every((s, i) => i === 0 || s >= starts[i - 1] + 10);
  add('chapters', 'Chapters: six or more, first at 00:00, each at least 10 seconds', chapters.length >= 6 && starts[0] === 0 && ascending ? 'pass' : chapters.length >= 3 && starts[0] === 0 && ascending ? 'warn' : 'fail',
    `${chapters.length} chapters`);
  const mins = total / 60;
  add('length', 'Length 30 to 45 minutes', total && mins >= 30 && mins <= 45 ? 'pass' : 'warn',
    total ? `${(Math.round(mins * 10) / 10)} minutes (${chapters.length ? tl[0].source : 'outline'} timing)` : 'No timing yet');
  add('website', 'Website link in the description', description.includes(WEBSITE_PLACEHOLDER) || !/https?:\/\/|www\./i.test(description) ? 'warn' : 'pass',
    description.includes(WEBSITE_PLACEHOLDER) ? 'The link is a placeholder; set settings.website or edit the description' : null);
  const shorts = (video.shortsPieceIds || []).length;
  add('shorts', 'Two to four Shorts made', shorts >= 2 && shorts <= 4 ? 'pass' : 'warn', `${shorts} made`);
  const faceCh = new Set((video.scenes || []).filter((s) => s.kind === 'face').map((s) => s.chapter));
  const missing = FACE_CHAPTERS.filter((n) => !faceCh.has(n));
  add('face', 'Three face moments: problem, what changed, close', (video.scenes || []).length ? (missing.length ? 'warn' : 'pass') : 'warn',
    (video.scenes || []).length ? (missing.length ? `No face scene in chapter ${missing.join(', ')}` : 'Face scenes in chapters 1, 5 and 6') : 'No scenes planned yet');
  return { title, description, chapters, totalSeconds: total, checks, pieceId: piece?.id || null };
}

// ------------------------------------------------------------------ brand.json from the tokens

function readTokens(root) {
  const css = fs.readFileSync(path.join(root, 'app', 'css', 'tokens.css'), 'utf8');
  const block = /:root\s*{([\s\S]*?)}/.exec(css)?.[1] || '';
  const vars = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) vars[m[1]] = m[2].trim();
  const resolve = (v, depth = 0) => (depth > 5 ? v : String(v).replace(/var\(--([a-z0-9-]+)\)/gi, (_, k) => (vars[k] ? resolve(vars[k], depth + 1) : '')));
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, resolve(v)]));
}

function readFontFaces(root) {
  const faces = [];
  for (const file of ['tokens.css', 'fonts.css']) {
    const css = fs.readFileSync(path.join(root, 'app', 'css', file), 'utf8');
    for (const m of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
      const body = m[1];
      const family = /font-family\s*:\s*'([^']+)'/.exec(body)?.[1];
      const weight = /font-weight\s*:\s*([^;]+);/.exec(body)?.[1]?.trim();
      const src = /url\('([^']+)'\)/.exec(body)?.[1];
      const range = /unicode-range\s*:\s*([^;]+);/.exec(body)?.[1]?.trim();
      if (!family || !src) continue;
      faces.push({ family, weight: Number(weight) || weight, abs: path.resolve(root, 'app', 'css', src), range });
    }
  }
  return faces;
}

/** brand.json as references/brand-input.md describes it, paths relative to the project folder. */
export function buildBrandJson(root, projectDir) {
  const t = readTokens(root);
  const rel = (abs) => path.relative(projectDir, abs).split(path.sep).join('/');
  const colors = {
    brand: t.navy, deep: t['navy-deep'], accent: t.accent, accentInk: t['accent-ink'], accentTint: t['accent-tint'],
    ink: t.text, ink2: t['text-secondary'], ink3: t['text-muted'], onDark: t.white,
    surface: t.surface, border: t.border, warnBg: t['warn-bg'], warnInk: t['warn-text'], warnBd: t.warn, infoInk: t['navy-mid'],
  };
  for (const k of Object.keys(colors)) if (!colors[k]) delete colors[k];
  const fonts = readFontFaces(root)
    .filter((f) => fs.existsSync(f.abs))
    .map((f) => ({ family: f.family, file: rel(f.abs), weight: f.weight, ...(f.range ? { unicodeRange: f.range } : {}) }));
  return {
    name: 'Venture Drafters',
    locale: 'en-IN',
    currency: 'Rs',
    heading: 'Gilmer', body: 'Plus Jakarta Sans', mono: 'JetBrains Mono', currencyFont: 'Plus Jakarta Sans',
    fonts,
    colors,
    logo: {
      onLight: rel(path.join(root, 'app', 'img', 'vd-wordmark-colour.svg')),
      onDark: rel(path.join(root, 'app', 'img', 'vd-wordmark-reverse.svg')),
      clearSpace: 0.5,
      rules: 'Venture Drafters logo rules. Use the official word logo only: the colour file on light backgrounds, the reversed file on navy. ' +
        'The logo is navy and green only, always two colours; the green arrow is never dropped and there is no one-colour version. ' +
        'Do not redraw, stretch, rotate, skew or recolour it, and add no shadow or outline. Clear space is half the logo height on all four sides. ' +
        'Never render the word logo below 20 px high; below that use the Vd monogram. Approved backgrounds are white, the light surface and navy.',
    },
  };
}

// ------------------------------------------------------------------ the project's pieces and files

const projectDir = (ctx, video) => path.join(ctx.store.root, 'video', path.basename(video.id));
const relProject = (video) => `video/${path.basename(video.id)}`;

function need(ctx) {
  const video = ctx.store.get('videos', ctx.params.id);
  if (!video) throw new ctx.HttpError(404, 'Video project not found');
  return video;
}

function laterStep(a, b) {
  return STEPS.indexOf(b) > STEPS.indexOf(a) ? b : a;
}

async function makeVersion(ctx, piece, changeNote) {
  const { check, measure, ...snapshot } = piece;
  const n = ctx.store.list('versions', (v) => v.pieceId === piece.id).length + 1;
  const version = { id: ctx.store.nextId('vr'), pieceId: piece.id, n, snapshot, by: ctx.by || null, at: new Date().toISOString(), changeNote };
  await ctx.store.put('versions', version);
  return version;
}

const TEXT_FIELDS = ['hook', 'pis', 'renditions', 'script', 'slides', 'notes'];

/** Patch the linked piece; makes a version when its text changed. Approved or posted pieces are left alone. */
async function syncPiece(ctx, video, patch, note) {
  if (!video.pieceId) return null;
  const piece = ctx.store.get('pieces', video.pieceId);
  if (!piece) return null;
  if (['approved', 'scheduled', 'posted', 'measured'].includes(piece.status)) return piece;
  const before = piece;
  const next = { ...piece, ...patch };
  if (patch.renditions) next.renditions = { ...(piece.renditions || {}), ...patch.renditions };
  const stored = await ctx.store.put('pieces', next);
  if (TEXT_FIELDS.some((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(stored[f] ?? null))) await makeVersion(ctx, stored, note || 'Updated from the video project');
  return stored;
}

const shortHook = (title, max = 8) => String(title || '').split(/\s+/).slice(0, max).join(' ').replace(/[,:;.-]+$/, '');

// ------------------------------------------------------------------ AI step plumbing

async function opContext(ctx) { return ctx.ai.buildCtx({ by: ctx.by }); }

async function dryRun(ctx, opName, input) {
  const op = await ctx.ai.loadOp(opName);
  const prompt = op.buildPrompt(input, await opContext(ctx));
  return { dryRun: true, op: opName, system: prompt.system, user: prompt.user, schema: op.schema };
}

/** Runs an op, or applies `supplied` output through the same schema check and postProcess. */
async function runOp(ctx, opName, input, supplied) {
  const aiCtx = await opContext(ctx);
  if (supplied === undefined || supplied === null) {
    const r = await ctx.ai.run(opName, input, aiCtx);
    return { output: r.output, usage: r.usage || null, mode: r.mode, ms: r.ms };
  }
  const op = await ctx.ai.loadOp(opName);
  const errors = validateAgainst(op.schema, supplied);
  if (errors.length) throw new ctx.HttpError(400, `The supplied output does not match the ${opName} schema: ${errors.slice(0, 3).join('; ')}`, errors);
  const output = typeof op.postProcess === 'function' ? (op.postProcess(supplied, input, aiCtx) ?? supplied) : supplied;
  return { output, usage: null, mode: 'supplied', ms: 0 };
}

const solutionFor = (ctx, video) => (video.solutionId ? ctx.store.get('solutions', video.solutionId) : null);

// ------------------------------------------------------------------ scenes

const sceneKey = (s) => s.uid || `p${s.part}-${s.n}`;

/** Renumbers scenes 1..n in order and remaps footage and own-clip scene numbers through each scene's uid. */
function renumber(video, scenes) {
  const oldByN = new Map((video.scenes || []).map((s) => [s.n, s.uid]));
  const ordered = scenes.map((s, i) => ({ ...s, n: i + 1 }));
  const newByUid = new Map(ordered.map((s) => [s.uid, s.n]));
  const remap = (rows) => (rows || []).map((r) => {
    const uid = oldByN.get(r.scene);
    const n = uid ? newByUid.get(uid) : null;
    return n ? { ...r, scene: n } : null;
  }).filter(Boolean);
  return { scenes: ordered, footage: remap(video.footage), ownClips: (video.ownClips || []).map((c) => {
    if (!c.scene) return c;
    const uid = oldByN.get(c.scene); const n = uid ? newByUid.get(uid) : null;
    return { ...c, scene: n || null };
  }) };
}

function scriptMatchesScenes(video) {
  const a = normWords(parseScript(video.script).map((c) => c.text).join(' ')).join(' ');
  const b = normWords((video.scenes || []).map((s) => s.say).join(' ')).join(' ');
  return a === b;
}

// ------------------------------------------------------------------ writing the hand-off

/** Takes an own clip off a scene and gives back the kind the scene had before the clip made it a face scene. */
function unmapScene(s) {
  const { kindBefore, ...rest } = s;
  return { ...rest, clipPath: null, start: 0, kind: kindBefore || s.kind };
}

function chapterOf(video, n) { return (video.outline || []).find((c) => c.n === n) || {}; }

function allMarks(video) {
  return Object.values(video.scriptMarks || {}).flat();
}

function sceneRows(video) {
  const marks = allMarks(video);
  return (video.scenes || []).map((s) => {
    const lines = splitSentences(s.say);
    return {
      n: s.n, id: `s${pad(s.n, 3)}`, chapter: s.chapter, part: s.part ?? null,
      kind: s.kind, say: lines, speak: lines.map((l) => toSpoken(l, marks)),
      sees: s.sees || '', query: s.kind === 'broll' ? (s.query || '') : '', seconds: s.seconds,
      clip: s.clipPath ? { file: s.clipPath, start: s.start || 0 } : null,
      own: Boolean(s.clipPath && /^clips\//.test(String(s.clipPath))),
    };
  });
}

const TONE_BY_CHAPTER = { 1: 'dark', 2: 'dark', 3: 'dark', 4: 'light', 5: 'light', 6: 'brand' };

function stockFile(id) { return `${id}.mp4`; }

function footageFor(video, sceneN) { return (video.footage || []).find((f) => f.scene === sceneN) || null; }

function sceneFileName(s) { return `${s.kind}-${pad(s.n, 3)}.mp4`; }

function footageListMd(video) {
  const tl = chapterTimeline(video);
  const out = [];
  out.push(`# Footage to collect - ${video.title}`);
  out.push('');
  out.push('Drop each clip into assets/broll/ with the file name shown. Phone clips are fine: horizontal, steady, natural light, a few seconds longer than the minimum. If a clip cannot be got, skip it: that scene keeps its stock or designed version.');
  out.push('');
  out.push('Stock clips already chosen are listed with their Mixkit id; replace them with your own footage by using the same scene in scenes.js (window.BROLL).');
  const letters = 'ABCDEFGHIJ';
  for (const c of tl) {
    const scenes = (video.scenes || []).filter((s) => s.chapter === c.n && s.kind !== 'card');
    out.push('');
    out.push(`## ${letters[c.n - 1] || c.n}. ${c.title} (${fmtClock(c.start)}-${fmtClock(c.end)})`);
    out.push('');
    if (!scenes.length) { out.push('No footage scenes in this chapter yet.'); continue; }
    out.push('| File | What it shows | Used in | Min length |');
    out.push('|---|---|---|---|');
    for (const s of scenes) {
      const f = footageFor(video, s.n);
      let file; let what = (s.sees || '').replace(/\|/g, '/');
      if (s.clipPath && /^clips\//.test(s.clipPath)) { file = `${path.basename(s.clipPath)} (recorded)`; }
      else if (s.kind === 'broll' && f?.ids?.length) { file = stockFile(f.ids[0]); what += ' (stock placeholder, replace with your own if you can)'; }
      else file = sceneFileName(s);
      if (s.kind === 'broll' && s.query && !(f?.ids?.length)) what += ` Stock search words: ${s.query}.`;
      const used = `"${String(s.say).split(/\s+/).slice(0, 8).join(' ')}${wordCount(s.say) > 8 ? '...' : ''}"`.replace(/\|/g, '/');
      out.push(`| ${file} | ${s.kind === 'face' ? 'To camera. ' : s.kind === 'screen' ? 'Screen recording of the masked copy. ' : ''}${what.trim()} | ${used} | ${Math.ceil(Number(s.seconds) || 0) + 2} s |`);
    }
  }
  return out.join('\n') + '\n';
}

function shotPlanMd(video) {
  const out = [];
  out.push(`# Shot plan - ${video.title}`);
  out.push('');
  out.push('For the person filming. The story is the same as the script; this file says what to film, and what stays a designed graphic.');
  out.push('');
  out.push('## Shoot rules');
  out.push('');
  out.push('- 4K or 1080p, horizontal, steady, natural light.');
  out.push('- Record a few seconds before and after every line.');
  out.push('- Everyone on camera has agreed to appear. Show no real client names, lender names, documents or numbers on camera.');
  out.push('- Screen recordings are made on the masked copy only. Check every frame for real names before it goes in.');
  out.push('- Keep the cursor slow and the window at full screen; pause for a second on each result.');
  const face = (video.scenes || []).filter((s) => s.kind === 'face');
  out.push('');
  out.push('## To camera (the three face moments)');
  out.push('');
  for (const n of FACE_CHAPTERS) {
    const ch = chapterOf(video, n);
    const scenes = face.filter((s) => s.chapter === n);
    out.push(`### Chapter ${n}. ${ch.title || ''}`.trimEnd());
    out.push('');
    if ((ch.toCamera || []).length) { out.push('Questions to answer to camera:'); for (const q of ch.toCamera) out.push(`- ${q}`); out.push(''); }
    if (!scenes.length) out.push('No face scene is planned in this chapter yet.');
    for (const s of scenes) {
      const clip = s.clipPath && /^clips\//.test(s.clipPath) ? ` Recorded: ${path.basename(s.clipPath)}.` : '';
      out.push(`- Scene ${s.n} (${Math.ceil(s.seconds)} s): say "${s.say}" ${s.sees ? `Framing: ${s.sees}` : 'Medium close-up, eye level, natural light.'}${clip}`);
    }
    out.push('');
  }
  const screen = (video.scenes || []).filter((s) => s.kind === 'screen');
  out.push('## Screen recordings (the build)');
  out.push('');
  if (!screen.length) out.push('No screen scenes are planned yet.');
  for (const s of screen) {
    const clip = s.clipPath && /^clips\//.test(s.clipPath) ? ` Recorded: ${path.basename(s.clipPath)}.` : '';
    out.push(`- Scene ${s.n} (${Math.ceil(s.seconds)} s): ${s.sees || s.say}${clip}`);
  }
  out.push('');
  const cards = (video.scenes || []).filter((s) => s.kind === 'card');
  out.push('## Stays as a designed graphic');
  out.push('');
  out.push(`${plural(cards.length, 'scene is a card', 'scenes are cards')} (numbers, definitions, chapter titles). Nothing is filmed for ${cards.length === 1 ? 'it' : 'them'}; ${cards.length === 1 ? 'it is' : 'they are'} designed in the brand-video pipeline from the script words.`);
  const broll = (video.scenes || []).filter((s) => s.kind === 'broll');
  out.push('');
  out.push('## B-roll you could film instead of stock');
  out.push('');
  out.push(`${plural(broll.length, 'scene uses a stock placeholder', 'scenes use stock placeholders')}. If you can film any of them yourself, the footage list has the file name and minimum length for each.`);
  return out.join('\n') + '\n';
}

function scenesMdLines(video) {
  // script.md: one line per planned scene (spoken text only, no headings), else one line per paragraph.
  if ((video.scenes || []).length && scriptMatchesScenes(video)) return video.scenes.map((s) => String(s.say).trim());
  const lines = [];
  for (const ch of parseScript(video.script)) for (const p of ch.text.split('\n')) if (p.trim()) lines.push(p.trim());
  return lines;
}

function chaptersMd(video) {
  const tl = chapterTimeline(video);
  const out = [`# ${video.title}`, '', 'Chapter structure and the script with its headings. The pipeline reads script.md; this file is for people.', ''];
  for (const c of tl) {
    const ch = parseScript(video.script).find((x) => x.n === c.n);
    out.push(`## ${c.n}. ${c.title} (${fmtClock(c.start)}-${fmtClock(c.end)})`);
    out.push('');
    out.push(ch?.text || '(not written yet)');
    out.push('');
  }
  return out.join('\n');
}

function claudePrompt(video, abs, info) {
  const mins = Math.max(1, Math.round(info.total / 60));
  const render = fmtLong((info.total * 30) / 5);
  return [
    `Use the brand-video skill on the folder ${abs}: the script is script.md, brand.json is written, scenes-plan.json lists the scenes (id, chapter, kind, say, speak, sees, stock search words, seconds, and the clip chosen so far), footage-list.md and shot-plan.md say what is filmed by hand, and my own clips are already in assets/broll/.`,
    '',
    `This is a ${plural(mins, 'minute', 'minute')}-long case study in six chapters (chapters/ holds one script file per chapter). Run bv setup only if bv check says it is needed. Run bv new on the folder, then bv check, and design the scenes chapter by chapter, running bv check after each chapter and reading the stills in build/shots/.`,
    '',
    'Rules for this film: on-screen text is the script word for word, and the spoken forms are in scenes-plan.json as speak. Scene kinds mean: broll = footage behind the words; screen = my recording of the masked copy, or a designed system screen with demo data and the DEMO tag; face = my own clip to camera; card = a designed card with script words only. Use the official Venture Drafters logo files only, per the rules in brand.json. Never name a client, lender or staff member.',
    '',
    `Stop after bv vo, give me voice/elevenlabs.md, and wait for voice/vo-original.mp3 before running bv voice, bv music, bv mix, bv render and bv verify. Run bv render in the background: at about five frames a second this film takes about ${render}, so tell me before you start it.`,
  ].join('\n');
}

function handoffMd(video, abs, info) {
  const q = (p) => `"${p}"`;
  const renderTime = fmtLong((info.total * 30) / 5);
  const longFilm = info.total > 15 * 60;
  const when = new Date(info.at).toLocaleString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const stock = [...new Set((video.footage || []).flatMap((f) => f.ids || []))];
  const out = [];
  out.push(`# Hand-off: ${video.title}`);
  out.push('');
  out.push(`Written ${when} IST from Venture Drafters Studio. Project ${video.id}. Folder: ${abs}`);
  out.push('');
  out.push('## What is in this folder');
  out.push('');
  out.push('| File | What it is |');
  out.push('|---|---|');
  out.push('| script.md | The spoken script, one line per scene, no headings. The pipeline uses it word for word. |');
  out.push('| script-chapters.md | The same script with chapter headings and timecodes, for people. |');
  out.push('| chapters/ | One script file per chapter, if you prefer to build the film chapter by chapter. |');
  out.push('| brand.json | Venture Drafters tokens, fonts and the official logo files, in the shape the pipeline expects. |');
  out.push('| scenes-plan.json | Every planned scene: chapter, kind, say, speak (how it is read aloud), sees, stock search words, seconds, clip. |');
  out.push('| footage-list.md | What to collect, by chapter, with file names and minimum lengths. |');
  out.push('| shot-plan.md | What to film and how, the three face moments and the screen recordings. |');
  out.push('| clips/ | Your own clips as uploaded. Copies are in assets/broll/ under the same names. |');
  out.push('| voice/ | The recorded voice, if uploaded in Studio. |');
  out.push('');
  out.push('## Commands, in order');
  out.push('');
  out.push('Run these in a terminal. BV is the runner; every command takes the project folder.');
  out.push('');
  out.push('```bash');
  out.push(`BV=${BV}`);
  out.push(`P=${q(abs)}`);
  out.push('');
  out.push('$BV setup                                  # once per machine; skip if it has been run');
  out.push('$BV new "$P" "$P/brand.json" "$P/script.md" # scaffold: copies fonts and logos, one starter scene per script line');
  out.push('$BV check "$P"                             # text equals script, logo rules, stills in build/shots/');
  out.push(stock.length ? `$BV broll get "$P" ${stock.join(' ')}   # downloads the stock clips chosen in Studio` : '# $BV broll get "$P" <ids>                  # no stock clip has been chosen in Studio yet');
  out.push('$BV check "$P"                             # again, after the footage is mapped');
  out.push('$BV vo "$P"                                # writes voice/elevenlabs.md; add speak forms where it flags a line');
  out.push('#   record or generate the voice, then save it as "$P/voice/vo-original.mp3"');
  out.push('$BV voice "$P"                             # cuts the picture to the voice (add --tempo 1.08 if the read is slow)');
  out.push('$BV music "$P"                             # needs music/cues.json');
  out.push('$BV mix "$P"');
  out.push('$BV render "$P"                            # run in the background');
  out.push('$BV verify "$P"');
  out.push('```');
  out.push('');
  out.push('## Ready-to-paste Claude Code prompt');
  out.push('');
  out.push('Open Claude Code, then paste this:');
  out.push('');
  out.push('```text');
  out.push(claudePrompt(video, abs, info));
  out.push('```');
  out.push('');
  out.push('## Timing');
  out.push('');
  out.push(`- Planned length: ${fmtClock(info.total, info.total >= 3600)} across ${info.sceneCount} scenes.`);
  out.push(`- The renderer runs at about five frames a second, and the video is 30 frames a second. At that rate this film takes about ${renderTime} to render.`);
  if (longFilm) out.push('- The pipeline was built for short films. A film this long has not been run through it, so build it chapter by chapter (the chapters/ folder has one script per chapter) and render one chapter first to check the settings.');
  out.push('- The voice cut (bv voice) re-times every scene to the recording, so the planned seconds are only a guide until the voice exists.');
  out.push('');
  out.push('## Chapter timestamps for the YouTube description');
  out.push('');
  for (const c of info.chapters) out.push(`${c.stamp} ${c.title}`);
  out.push('');
  out.push('## What is still open');
  out.push('');
  if (info.warnings.length) for (const w of info.warnings) out.push(`- ${w}`); else out.push('- Nothing was flagged at the time of the hand-off.');
  out.push('');
  out.push('## Notes');
  out.push('');
  out.push('- Re-running the hand-off in Studio rewrites script.md, brand.json, scenes-plan.json, footage-list.md, shot-plan.md and this file. It never touches scenes.js or anything bv has built.');
  out.push('- The Venture Drafters logo is the official file only, with clear space of half its height. brand.json carries the full rule.');
  out.push('- ElevenLabs limits the length of one generation. Generate the voice chapter by chapter, join the files in order, and save the result as voice/vo-original.mp3.');
  return out.join('\n') + '\n';
}

// ------------------------------------------------------------------ the routes

// The four video ops answer POST /api/ai/<op> as the core does, and also honour
// { dryRun: true }: they return { system, user, schema } without calling Claude.
const aiOpRoutes = ['caseStudyOutline', 'videoScript', 'scenePlan', 'shortsCuts'].map((opName) => ({
  method: 'POST', path: `/api/ai/${opName}`,
  handler: async (ctx) => {
    const body = ctx.body || {};
    if (body.dryRun) { const { dryRun: _d, ...input } = body; return dryRun(ctx, opName, input); }
    return ctx.ai.run(opName, body, ctx.ai.buildCtx({ by: ctx.by }));
  },
}));

export const routes = [
  ...aiOpRoutes,
  // ---- runner status and the spoken form (no project needed)
  { method: 'GET', path: '/api/video/bv', handler: async () => bvStatus() },

  {
    method: 'POST', path: '/api/video/spoken',
    handler: async (ctx) => {
      const b = ctx.body || {};
      const text = String(b.text || '');
      const marks = Array.isArray(b.marks) ? b.marks : [];
      const segments = spokenSegments(text, marks);
      const words = wordCount(toSpoken(text, marks));
      return {
        segments, spoken: segments.map((s) => s.spoken ?? s.text).join(''), words: wordCount(text), spokenWords: words,
        minutes: Math.round((wordCount(text) / WPM) * 10) / 10, warnings: lintScript(text, { chapter: b.chapter, rules: ctx.rules() }),
      };
    },
  },

  // ---- create
  {
    method: 'POST', path: '/api/video',
    handler: async (ctx) => {
      const b = ctx.body || {};
      const store = ctx.store;
      let piece = null; let solution = null;
      if (b.pieceId) {
        piece = store.get('pieces', String(b.pieceId));
        if (!piece) throw new ctx.HttpError(404, 'Piece not found');
        if (piece.type !== 'youtube-long') throw new ctx.HttpError(400, 'Only a youtube-long piece can start a video project');
        if (piece.videoId && store.get('videos', piece.videoId)) throw new ctx.HttpError(409, `That piece already has a video project (${piece.videoId})`);
      }
      if (b.solutionId) {
        solution = store.get('solutions', String(b.solutionId));
        if (!solution) throw new ctx.HttpError(404, 'Solution not found');
      }
      const subject = String(b.subject || '').trim();
      if (!piece && !solution && !subject) throw new ctx.HttpError(400, 'Choose a solution, give a subject, or pick a youtube-long piece');
      const title = String(b.title || '').trim()
        || (piece && (piece.renditions?.yt?.title || piece.hook))
        || (solution ? `Case study: ${solution.publicName}` : `Case study: ${subject}`);
      const id = store.nextId('vd');
      const video = {
        id, pieceId: piece?.id || null, title, titleAuto: !b.title && !piece, solutionId: solution?.id || piece?.solutionId || null,
        subject: subject || null, notes: String(b.notes || '').trim(), targetMinutes: clamp(parseInt(b.targetMinutes, 10) || 38, 30, 45),
        status: 'outline', outline: [], script: '', scriptMarks: {}, scenes: [], footage: [], ownClips: [],
        bvProject: null, shortsPieceIds: [], by: ctx.by || null,
      };
      if (!piece) {
        piece = await store.put('pieces', {
          id: store.nextId('pc'), type: 'youtube-long', pillar: 'glimpse', status: 'idea', hook: shortHook(title), videoId: id,
          pis: { problem: '', impact: '', solution: [], close: '' },
          renditions: { yt: { title, description: '', tags: [] } }, targets: ['yt'], tags: ['case-study'], by: ctx.by || null,
        });
        await makeVersion(ctx, piece, 'Created with the video project');
      } else {
        piece = await store.patch('pieces', piece.id, { videoId: id });
      }
      video.pieceId = piece.id;
      const stored = await store.put('videos', video);
      await store.log(ctx.by, 'video.create', { id, pieceId: piece.id });
      ctx.res.statusCode = 201;
      return { video: stored, piece };
    },
  },

  // ---- outline
  {
    method: 'POST', path: '/api/video/:id/outline',
    handler: async (ctx) => {
      const video = need(ctx);
      const b = ctx.body || {};
      const brief = {};
      if (b.solutionId !== undefined) brief.solutionId = b.solutionId || null;
      if (b.subject !== undefined) brief.subject = String(b.subject || '').trim() || null;
      if (b.notes !== undefined) brief.notes = String(b.notes || '');
      if (b.targetMinutes !== undefined) brief.targetMinutes = clamp(parseInt(b.targetMinutes, 10) || 38, 30, 45);
      const merged = { ...video, ...brief };
      if (brief.solutionId && !ctx.store.get('solutions', brief.solutionId)) throw new ctx.HttpError(404, 'Solution not found');
      const input = { solutionId: merged.solutionId, subject: merged.subject, notes: merged.notes, targetMinutes: merged.targetMinutes };
      if (b.dryRun) return dryRun(ctx, 'caseStudyOutline', input);
      const r = await runOp(ctx, 'caseStudyOutline', input, b.output);
      const o = r.output;
      const patch = {
        ...brief, outline: o.outline, hook: o.hook, openingLine: o.openingLine, descriptionIntro: o.descriptionIntro,
        pis: o.pis, tags: o.tags || [], suggestedTitle: o.title || null,
        // a fresh outline invalidates what was built from the old one only when the chapter count changes
      };
      if (video.titleAuto !== false && o.title) patch.title = o.title;
      patch.status = laterStep(video.status, 'script');
      const stored = await ctx.store.patch('videos', video.id, patch);
      const piece = await syncPiece(ctx, stored, {
        hook: o.hook, pis: o.pis, status: 'draft',
        renditions: { yt: { title: stored.title, description: ctx.store.get('pieces', video.pieceId)?.renditions?.yt?.description || '', tags: o.tags || [] } },
      }, 'Outline drafted in the video project');
      await ctx.store.log(ctx.by, 'video.outline', { id: video.id, mode: r.mode });
      return { video: stored, piece, warnings: o.warnings || [], mode: r.mode, usage: r.usage };
    },
  },

  // ---- script, chapter by chapter
  {
    method: 'POST', path: '/api/video/:id/script',
    handler: async (ctx) => {
      let video = need(ctx);
      const b = ctx.body || {};
      if (!(video.outline || []).length) throw new ctx.HttpError(409, 'Draft the outline first');
      const wanted = b.chapter !== undefined && b.chapter !== null ? [parseInt(b.chapter, 10)] : video.outline.map((c) => c.n);
      for (const n of wanted) if (!video.outline.some((c) => c.n === n)) throw new ctx.HttpError(400, `The outline has no chapter ${n}`);
      const results = [];
      for (const n of wanted) {
        const chapters = parseScript(video.script);
        const prev = chapters.find((c) => c.n === n - 1);
        const input = {
          title: video.title, solutionId: video.solutionId, subject: video.subject, notes: video.notes,
          outline: video.outline, chapter: n, openingLine: video.openingLine || '', pis: video.pis || null,
          previousTail: prev ? prev.text.split(/\s+/).slice(-120).join(' ') : '',
        };
        if (b.dryRun) return dryRun(ctx, 'videoScript', input);
        const r = await runOp(ctx, 'videoScript', input, b.output);
        const o = r.output;
        const ch = video.outline.find((c) => c.n === n);
        const next = chapters.filter((c) => c.n !== n);
        next.push({ n, title: ch.title, text: o.text });
        // titles always follow the outline
        const joined = joinScript(next.map((c) => ({ ...c, title: (video.outline.find((x) => x.n === c.n) || {}).title || c.title })));
        const marks = { ...(video.scriptMarks || {}), [n]: o.marks || [] };
        const patch = { script: joined, scriptMarks: marks };
        const have = new Set(parseScript(joined).filter((c) => c.text).map((c) => c.n));
        if (video.outline.every((c) => have.has(c.n))) patch.status = laterStep(video.status, 'scenes'); else patch.status = laterStep(video.status, 'script');
        video = await ctx.store.patch('videos', video.id, patch);
        results.push({ chapter: n, words: o.wordCount, minutes: o.estimatedMinutes, warnings: o.warnings || [], mode: r.mode });
      }
      await ctx.store.log(ctx.by, 'video.script', { id: video.id, chapters: wanted });
      return { video, results };
    },
  },

  // ---- scenes, part by part
  {
    method: 'GET', path: '/api/video/:id/chunks',
    handler: async (ctx) => {
      const video = need(ctx);
      const chunks = scriptChunks(video.script);
      return {
        parts: chunks.map((c) => ({ part: c.part, chapter: c.chapter, words: c.words, sentences: c.sentences.length, planned: (video.scenes || []).some((s) => s.part === c.part) })),
        stale: (video.scenes || []).length > 0 && !scriptMatchesScenes(video),
      };
    },
  },
  {
    method: 'POST', path: '/api/video/:id/scenes',
    handler: async (ctx) => {
      let video = need(ctx);
      const b = ctx.body || {};
      const chunks = scriptChunks(video.script);
      if (!chunks.length) throw new ctx.HttpError(409, 'Write the script first');
      const wanted = b.part !== undefined && b.part !== null ? [parseInt(b.part, 10)] : chunks.map((c) => c.part);
      const results = [];
      for (const partN of wanted) {
        const chunk = chunks.find((c) => c.part === partN);
        if (!chunk) throw new ctx.HttpError(400, `The script has no part ${partN}`);
        const ch = chapterOf(video, chunk.chapter);
        const faceUsed = (video.scenes || []).filter((s) => s.chapter === chunk.chapter && s.part !== partN && s.kind === 'face').length;
        const input = {
          part: chunk.part, chapter: chunk.chapter, chapterTitle: ch.title || '', sentences: chunk.sentences,
          toCamera: ch.toCamera || [], allowFace: FACE_CHAPTERS.includes(chunk.chapter), faceUsed, first: chunk.part === 1,
        };
        if (b.dryRun) return dryRun(ctx, 'scenePlan', input);
        const r = await runOp(ctx, 'scenePlan', input, b.output);
        const made = r.output.scenes.map((s, i) => ({
          uid: `p${partN}-${i + 1}-${Date.now().toString(36)}`, part: partN, chapter: chunk.chapter,
          say: s.say, sees: s.sees, kind: s.kind, query: s.query || '', seconds: s.seconds, clipPath: null, start: 0,
        }));
        const keep = (video.scenes || []).filter((s) => s.part !== partN);
        // insert in part order
        const merged = [...keep, ...made].sort((a, c) => (a.part - c.part) || ((a.n || 0) - (c.n || 0)) || 0);
        // within a part, `made` keeps its own order because it has no n yet; stable sort preserves it
        const re = renumber(video, merged);
        const have = new Set(re.scenes.map((s) => s.part));
        const patch = { scenes: re.scenes, footage: re.footage, ownClips: re.ownClips };
        patch.status = chunks.every((c) => have.has(c.part)) ? laterStep(video.status, 'footage') : laterStep(video.status, 'scenes');
        video = await ctx.store.patch('videos', video.id, patch);
        results.push({ part: partN, scenes: made.length, warnings: r.output.warnings || [], mode: r.mode });
      }
      await ctx.store.log(ctx.by, 'video.scenes', { id: video.id, parts: wanted });
      return { video, results };
    },
  },

  // ---- footage: `bv broll search`
  {
    method: 'POST', path: '/api/video/:id/footage',
    handler: async (ctx) => {
      const video = need(ctx);
      const b = ctx.body || {};
      const scene = (video.scenes || []).find((s) => s.n === parseInt(b.scene, 10));
      const query = cleanQuery(b.query || scene?.query || '');
      if (!query) throw new ctx.HttpError(400, 'Give one or two plain words to search for');
      const status = bvStatus();
      if (!status.runnerFound || !status.setupDone) {
        throw new ctx.HttpError(424, status.message, { command: status.command, runner: BV });
      }
      try {
        const r = await bvSearch(query);
        return { scene: scene?.n ?? (b.scene ?? null), ...r };
      } catch (err) {
        throw new ctx.HttpError(err.status || 502, err.message, err.command ? { command: err.command, runner: BV } : undefined);
      }
    },
  },

  // ---- lists for the screens
  {
    method: 'GET', path: '/api/video/:id/files',
    handler: async (ctx) => {
      const video = need(ctx);
      const dir = projectDir(ctx, video);
      const list = (sub) => {
        const d = path.join(dir, sub);
        if (!fs.existsSync(d)) return [];
        return fs.readdirSync(d).filter((f) => !f.startsWith('.')).map((f) => {
          const st = fs.statSync(path.join(d, f));
          return st.isFile() ? { name: f, path: `${sub}/${f}`, bytes: st.size, at: st.mtime.toISOString() } : null;
        }).filter(Boolean);
      };
      const known = new Set((video.ownClips || []).map((c) => c.path));
      const clips = list('clips');
      return { dir: relProject(video), clips: clips.map((c) => ({ ...c, registered: known.has(c.path) })), voice: list('voice') };
    },
  },
  {
    method: 'GET', path: '/api/video/:id/voice-script',
    handler: async (ctx) => {
      const video = need(ctx);
      const marks = allMarks(video);
      const chapters = parseScript(video.script).map((c) => {
        const spoken = toSpoken(c.text, marks);
        return { n: c.n, title: (chapterOf(video, c.n).title) || c.title, spoken, words: wordCount(spoken), minutes: Math.round((wordCount(spoken) / WPM) * 10) / 10 };
      });
      return { chapters, words: chapters.reduce((a, c) => a + c.words, 0), minutes: Math.round(chapters.reduce((a, c) => a + c.words, 0) / WPM * 10) / 10 };
    },
  },
  {
    method: 'GET', path: '/api/video/:id/footage-list',
    handler: async (ctx) => {
      const video = need(ctx);
      return { footageList: footageListMd(video), shotPlan: shotPlanMd(video) };
    },
  },
  {
    method: 'GET', path: '/api/video/:id/youtube',
    handler: async (ctx) => {
      const video = need(ctx);
      const piece = video.pieceId ? ctx.store.get('pieces', video.pieceId) : null;
      return youtubeInfo(video, piece, ctx.settings());
    },
  },

  // ---- hand-off
  {
    method: 'POST', path: '/api/video/:id/handoff',
    handler: async (ctx) => {
      let video = need(ctx);
      if (!String(video.script || '').trim()) throw new ctx.HttpError(409, 'Write the script first; the hand-off needs script.md');
      const dir = projectDir(ctx, video);
      fs.mkdirSync(path.join(dir, 'chapters'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'assets', 'broll'), { recursive: true });
      const written = [];
      const put = (name, text) => { fs.writeFileSync(path.join(dir, name), text, 'utf8'); written.push(name); };

      const lines = scenesMdLines(video);
      put('script.md', lines.join('\n') + '\n');
      put('script-chapters.md', chaptersMd(video));
      for (const f of fs.readdirSync(path.join(dir, 'chapters'))) if (/^\d\d-.*\.md$/.test(f)) fs.unlinkSync(path.join(dir, 'chapters', f));
      for (const c of parseScript(video.script)) {
        const ch = chapterOf(video, c.n);
        const name = `chapters/${pad(c.n)}-${slugify(ch.title || c.title)}.md`;
        put(name, c.text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n') + '\n');
      }
      put('brand.json', JSON.stringify(buildBrandJson(ctx.store.root, dir), null, 2) + '\n');

      // own clips: copies in assets/broll/ under the names the footage list gives
      const missingClips = [];
      let scenes = (video.scenes || []).map((s) => ({ ...s }));
      for (const s of scenes) {
        if (!s.clipPath || !/^clips\//.test(s.clipPath)) continue;
        const src = path.join(dir, s.clipPath);
        if (!fs.existsSync(src)) { missingClips.push(s.clipPath); continue; }
        const dst = path.join(dir, 'assets', 'broll', path.basename(s.clipPath));
        if (!fs.existsSync(dst)) linkOrCopy(src, dst);
      }

      const rows = sceneRows(video);
      const tl = chapterTimeline(video);
      const plan = {
        project: { id: video.id, title: video.title, solutionId: video.solutionId, pieceId: video.pieceId },
        generatedAt: new Date().toISOString(),
        wordsPerMinute: WPM,
        chapters: tl.map((c) => ({ n: c.n, title: c.title, start: c.start, startClock: fmtClock(c.start), seconds: c.seconds, tone: TONE_BY_CHAPTER[c.n] || 'light', face: FACE_CHAPTERS.includes(c.n) })),
        scenes: rows.map((r) => {
          const f = footageFor(video, r.n);
          const clip = r.clip ? { ...r.clip, file: `assets/broll/${path.basename(r.clip.file)}` } : (f?.ids?.length ? { file: `assets/broll/${stockFile(f.ids[0])}`, start: 0, stock: true, ids: f.ids } : null);
          return { ...r, tone: TONE_BY_CHAPTER[r.chapter] || 'light', clip };
        }),
      };
      put('scenes-plan.json', JSON.stringify(plan, null, 2) + '\n');
      put('footage-list.md', footageListMd(video));
      put('shot-plan.md', shotPlanMd(video));

      // what is still open
      const warnings = [];
      if (!scenes.length) warnings.push('No scenes are planned; script.md has one line per paragraph and the scenes must be designed from scratch.');
      else if (!scriptMatchesScenes(video)) warnings.push('The script has changed since the scenes were planned; script.md follows the script, so re-plan the scenes in Studio before building.');
      const unplanned = scenes.filter((s) => s.kind === 'broll' && !footageFor(video, s.n)?.ids?.length && !s.clipPath).length;
      if (unplanned) warnings.push(`${plural(unplanned, 'b-roll scene has', 'b-roll scenes have')} no stock clip chosen yet.`);
      const faceNo = scenes.filter((s) => s.kind === 'face' && !s.clipPath).length;
      if (faceNo) warnings.push(`${plural(faceNo, 'face scene has', 'face scenes have')} no recorded clip yet.`);
      const voiceDir = path.join(dir, 'voice');
      const voiceFile = fs.existsSync(voiceDir) ? fs.readdirSync(voiceDir).find((f) => /^vo-original\./.test(f)) : null;
      if (!voiceFile) warnings.push('No voice file yet: save it as voice/vo-original.mp3 before bv voice.');
      for (const m of missingClips) warnings.push(`A registered clip is missing on disk: ${m}`);

      const info = {
        at: new Date().toISOString(), total: totalSeconds(video), sceneCount: scenes.length,
        chapters: youtubeInfo(video, null, ctx.settings()).chapters, warnings,
      };
      const prompt = claudePrompt(video, dir, info);
      put('HANDOFF.md', handoffMd(video, dir, info));

      const stock = [...new Set((video.footage || []).flatMap((f) => f.ids || []))];
      const commands = [
        `${BV} setup`,
        `${BV} new "${dir}" "${dir}/brand.json" "${dir}/script.md"`,
        `${BV} check "${dir}"`,
        ...(stock.length ? [`${BV} broll get "${dir}" ${stock.join(' ')}`] : []),
        `${BV} check "${dir}"`,
        `${BV} vo "${dir}"`,
        `${BV} voice "${dir}"`,
        `${BV} music "${dir}"`,
        `${BV} mix "${dir}"`,
        `${BV} render "${dir}"`,
        `${BV} verify "${dir}"`,
      ];
      video = await ctx.store.patch('videos', video.id, {
        bvProject: relProject(video), status: laterStep(video.status, 'edit'),
        handoff: { at: info.at, path: dir, files: written, commands, prompt, warnings },
      });
      await ctx.store.log(ctx.by, 'video.handoff', { id: video.id, files: written.length });
      return { video, path: dir, files: written, commands, prompt, warnings, bv: bvStatus() };
    },
  },

  // ---- own clips: multipart upload, or JSON register | map | remove
  {
    method: 'POST', path: '/api/video/:id/own-clips',
    handler: async (ctx) => {
      let video = need(ctx);
      const dir = projectDir(ctx, video);
      const type = ctx.req.headers['content-type'] || '';
      const mapToScene = (vid, clip) => {
        const sceneN = clip.scene ? parseInt(clip.scene, 10) : null;
        let scenes = (vid.scenes || []).map((s) => (s.clipPath === clip.path && s.n !== sceneN ? unmapScene(s) : s));
        if (sceneN) {
          scenes = scenes.map((s) => {
            if (s.n !== sceneN) return s;
            // a recorded clip makes the scene a face scene, unless it is already a screen recording
            if (s.kind === 'screen' || s.kind === 'face') return { ...s, clipPath: clip.path, start: 0 };
            return { ...s, clipPath: clip.path, start: 0, kind: 'face', kindBefore: s.kind };
          });
        }
        return scenes;
      };
      const storeClip = async (clip) => {
        const clips = (video.ownClips || []).filter((c) => c.path !== clip.path);
        clips.push(clip);
        video = await ctx.store.patch('videos', video.id, { ownClips: clips, scenes: mapToScene(video, clip) });
      };

      if (/multipart\/form-data/i.test(type)) {
        const parts = parseMultipart(ctx.rawBody, type);
        const fields = Object.fromEntries(parts.filter((p) => !p.filename).map((p) => [p.name, p.data.toString('utf8')]));
        const files = parts.filter((p) => p.filename);
        if (!files.length) throw new ctx.HttpError(400, 'No file in the upload');
        fs.mkdirSync(path.join(dir, 'clips'), { recursive: true });
        const added = [];
        for (const f of files) {
          const name = uniqueName(path.join(dir, 'clips'), safeName(f.filename));
          fs.writeFileSync(path.join(dir, 'clips', name), f.data);
          const clip = {
            path: `clips/${name}`, label: String(fields.label || name.replace(/\.[^.]+$/, '')).trim(),
            seconds: fields.seconds ? Number(fields.seconds) || null : null, scene: fields.scene ? parseInt(fields.scene, 10) || null : null,
            bytes: f.data.length,
          };
          await storeClip(clip);
          added.push(clip);
        }
        await ctx.store.log(ctx.by, 'video.own-clips.upload', { id: video.id, files: added.map((c) => c.path) });
        return { video, added };
      }

      const b = ctx.body || {};
      const action = b.action || 'register';
      if (action === 'register') {
        let rel = null;
        if (b.file) {
          const name = path.basename(String(b.file));
          if (!fs.existsSync(path.join(dir, 'clips', name))) throw new ctx.HttpError(404, `clips/${name} is not in the project folder`);
          rel = `clips/${name}`;
        } else if (b.path) {
          const abs = path.resolve(String(b.path));
          if (!path.isAbsolute(String(b.path)) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new ctx.HttpError(404, 'That file was not found on this Mac');
          if (!/\.(mp4|mov|m4v|webm|mkv)$/i.test(abs)) throw new ctx.HttpError(400, 'Own clips must be mp4, mov, m4v, webm or mkv');
          fs.mkdirSync(path.join(dir, 'clips'), { recursive: true });
          const name = uniqueName(path.join(dir, 'clips'), safeName(path.basename(abs)));
          linkOrCopy(abs, path.join(dir, 'clips', name));
          rel = `clips/${name}`;
        } else throw new ctx.HttpError(400, 'Give file (a name inside clips/) or path (an absolute path on this Mac)');
        const st = fs.statSync(path.join(dir, rel));
        const clip = {
          path: rel, label: String(b.label || path.basename(rel).replace(/\.[^.]+$/, '')).trim(),
          seconds: b.seconds ? Number(b.seconds) || null : null, scene: b.scene ? parseInt(b.scene, 10) || null : null, bytes: st.size,
        };
        await storeClip(clip);
        await ctx.store.log(ctx.by, 'video.own-clips.register', { id: video.id, path: rel });
        return { video, added: [clip] };
      }
      if (action === 'map') {
        const clip = (video.ownClips || []).find((c) => c.path === b.path);
        if (!clip) throw new ctx.HttpError(404, 'Clip not registered');
        if (b.scene && !(video.scenes || []).some((s) => s.n === parseInt(b.scene, 10))) throw new ctx.HttpError(400, `There is no scene ${b.scene}`);
        await storeClip({ ...clip, scene: b.scene ? parseInt(b.scene, 10) : null });
        return { video };
      }
      if (action === 'remove') {
        const clip = (video.ownClips || []).find((c) => c.path === b.path);
        if (!clip) throw new ctx.HttpError(404, 'Clip not registered');
        const scenes = (video.scenes || []).map((s) => (s.clipPath === clip.path ? unmapScene(s) : s));
        video = await ctx.store.patch('videos', video.id, { ownClips: video.ownClips.filter((c) => c.path !== clip.path), scenes });
        return { video };
      }
      throw new ctx.HttpError(400, `Unknown action ${action}`);
    },
  },

  // ---- the recorded voice
  {
    method: 'POST', path: '/api/video/:id/voice',
    handler: async (ctx) => {
      let video = need(ctx);
      const dir = projectDir(ctx, video);
      const type = ctx.req.headers['content-type'] || '';
      let src = null; let data = null; let ext = null;
      if (/multipart\/form-data/i.test(type)) {
        const f = parseMultipart(ctx.rawBody, type).find((p) => p.filename);
        if (!f) throw new ctx.HttpError(400, 'No file in the upload');
        ext = path.extname(f.filename).toLowerCase();
        data = f.data;
      } else {
        const p = String(ctx.body?.path || '');
        if (!path.isAbsolute(p) || !fs.existsSync(p) || !fs.statSync(p).isFile()) throw new ctx.HttpError(400, 'Upload a file, or give the absolute path of one on this Mac');
        src = p; ext = path.extname(p).toLowerCase();
      }
      if (!['.mp3', '.wav', '.m4a'].includes(ext)) throw new ctx.HttpError(400, 'The pipeline reads voice/vo-original as mp3, wav or m4a');
      fs.mkdirSync(path.join(dir, 'voice'), { recursive: true });
      const dst = path.join(dir, 'voice', `vo-original${ext}`);
      const inPlace = src && path.resolve(src) === dst;
      if (!inPlace) {
        for (const f of fs.readdirSync(path.join(dir, 'voice'))) if (/^vo-original\./.test(f)) fs.unlinkSync(path.join(dir, 'voice', f));
        if (data) fs.writeFileSync(dst, data); else linkOrCopy(src, dst);
      }
      const bytes = fs.statSync(dst).size;
      video = await ctx.store.patch('videos', video.id, {
        voice: { file: `voice/vo-original${ext}`, bytes, at: new Date().toISOString() }, status: laterStep(video.status, 'own-clips'),
      });
      await ctx.store.log(ctx.by, 'video.voice', { id: video.id, bytes });
      return { video };
    },
  },

  // ---- Shorts
  {
    method: 'POST', path: '/api/video/:id/shorts',
    handler: async (ctx) => {
      let video = need(ctx);
      const b = ctx.body || {};
      if (!String(video.script || '').trim()) throw new ctx.HttpError(409, 'Write the script first');
      const tl = chapterTimeline(video);
      const input = {
        title: video.title, outline: video.outline, script: video.script, count: clamp(parseInt(b.count, 10) || 3, 2, 4),
        chapterStarts: Object.fromEntries(tl.map((c) => [c.n, c.start])), solutionId: video.solutionId,
      };
      if (b.dryRun) return dryRun(ctx, 'shortsCuts', input);
      const existing = (video.shortsPieceIds || []).map((id) => ctx.store.get('pieces', id)).filter((p) => p && p.status !== 'retired');
      if (existing.length && !b.replace) throw new ctx.HttpError(409, `${existing.length} Shorts already exist for this video. Send replace: true to retire the drafts and make new ones.`, { existing: existing.map((p) => p.id) });
      const r = await runOp(ctx, 'shortsCuts', input, b.output);
      for (const p of existing) {
        if (p.status === 'draft' || p.status === 'idea') await ctx.store.patch('pieces', p.id, { status: 'retired' });
      }
      const created = [];
      for (const s of r.output.shorts) {
        const ch = tl.find((c) => c.n === s.chapter);
        const piece = await ctx.store.put('pieces', {
          id: ctx.store.nextId('pc'), type: 'youtube-short', pillar: 'glimpse', status: 'draft', hook: s.hook,
          pis: s.pis,
          renditions: { yt: { title: s.title, description: s.description, tags: s.tags || [] } },
          script: s.lines.map((l) => ({ say: l.say, sees: l.sees, codes: [], seconds: l.seconds })),
          targets: ['yt'], tags: ['case-study-short'], videoId: video.id, by: ctx.by || null,
          notes: `From "${video.title}", chapter ${s.chapter}${ch ? ` (${ch.title})` : ''}, ${s.from} to ${s.to} of the chapter; ${fmtClock(s.startAt)} to ${fmtClock(s.endAt)} in the full video. About ${s.seconds} seconds. Set Related video to the long video in YouTube Studio.`,
        });
        await makeVersion(ctx, piece, 'Created from the video project');
        created.push(piece);
      }
      const keep = (video.shortsPieceIds || []).filter((id) => ctx.store.get('pieces', id) && !existing.some((p) => p.id === id && (p.status === 'draft' || p.status === 'idea')));
      video = await ctx.store.patch('videos', video.id, { shortsPieceIds: [...keep, ...created.map((p) => p.id)] });
      await ctx.store.log(ctx.by, 'video.shorts', { id: video.id, pieces: created.map((p) => p.id) });
      return { video, pieces: created, warnings: r.output.warnings || [], mode: r.mode };
    },
  },

  // ---- done
  {
    method: 'POST', path: '/api/video/:id/done',
    handler: async (ctx) => {
      let video = need(ctx);
      const b = ctx.body || {};
      const piece = video.pieceId ? ctx.store.get('pieces', video.pieceId) : null;
      const info = youtubeInfo(video, piece, ctx.settings());
      const title = String(b.title ?? info.title).trim();
      const description = String(b.description ?? info.description);
      const mp4 = String(b.mp4Path || '').trim();
      if (!title) throw new ctx.HttpError(400, 'A YouTube title is required');
      if (mp4 && !/\.mp4$/i.test(mp4)) throw new ctx.HttpError(400, 'The final file should be an .mp4');
      const final = {
        mp4Path: mp4 || video.final?.mp4Path || '', title, description,
        chapters: info.chapters, doneAt: new Date().toISOString(), notes: b.notes ? String(b.notes) : (video.final?.notes || ''),
      };
      const assets = [...(piece?.assets || []).filter((a) => a.kind !== 'video' || a.label !== 'Final video')];
      if (final.mp4Path) assets.push({ id: `as-${video.id}-final`, kind: 'video', path: final.mp4Path, label: 'Final video', seconds: info.totalSeconds || null });
      const yt = { ...(piece?.renditions?.yt || {}), title, description };
      const synced = await syncPiece(ctx, video, { renditions: { yt }, assets }, 'YouTube title and description from the video project');
      video = await ctx.store.patch('videos', video.id, { final, status: 'done' });
      await ctx.store.log(ctx.by, 'video.done', { id: video.id, mp4: final.mp4Path });
      return { video, piece: synced, checks: youtubeInfo(video, synced, ctx.settings()).checks };
    },
  },
];

// ------------------------------------------------------------------ Today

export async function enrichToday(payload, ctx) {
  const rows = ctx.store.list('videos', (v) => v.status !== 'done');
  payload.videos = rows.map((v) => {
    const piece = v.pieceId ? ctx.store.get('pieces', v.pieceId) : null;
    // the Today list needs the headline fields, not the script and the scenes
    const { outline, script, scriptMarks, scenes, footage, ownClips, handoff, final, ...slim } = v;
    return {
      ...slim,
      step: STEPS.indexOf(v.status) + 1, stepOf: STEPS.length, stepLabel: STEP_LABEL[v.status] || v.status,
      nextAction: NEXT_ACTION[v.status] || '', href: `#/video/${v.id}`,
      plannedDate: piece?.plannedDate || null, shortsMade: (v.shortsPieceIds || []).length,
    };
  });
}
