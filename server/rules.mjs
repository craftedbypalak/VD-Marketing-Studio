// The deterministic checker (contract section 8) and the content routes. [content]
//
//   check(piece, rules, accounts, extra?) -> { passed, violations: [ { rule, severity, field, text, fix, check } ], counts }
//
// Twelve checks in the order of the contract, plus one warning for an unfilled
// square-bracket placeholder (check 13). Severity `block` stops approval; `warn`
// is shown. Every violation cites the rule text it comes from. The checker is
// pure: it needs no network.
//
// Routes (module routes are mounted before the core ones):
//   POST /api/pieces/:id/check               run the checker, store piece.check, return it
//                                            (body { piece } checks an unsaved working copy and stores nothing)
//   POST /api/content/check-all              run the checker over every piece that is not retired; store and summarise
//   GET  /api/content/review-pass            the pieces the review pass would take
//   POST /api/content/review-pass            queue `refine` over every in-review piece with one version
//   GET  /api/content/review-pass/:jobId     progress, with what was written per piece
//   GET|POST /api/content/prompt/:op         debug: the system and user prompt and the schema, with no model call
//   GET  /api/checker/defaults               the code defaults of the lists Builder edits (emojiOk, capsOk, ...)
//
// POST /api/pieces/:id/place and /unplace belong to the calendar module.

import { store } from './store.mjs';
import { loadOp, buildCtx } from './ai.mjs';
import { standingInstruction } from './ops/reviewPass.mjs';
import { textView } from './ops/_content.mjs';

// ------------------------------------------------------------------- helpers

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LB = '(?<![\\p{L}\\p{N}])';
const RB = '(?![\\p{L}\\p{N}])';

function phraseRe(phrase, flags = 'giu') {
  return new RegExp(`${LB}${esc(phrase)}${RB}`, flags);
}

function* matches(text, re) {
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m;
  while ((m = r.exec(text)) !== null) {
    if (m[0] === '') { r.lastIndex++; continue; }
    yield { index: m.index, text: m[0], groups: m };
  }
}

/** Spans of text inside quotation marks: an owner's quoted line. */
function quoteSpans(text) {
  const spans = [];
  let open = null;
  let start = -1;
  const isAlnum = (c) => /[\p{L}\p{N}]/u.test(c || '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const prev = text[i - 1];
    const next = text[i + 1];
    if (open === null) {
      if (c === '“' || c === '‘') { open = c === '“' ? '”' : '’'; start = i; }
      else if (c === '"' && !isAlnum(prev)) { open = '"'; start = i; }
      else if (c === "'" && !isAlnum(prev)) { open = "'"; start = i; }
    } else if (c === open && (open === '”' || (prev && !/\s/.test(prev) && !isAlnum(next)) || open === '"')) {
      spans.push([start, i + 1]);
      open = null;
    }
  }
  return spans;
}

const inSpan = (spans, i) => spans.some(([a, b]) => i >= a && i < b);

const wordsOf = (s) => String(s || '').replace(/\*/g, '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

function normalise(s) {
  return String(s ?? '').replace(/\*/g, '');
}

// ------------------------------------------------------- public field gathering

/**
 * Every public field of a piece as { field, text, headEnd }. `headEnd` is the
 * length of the headline region of the text (hook, first line of li.text,
 * slide 1, yt.title), used by the `headline` scope.
 */
export function publicFields(piece = {}) {
  const out = [];
  const add = (field, raw, head = 'none') => {
    const text = normalise(raw);
    if (!text.trim()) return;
    let headEnd = 0;
    if (head === 'all') headEnd = text.length;
    else if (head === 'firstLine') { const nl = text.indexOf('\n'); headEnd = nl < 0 ? text.length : nl; }
    out.push({ field, text, headEnd });
  };
  add('hook', piece.hook, 'all');
  const pis = piece.pis || {};
  add('pis.problem', pis.problem);
  add('pis.impact', pis.impact);
  (Array.isArray(pis.solution) ? pis.solution : (pis.solution ? [pis.solution] : [])).forEach((l, i) => add(`pis.solution[${i + 1}]`, l));
  add('pis.close', pis.close);
  const r = piece.renditions || {};
  if (r.ig) {
    add('renditions.ig.caption', r.ig.caption);
    if (Array.isArray(r.ig.hashtags) && r.ig.hashtags.length) add('renditions.ig.hashtags', r.ig.hashtags.join(' '));
    add('renditions.ig.firstComment', r.ig.firstComment);
  }
  if (r.li) { add('renditions.li.text', r.li.text, 'firstLine'); add('renditions.li.firstComment', r.li.firstComment); }
  if (r.liCo) add('renditions.liCo.text', r.liCo.text);
  if (r.fb) add('renditions.fb.text', r.fb.text);
  if (r.waStatus) add('renditions.waStatus.text', r.waStatus.text);
  if (r.waNote) add('renditions.waNote.text', r.waNote.text);
  if (r.yt) {
    add('renditions.yt.title', r.yt.title, 'all');
    add('renditions.yt.description', r.yt.description);
    if (Array.isArray(r.yt.tags) && r.yt.tags.length) add('renditions.yt.tags', r.yt.tags.join(' '));
  }
  (piece.slides || []).forEach((s, i) => {
    const head = i === 0 ? 'all' : 'none';
    const n = i + 1;
    add(`slides[${n}].eyebrow`, s.eyebrow, head);
    add(`slides[${n}].head`, s.head, head);
    add(`slides[${n}].body`, s.body, head);
    (s.items || []).forEach((it, j) => add(`slides[${n}].items[${j + 1}]`, it, head));
    add(`slides[${n}].foot`, s.foot, head);
  });
  (piece.script || []).forEach((row, i) => add(`script[${i + 1}].say`, row.say));
  return out;
}

// ----------------------------------------------------------------- the checker

// The lists below are the code defaults. A rules document may carry its own copy
// (rules.emojiOk, rules.capsOk, rules.hinglish, rules.companySuffixes, rules.notNames),
// edited in Builder, Checker rules; an array there replaces the default, and when
// the key is absent the default here applies.

export const DEFAULT_EMOJI_OK = ['©', '®', '™'];
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}⃣️]/gu;

export const DEFAULT_CAPS_OK = ['AIMP', 'MSME', 'GSTR', 'GSTIN', 'BNI'];

export const DEFAULT_HINGLISH = [
  'ho gaya', 'hua', 'kya', 'hai', 'nahi', 'nahin', 'karo', 'bhai', 'yaar', 'achha', 'accha', 'theek hai', 'kaise', 'kyun', 'abhi', 'bilkul',
];

// A dot after a word makes the dot optional ("Pvt. Ltd." also finds "Pvt Ltd" and "PvtLtd").
export const DEFAULT_COMPANY_SUFFIXES = [
  'Pvt. Ltd.', 'Private Limited', 'Limited', 'Ltd.', 'LLP', 'Inc.', 'Corp.', 'Industries', 'Enterprises', 'Traders', 'Textiles', 'Associates',
  'Consultants', 'Technologies', 'Solutions', 'Group', 'Exports', 'Foods', 'Pharma', 'Motors', 'Steel', 'Plastics', 'Packaging', 'Logistics', 'Constructions', 'Builders',
];

export const DEFAULT_NOT_NAMES = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Diwali', 'Dhanteras', 'Holi', 'Dussehra', 'Navratri', 'Eid', 'Christmas', 'Easter', 'Baisakhi', 'Onam', 'Pongal',
  'Guru Nanak Jayanti', 'Raksha Bandhan', 'Makar Sankranti', 'Republic Day', 'Independence Day', 'Gandhi Jayanti', 'New Year',
  'Good Friday', 'Maha Shivratri', 'Ram Navami', 'Ganesh Chaturthi', 'Janmashtami', 'Mahavir Jayanti', 'Buddha Purnima', 'Labour Day',
  'Indian', 'India', 'Hindi', 'English', 'Hinglish',
  'Instagram', 'LinkedIn', 'WhatsApp Status', 'WhatsApp', 'YouTube Shorts', 'YouTube Short', 'YouTube', 'Facebook', 'Google Sheets', 'Google Drive', 'Google Account',
  'Status', 'Reel', 'Reels', 'Stories',
];

/** The editable checker lists with their code defaults, for Builder. */
export const CHECKER_LIST_DEFAULTS = {
  emojiOk: DEFAULT_EMOJI_OK,
  capsOk: DEFAULT_CAPS_OK,
  hinglish: DEFAULT_HINGLISH,
  companySuffixes: DEFAULT_COMPANY_SUFFIXES,
  notNames: DEFAULT_NOT_NAMES,
};

/** rules[key] when it is an array (blank lines dropped), else the default. */
export function listOf(rules, key) {
  const v = rules?.[key];
  if (!Array.isArray(v)) return CHECKER_LIST_DEFAULTS[key];
  return v.map((x) => String(x ?? '').trim()).filter(Boolean);
}

function suffixPattern(suffix) {
  const words = String(suffix).trim().split(/\s+/).filter(Boolean);
  return words.map((w, i) => {
    const dotted = w.endsWith('.');
    const core = esc(w.replace(/\.+$/, '')) + (dotted ? '\\.?' : '');
    const gap = i < words.length - 1 ? (dotted ? '[ \\t]?' : '[ \\t]+') : '';
    return core + gap;
  }).join('');
}

const suffixCache = new Map();
/** The firm-name pattern: up to four capitalised words ending in a company suffix. Null when the list is empty. */
export function suffixRe(suffixes) {
  const list = [...suffixes].filter((x) => String(x).trim()).sort((a, b) => b.length - a.length);
  if (!list.length) return null;
  const key = list.join('\u0000');
  if (suffixCache.has(key)) return suffixCache.get(key);
  const re = new RegExp(
    '(?<![\\p{L}\\p{N}])(?:\\p{Lu}[\\p{L}&\'’-]*[ \\t]+){0,3}\\p{Lu}[\\p{L}&\'’-]*[ \\t]+' +
    `(?:${list.map(suffixPattern).join('|')})(?![\\p{L}\\p{N}])`,
    'gu',
  );
  if (suffixCache.size > 20) suffixCache.clear();
  suffixCache.set(key, re);
  return re;
}

const CAP_SEQ_RE = /(?<![\p{L}\p{N}#@/])\p{Lu}[\p{L}\p{N}&'’-]+(?:[ \t]+\p{Lu}[\p{L}\p{N}&'’-]+)+/gu;

function claimText(rules, re, fallback) {
  const hit = (rules.claimsBlocked || []).find((c) => re.test(c));
  return hit || fallback;
}

/**
 * @param {object} piece
 * @param {object} rules      the rules document (4.5)
 * @param {Array}  accounts   the accounts (4.4)
 * @param {object} [extra]    { solutions } (defaults to the store)
 */
export function check(piece, rules = {}, accounts = [], extra = {}) {
  const violations = [];
  const fields = publicFields(piece);
  const limits = rules.limits || {};
  const solutions = extra.solutions || (() => { try { return store.list('solutions'); } catch { return []; } })();
  const acct = (id) => (accounts || []).find((a) => a.id === id) || null;

  const add = (v) => violations.push({ severity: 'warn', fix: '', ...v });
  const EMOJI_OK = new Set(listOf(rules, 'emojiOk'));
  const CAPS_OK = new Set(listOf(rules, 'capsOk'));
  const HINGLISH = listOf(rules, 'hinglish');
  const NOT_NAMES = listOf(rules, 'notNames');
  const SUFFIX_RE = suffixRe(listOf(rules, 'companySuffixes'));

  // 1. Course terms: always block, anywhere in any public field.
  for (const term of rules.courseTerms || []) {
    const acronym = /^[A-Z]{2,6}$/.test(term);
    const re = new RegExp(`${LB}${esc(term)}${RB}`, acronym ? 'gu' : 'giu');
    for (const f of fields) {
      for (const m of matches(f.text, re)) {
        add({
          check: 1, severity: 'block', field: f.field, text: m.text, start: m.index, end: m.index + m.text.length,
          rule: `Course and internal terms never appear in public copy: "${term}".`,
          fix: 'Remove it and say what the tool does in plain words.',
        });
      }
    }
  }

  // 2. Never phrases, by scope.
  for (const n of rules.never || []) {
    if (!n.phrase) continue;
    const re = phraseRe(n.phrase);
    // A hashtag cannot carry a hyphen or a space, so a phrase banned only for its
    // spelling ("followups" for "follow-ups") is not a fault inside a hashtag field.
    const spellingOnly = /hyphen/i.test(n.note || '');
    const plainWord = !/[\s-]/.test(n.phrase);
    for (const f of fields) {
      if (spellingOnly && /\.(hashtags|tags)$/.test(f.field)) continue;
      const spans = n.scope === 'ourVoice' ? quoteSpans(f.text) : null;
      for (const m of matches(f.text, re)) {
        // A one-word phrase inside a hyphenated compound ("best-before", "best-known") is not the claim word.
        if (plainWord && (f.text[m.index - 1] === '-' || f.text[m.index + m.text.length] === '-')) continue;
        if (n.scope === 'headline') {
          if (m.index >= f.headEnd) continue;
          add({
            check: 2, severity: 'block', field: f.field, text: m.text, start: m.index, end: m.index + m.text.length,
            rule: `Never use "${n.phrase}" as a hook, title, first line or headline; it may appear only as a close. ${n.note || ''}`.trim(),
            fix: 'Move it to the close, or reword the headline as the question the owner asks of themselves.',
          });
        } else if (n.scope === 'ourVoice') {
          if (inSpan(spans, m.index)) continue;
          add({
            check: 2, severity: 'warn', field: f.field, text: m.text, start: m.index, end: m.index + m.text.length,
            rule: `"${n.phrase}" belongs only inside a quoted owner line, never in our own voice. ${n.note || ''}`.trim(),
            fix: 'Put it inside a quoted owner line, or remove it.',
          });
        } else {
          add({
            check: 2, severity: 'block', field: f.field, text: m.text, start: m.index, end: m.index + m.text.length,
            rule: `Never say "${n.phrase}". ${n.note || ''}`.trim(),
            fix: 'Remove it, or say it in the owner\'s plain words.',
          });
        }
      }
    }
  }

  // 3. Emoji and exclamation marks (block); ALL CAPS words of four or more letters (warn).
  for (const f of fields) {
    for (const m of matches(f.text, EMOJI_RE)) {
      if (EMOJI_OK.has(m.text)) continue;
      add({
        check: 3, severity: 'block', field: f.field, text: m.text, start: m.index, end: m.index + m.text.length,
        rule: 'No emoji anywhere.', fix: 'Delete the emoji.',
      });
    }
    for (const m of matches(f.text, /[!！]/g)) {
      add({
        check: 3, severity: 'block', field: f.field, text: f.text.slice(Math.max(0, m.index - 20), m.index + 1), start: m.index, end: m.index + 1,
        rule: 'No exclamation marks anywhere.', fix: 'End the sentence with a full stop.',
      });
    }
    for (const m of matches(f.text, /(?<![\p{L}\p{N}#])\p{Lu}{4,}(?![\p{L}\p{N}])/gu)) {
      if (CAPS_OK.has(m.text)) continue;
      if ((rules.allowNames || []).some((a) => a.toUpperCase() === m.text)) continue;
      add({
        check: 3, severity: 'warn', field: f.field, text: m.text, start: m.index, end: m.index + m.text.length,
        rule: 'No ALL CAPS words; sentence case throughout.', fix: `Write "${m.text.charAt(0)}${m.text.slice(1).toLowerCase()}".`,
      });
    }
  }

  // 4. Hook length (warn); a LinkedIn first line past the cut (warn).
  const hookLimit = limits.hookWords ?? 8;
  const hookWords = wordsOf(piece.hook).length;
  if (hookWords > hookLimit) {
    add({
      check: 4, severity: 'warn', field: 'hook', text: normalise(piece.hook),
      rule: `The hook is ${hookLimit} words or fewer.`, fix: `Cut it from ${hookWords} words to ${hookLimit} or fewer.`,
    });
  }
  const liText = piece.renditions?.li?.text;
  if (liText) {
    const first = normalise(liText).split('\n')[0];
    const cut = limits.liHookChars ?? 210;
    if (first.length > cut) {
      add({
        check: 4, severity: 'warn', field: 'renditions.li.text', text: first.slice(0, 60) + '...',
        rule: `The first ${cut} characters of a LinkedIn post carry the hook; the first line runs to ${first.length}.`,
        fix: 'Break the first line so that the hook sits within the first two lines.',
      });
    }
  }

  // 5. Hashtags.
  const hashInfo = (text) => {
    const trimmed = String(text || '').replace(/\s+$/, '');
    const tokens = trimmed.split(/(\s+)/);
    const trailing = [];
    while (tokens.length) {
      const t = tokens[tokens.length - 1];
      if (/^\s+$/.test(t)) { tokens.pop(); continue; }
      if (/^#[\p{L}\p{N}_]+$/u.test(t)) { trailing.unshift(t); tokens.pop(); continue; }
      break;
    }
    const rest = tokens.join('');
    const body = [...matches(rest, /(?<![\p{L}\p{N}])#[\p{L}\p{N}_]+/gu)].map((m) => m.text);
    return { trailing, body };
  };
  const ig = piece.renditions?.ig;
  if (ig) {
    const field = 'renditions.ig.hashtags';
    const listed = (ig.hashtags || []).map((t) => String(t).trim()).filter(Boolean);
    const info = hashInfo(ig.caption);
    const total = listed.length + info.trailing.length + info.body.length;
    const max = limits.igHashtags ?? 5;
    if (total > max) {
      add({
        check: 5, severity: 'block', field, text: `${total} hashtags`,
        rule: `Instagram takes at most ${max} hashtags.`, fix: `Keep the ${max} most relevant and delete the rest.`,
      });
    }
    if (info.body.length) {
      add({
        check: 5, severity: 'block', field: 'renditions.ig.caption', text: info.body.join(' '),
        rule: 'Instagram hashtags go at the end of the post, never in the body.', fix: 'Move the hashtags to the end.',
      });
    }
  }
  for (const key of ['li', 'liCo']) {
    const t = piece.renditions?.[key]?.text;
    if (!t) continue;
    const info = hashInfo(t);
    const field = `renditions.${key}.text`;
    if (info.body.length) {
      add({
        check: 5, severity: 'block', field, text: info.body.join(' '),
        rule: 'LinkedIn takes no hashtags in the body.', fix: 'Move up to three hashtags to the very last line, or delete them.',
      });
    }
    const max = limits.liHashtagsBottom ?? 3;
    if (info.trailing.length > max) {
      add({
        check: 5, severity: 'warn', field, text: info.trailing.join(' '),
        rule: `LinkedIn takes at most ${max} hashtags, at the bottom.`, fix: `Keep ${max} or fewer.`,
      });
    }
  }
  if (piece.renditions?.yt?.description) {
    const info = hashInfo(piece.renditions.yt.description);
    const max = acct('yt')?.limits?.hashtagsMax ?? 3;
    if (info.trailing.length + info.body.length > max) {
      add({
        check: 5, severity: 'warn', field: 'renditions.yt.description', text: [...info.body, ...info.trailing].join(' '),
        rule: `YouTube takes at most ${max} hashtags, at the bottom of the description.`, fix: `Keep ${max} or fewer.`,
      });
    }
  }
  for (const key of ['fb', 'waStatus', 'waNote']) {
    const t = piece.renditions?.[key]?.text;
    if (!t) continue;
    const info = hashInfo(t);
    if (info.body.length || info.trailing.length) {
      add({
        check: 5, severity: 'warn', field: `renditions.${key}.text`, text: [...info.body, ...info.trailing].join(' '),
        rule: 'This account takes no hashtags.', fix: 'Delete the hashtags.',
      });
    }
  }

  // 6. Text over the account's limit (block).
  const DEFAULT_MAX = { ig: 2200, li: 3000, liCo: 3000, fb: 2200, waStatus: 700, waNote: 1200, yt: 5000 };
  const ACCOUNT_OF = { ig: 'vd-ig', li: 'p-li', liCo: 'vd-li', fb: 'vd-fb', waStatus: 'wa-st', waNote: 'wa-note', yt: 'yt' };
  for (const [key, r] of Object.entries(piece.renditions || {})) {
    if (!r) continue;
    const a = acct(ACCOUNT_OF[key]);
    const max = a?.limits?.textMax ?? DEFAULT_MAX[key];
    const body = key === 'yt' ? r.description : (key === 'ig' ? r.caption : r.text);
    let len = String(body || '').length;
    if (key === 'ig') len += (r.hashtags || []).join(' ').length + ((r.hashtags || []).length ? 1 : 0);
    if (max && len > max) {
      add({
        check: 6, severity: 'block', field: `renditions.${key}.${key === 'yt' ? 'description' : (key === 'ig' ? 'caption' : 'text')}`,
        text: `${len} characters`, rule: `${a?.label || key} takes at most ${max} characters.`, fix: `Cut ${len - max} characters.`,
      });
    }
  }
  if (piece.renditions?.yt?.title) {
    const tmax = acct('yt')?.limits?.titleMax ?? 100;
    if (piece.renditions.yt.title.length > tmax) {
      add({
        check: 6, severity: 'block', field: 'renditions.yt.title', text: `${piece.renditions.yt.title.length} characters`,
        rule: `A YouTube title takes at most ${tmax} characters.`, fix: 'Shorten the title.',
      });
    }
  }
  if (piece.renditions?.waStatus?.text) {
    const lines = piece.renditions.waStatus.text.split('\n').filter((l) => l.trim()).length;
    const maxLines = limits.statusLines ?? 1;
    if (lines > maxLines) {
      add({
        check: 6, severity: 'warn', field: 'renditions.waStatus.text', text: `${lines} lines`,
        rule: `A Status is ${maxLines === 1 ? 'one line' : `${maxLines} lines at most`}.`, fix: 'Keep one idea on one line.',
      });
    }
  }

  // 7. Figures not marked as an example or illustrative (warn).
  const FIGURES = [
    /(?:(?<![\p{L}\p{N}])Rs\.?\s*|₹\s*)\d[\d,]*(?:\.\d+)?(?:\s*(?:lakhs?|crores?|thousand|k))?/giu,
    /(?<![\p{L}\p{N}.])\d[\d,.]*\s*(?:lakhs?|crores?)(?![\p{L}\p{N}])/giu,
    /(?<![\p{N},.])\d[\d,]*(?:\.\d+)?\s*%/gu,
    /(?<![\p{L}\p{N}.,])\d[\d,]*(?:\.\d+)?\s*(?:hours?|hrs?)(?![\p{L}\p{N}])/giu,
    /(?<![\p{L}\p{N}.])\d+(?:\.\d+)?\s?[x×](?![\p{L}\p{N}])/giu,
  ];
  for (const f of fields) {
    if (f.field.endsWith('.hashtags') || f.field.endsWith('.tags')) continue;
    for (const re of FIGURES) {
      for (const m of matches(f.text, re)) {
        const from = Math.max(0, m.index - 60);
        const to = Math.min(f.text.length, m.index + m.text.length + 60);
        if (/example|illustrative/i.test(f.text.slice(from, to))) continue;
        add({
          check: 7, severity: 'warn', field: f.field, text: m.text.trim(), start: m.index, end: m.index + m.text.length,
          rule: 'No figure unless the owner supplied it or it is clearly marked as an example or illustrative (within 60 characters).',
          fix: 'Mark it as an example, replace it with a question, or remove it.',
        });
      }
    }
    for (const m of matches(f.text, /₹/g)) {
      add({
        check: 7, severity: 'warn', field: f.field, text: '₹', start: m.index, end: m.index + 1,
        rule: 'Rupee amounts are written "Rs 20,000", never with the rupee symbol.', fix: 'Write Rs before the amount.',
      });
    }
  }

  // 8. Firm-like names that are not on the allowed list (warn).
  const allowed = [...(rules.allowNames || []), ...solutions.map((s) => s.publicName).filter(Boolean), ...NOT_NAMES]
    .filter(Boolean).sort((a, b) => b.length - a.length);
  const allowRes = allowed.map((a) => new RegExp(`${LB}${esc(a)}${RB}`, 'giu'));
  for (const f of fields) {
    if (f.field.endsWith('.hashtags') || f.field.endsWith('.tags')) continue;
    let text = f.text.replace(/#[\p{L}\p{N}_]+/gu, (m) => ' '.repeat(m.length)).replace(/https?:\/\/\S+/g, (m) => ' '.repeat(m.length));
    for (const re of allowRes) text = text.replace(re, (m) => '\u0001'.repeat(m.length));
    const seen = [];
    for (const re of [SUFFIX_RE, CAP_SEQ_RE].filter(Boolean)) {
      for (const m of matches(text, re)) {
        const end = m.index + m.text.length;
        if (seen.some(([a, b]) => m.index < b && end > a)) continue;
        seen.push([m.index, end]);
        add({
          check: 8, severity: 'warn', field: f.field, text: f.text.slice(m.index, end), start: m.index, end,
          rule: 'No client, lender or firm is named, and no organisation outside the allowed list.',
          fix: 'Remove the name or replace it with plain words (an owner, a firm). Add it to the allowed list in Settings only if the brief permits it.',
        });
      }
    }
  }

  // 9. Whole Hindi sentences: Devanagari runs over 12 characters, or more than one Hinglish tag (warn).
  const hinglishRe = HINGLISH.length ? new RegExp(`${LB}(?:${HINGLISH.map(esc).join('|')})${RB}`, 'giu') : null;
  for (const f of fields) {
    for (const m of matches(f.text, /[ऀ-ॿ][ऀ-ॿ\s.,?।]*/gu)) {
      if (m.text.trim().length > 12) {
        add({
          check: 9, severity: 'warn', field: f.field, text: m.text.trim(), start: m.index, end: m.index + m.text.length,
          rule: 'No whole Hindi sentences. One Hindi tag is allowed, only inside a quoted owner line.', fix: 'Write it in English.',
        });
      }
    }
    const tags = hinglishRe ? [...matches(f.text, hinglishRe)] : [];
    if (tags.length > 1) {
      add({
        check: 9, severity: 'warn', field: f.field, text: tags.map((t) => t.text).join(', '),
        rule: 'At most one Hindi tag, and only inside a quoted owner line.', fix: 'Keep the one that carries the owner\'s voice and write the rest in English.',
      });
    }
  }

  // 10. A solution line that names no tool and says "system" alone (warn).
  const toolNames = solutions.map((s) => String(s.publicName || '').toLowerCase()).filter(Boolean);
  (piece.pis?.solution || []).forEach((line, i) => {
    const l = normalise(line);
    if (!/(?<![\p{L}\p{N}])systems?(?![\p{L}\p{N}])/iu.test(l)) return;
    if (toolNames.some((t) => l.toLowerCase().includes(t))) return;
    add({
      check: 10, severity: 'warn', field: `pis.solution[${i + 1}]`, text: l,
      rule: 'A solution line names a tool from the Solutions list or says plainly what it does; never "system" alone.',
      fix: 'Say the tool: for example "The weekly score" or "The reminder desk".',
    });
  });

  // 11. The business runs by itself (block).
  const RUNS_ITSELF = /(?<![\p{L}\p{N}])(?:runs?\s+by\s+itself|runs?\s+itself|runs?\s+on\s+its\s+own|without\s+people|on\s+autopilot|assigns?\s+itself|fix(?:es)?\s+itself|sorts?\s+(?:itself|themselves)|moves?\s+by\s+(?:itself|themselves))(?![\p{L}\p{N}])/giu;
  for (const f of fields) {
    for (const m of matches(f.text, RUNS_ITSELF)) {
      add({
        check: 11, severity: 'block', field: f.field, text: m.text, start: m.index, end: m.index + m.text.length,
        rule: 'Never say or imply that the business runs by itself, on autopilot or without people. We run the system; the team still does the work.',
        fix: 'Say who does the work: "We run the system. Your team still does the work."',
      });
    }
  }

  // 12. Claims from claimsBlocked (block).
  const CLAIMS = [
    {
      re: /(?<![\p{L}\p{N}])(?:saved?|saves|saving)\s+(?:you\s+)?(?:Rs\.?\s*|₹)?\d[\d,.]*\s*(?:hours?|hrs?|lakhs?|crores?|%|rupees|days?)?|\d[\d,.]*\s*(?:hours?|hrs?)\s+(?:a\s+(?:week|day|month)\s+)?(?:saved|back|freed)/giu,
      rule: claimText(rules, /result|saving/i, 'Any result, saving, number of hours or rupees saved'),
      example: true,
    },
    {
      re: /(?<![\p{L}\p{N}])(?:used\s+by\s+(?:hundreds|thousands|\d[\d,]*)|trusted\s+by|proven|guaranteed?)(?![\p{L}\p{N}])/giu,
      rule: claimText(rules, /trusted by/i, 'Trusted by, used by hundreds, proven, guaranteed.'),
    },
    {
      re: /(?<![\p{L}\p{N}.])\d[\d,.]*\s*[kK]?\s*followers|(?<![\p{L}\p{N}])crores?(?![\p{L}\p{N}])|(?<![\p{L}\p{N}.])\d+(?:\.\d+)?\s?x(?![\p{L}\p{N}])|(?<![\p{L}\p{N}.])\d+\s+times\s+(?:more|faster|better|higher)/giu,
      rule: claimText(rules, /follower/i, 'Follower counts, crore figures or x-times figures, at any time.'),
    },
    {
      re: /(?<![\p{L}\p{N}])(?:Voltas|Panasonic|GPC|Georgia\s+Tech)(?![\p{L}\p{N}])[^.\n]{0,60}?(?<![\p{L}\p{N}])(?:clients?|customers?)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:clients?|customers?)(?![\p{L}\p{N}])[^.\n]{0,40}?(?<![\p{L}\p{N}])(?:Voltas|Panasonic|GPC)(?![\p{L}\p{N}])/giu,
      rule: claimText(rules, /Voltas/i, 'Voltas, Panasonic, GPC or Georgia Tech as clients'),
    },
    {
      re: /(?<![\p{L}\p{N}])(?:no\s*one|nobody)\s+else\s+(?:does|offers|builds)\s+(?:this|it|what\s+we\s+do)(?![\p{L}\p{N}])/giu,
      rule: claimText(rules, /no one else/i, 'No one else does this.'),
    },
  ];
  for (const c of CLAIMS) {
    for (const f of fields) {
      if (f.field.endsWith('.hashtags') || f.field.endsWith('.tags')) continue;
      for (const m of matches(f.text, c.re)) {
        if (c.example) {
          const from = Math.max(0, m.index - 60);
          const to = Math.min(f.text.length, m.index + m.text.length + 60);
          if (/example|illustrative/i.test(f.text.slice(from, to))) continue;
        }
        add({
          check: 12, severity: 'block', field: f.field, text: m.text, start: m.index, end: m.index + m.text.length,
          rule: `Claims we cannot make: ${c.rule}`, fix: 'Remove the claim, or turn it into a question for the owner.',
        });
      }
    }
  }

  // 13. An unfilled square-bracket placeholder (block). Not in the contract's twelve; the
  //     imported posts carry [your own line] brackets and these must not be posted.
  for (const f of fields) {
    for (const m of matches(f.text, /\[[^\]\n]{3,}\]/g)) {
      add({
        check: 13, severity: 'block', field: f.field, text: m.text, start: m.index, end: m.index + m.text.length,
        rule: 'Every square-bracket placeholder is filled with one true detail, or deleted, before the piece is posted.',
        fix: 'Write the true detail, or delete the line.',
      });
    }
  }

  // 14. The storyline: a piece that speaks of a system, software, a screen or a list and names
  //     no tool from the Solutions list anywhere (warn). The content audit of 30 October 2026
  //     found this in 49 of 85 imported pieces; the review pass fixed them by naming the tool.
  const toolRe = /(?<![\p{L}\p{N}])(?:systems?|software|dashboard|one screen|a list|a board|the sheet)(?![\p{L}\p{N}])/iu;
  const allText = fields.map((f) => f.text).join('\n').toLowerCase();
  const namesTool = toolNames.some((t) => t.length > 3 && allText.includes(t.replace(/^the /, '')));
  // The brief's own standing lines carry the storyline too ("We run the system. Your team still does the work.").
  const standingLine = (rules.say || []).some((s) => String(s).length > 12 && allText.includes(String(s).toLowerCase().replace(/\.$/, '')));
  const speaksOfSystem = fields.some((f) => toolRe.test(f.text));
  if (speaksOfSystem && !namesTool && !standingLine && !['greeting', 'founder'].includes(piece.pillar) && !['greeting', 'announcement'].includes(piece.type)) {
    add({
      check: 14, severity: 'warn', field: 'piece',
      rule: 'The storyline is "the tools are how we run it": a piece that speaks of a system, a screen or a list names the tool from the Solutions list somewhere in its text.',
      fix: 'Name the tool in the solution beat: the reminder desk, the owner\'s screen, My Day, the weekly score, the question tray, the step-by-step job flow.',
    });
  }

  // 15. The rupee glyph: the brief writes "Rs 20,000" (warn).
  for (const f of fields) {
    for (const m of matches(f.text, /₹\s?[\d,.]+/g)) {
      add({ check: 15, severity: 'warn', field: f.field, text: m.text, start: m.index, end: m.index + m.text.length, rule: 'Rupee amounts are written "Rs 20,000", never the rupee glyph.', fix: m.text.replace(/₹\s?/, 'Rs ') });
    }
  }

  // 16. A LinkedIn post ends with one question (warn).
  const liPost = normalise(piece.renditions?.li?.text);
  if (liPost.trim()) {
    const paras = liPost.trim().split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const last = paras.filter((p) => !/^(#\w+\s*)+$/.test(p)).pop() || '';
    const questions = (last.match(/\?/g) || []).length;
    if (!/\?\s*$/.test(last)) {
      add({ check: 16, severity: 'warn', field: 'renditions.li.text', text: last.slice(-80), rule: 'A LinkedIn post ends with one question, so the reader has something to answer.', fix: 'Move the question to the end, or add one.' });
    } else if (questions > 1) {
      add({ check: 16, severity: 'warn', field: 'renditions.li.text', text: last.slice(-120), rule: 'A LinkedIn post ends with one question, not two.', fix: 'Keep the one question the owner can answer in a line.' });
    }
  }

  // 17. A Status rule marks the phrase that shows in green (warn).
  if (piece.type === 'status-rule') {
    const st = String(piece.renditions?.waStatus?.text || '');
    if (st.trim() && !/\*[^*\n]{2,}\*/.test(st)) {
      add({ check: 17, severity: 'warn', field: 'renditions.waStatus.text', text: st.slice(0, 80), rule: 'A Status rule card marks one word or short phrase in *stars*; it shows in green on the card.', fix: 'Put *stars* around the words that carry the rule.' });
    }
  }

  // 18. Hashtags in one case across the library (warn).
  const igTags = piece.renditions?.ig?.hashtags;
  if (Array.isArray(igTags) && igTags.some((t) => /[A-Z]/.test(String(t)))) {
    add({ check: 18, severity: 'warn', field: 'renditions.ig.hashtags', text: igTags.filter((t) => /[A-Z]/.test(String(t))).join(' '), rule: 'Hashtags are written in lower case, so the channel reads as one voice.', fix: igTags.map((t) => String(t).toLowerCase()).join(' ') });
  }

  // A long case study quotes facts about its subject company (a bank guarantee, a crore turnover, a
  // line that "runs on its own clock"). In the spoken script of a youtube-long piece those are warnings
  // to check against the fact sheet, not blocks; in the hook, the title, the description and every
  // other piece type the same words stay blocks.
  if (piece.type === 'youtube-long') {
    for (const v of violations) {
      if (v.severity === 'block' && /^script\[/.test(v.field || '') && [2, 11, 12].includes(v.check)) {
        v.severity = 'warn';
        v.rule = `${v.rule} In a case-study script this is a fact about the subject company: keep its source in the fact sheet and never say it of us.`;
      }
    }
  }

  // Overlapping reports of one span keep the first (the earlier check, or the higher severity).
  const rank = { block: 2, warn: 1 };
  const kept = [];
  for (const v of violations) {
    if (v.start === undefined) { kept.push(v); continue; }
    const clash = kept.find((k) => k.field === v.field && k.start !== undefined && v.start < k.end && v.end > k.start && rank[k.severity] >= rank[v.severity]);
    if (clash) continue;
    kept.push(v);
  }
  const out = kept.map(({ start, end, ...v }) => v);
  const counts = { block: out.filter((v) => v.severity === 'block').length, warn: out.filter((v) => v.severity === 'warn').length };
  return { passed: counts.block === 0, violations: out, counts };
}

// -------------------------------------------------------------------- routes

function versionsOf(id) {
  return store.list('versions', (v) => v.pieceId === id).sort((a, b) => a.n - b.n);
}

async function addVersion(piece, by, changeNote) {
  const { check: _c, measure: _m, ...snapshot } = piece;
  const n = versionsOf(piece.id).length + 1;
  const version = {
    id: store.nextId('vr'), pieceId: piece.id, n, snapshot,
    by: by || null, at: new Date().toISOString(), changeNote: changeNote || null,
  };
  await store.put('versions', version);
  return version;
}

function eligibleForPass() {
  return store.list('pieces', (p) => p.status === 'in-review' && versionsOf(p.id).length === 1)
    .sort((a, b) => `${a.plannedDate || '9999'} ${a.id}`.localeCompare(`${b.plannedDate || '9999'} ${b.id}`));
}

async function applyRefine(pieceId, result, by) {
  const piece = store.get('pieces', pieceId);
  if (!piece) return { skipped: 'The piece no longer exists' };
  if (piece.status !== 'in-review') return { skipped: `The piece is now ${piece.status}` };
  if (versionsOf(pieceId).length !== 1) return { skipped: 'The piece was edited while the pass ran' };
  const out = result.output || {};
  const merged = { ...piece, ...(out.patch || {}) };
  const stored = await store.put('pieces', merged);
  const version = await addVersion(stored, by || 'Review pass', `Review pass: ${out.changeNote || 'revised'}`);
  await store.log(by, 'content.review-pass', { pieceId, versionId: version.id, changed: out.changedFields || [] });
  return { versionId: version.id, n: version.n, changed: out.changedFields || [], noChange: Boolean(out.noChange) };
}

function watchJob(job, pieceIds, by) {
  job.pieceIds = pieceIds;
  job.applied = pieceIds.map(() => null);
  const done = new Set();
  const tick = async () => {
    for (let i = 0; i < pieceIds.length; i++) {
      const r = job.results[i];
      if (!r || done.has(i)) continue;
      done.add(i);
      if (!r.ok) { job.applied[i] = { skipped: r.error }; continue; }
      try { job.applied[i] = await applyRefine(pieceIds[i], r, by); }
      catch (err) { job.applied[i] = { skipped: err.message }; }
    }
    if (done.size < pieceIds.length) setTimeout(tick, 1000);
    else job.appliedAt = new Date().toISOString();
  };
  setTimeout(tick, 1000);
}

async function promptFor(op, input, ctx) {
  const mod = await loadOp(op);
  const context = buildCtx({ by: ctx.by });
  const prompt = mod.buildPrompt(input || {}, context);
  return { op, system: prompt.system, user: prompt.user, schema: mod.schema, dryRun: true };
}

/** One line per piece for lists: how its last check stands. */
export function checkState(piece) {
  const c = piece?.check;
  if (!c || !Array.isArray(c.violations)) return { state: 'unchecked', blocks: 0, warns: 0, at: null };
  const blocks = c.violations.filter((v) => v.severity === 'block').length;
  const warns = c.violations.length - blocks;
  return { state: blocks ? 'blocked' : warns ? 'warned' : 'passed', blocks, warns, at: c.at || null };
}

/** Today: the pieces whose last stored check blocks approval. */
export async function enrichToday(payload) {
  const blocked = store.list('pieces', (p) => p.status !== 'retired' && checkState(p).state === 'blocked')
    .map((p) => ({ id: p.id, hook: p.hook, type: p.type, status: p.status, plannedDate: p.plannedDate || null, blocks: checkState(p).blocks, warns: checkState(p).warns }))
    .sort((a, b) => `${a.plannedDate || '9999'} ${a.id}`.localeCompare(`${b.plannedDate || '9999'} ${b.id}`));
  const unchecked = store.list('pieces', (p) => p.status !== 'retired' && checkState(p).state === 'unchecked').length;
  // The storyline in the content: solution lines that name a tool against those that still say "system" alone.
  const live = store.list('pieces', (p) => p.status !== 'retired');
  const solutions = store.list('solutions').map((s) => String(s.publicName || '').toLowerCase().replace(/^the /, '')).filter(Boolean);
  const textOf = (p) => JSON.stringify([p.hook, p.pis, p.renditions, p.script, p.slides]).toLowerCase();
  const namesOne = (t) => solutions.some((s) => s.length > 3 && t.includes(s));
  const namesTool = live.filter((p) => namesOne(textOf(p))).length;
  const systemAlone = live.filter((p) => { const t = textOf(p); return /\bsystems?\b/.test(t) && !namesOne(t); }).length;
  payload.checker = { blocked, unchecked, storyline: { pieces: live.length, namesTool, systemAlone } };
}

export const routes = [
  {
    // The code defaults of the editable checker lists, shown in Builder when the rules document has none.
    method: 'GET',
    path: '/api/checker/defaults',
    handler: () => ({ ...CHECKER_LIST_DEFAULTS }),
  },
  {
    method: 'POST',
    path: '/api/content/check-all',
    handler: async (ctx) => {
      const accounts = ctx.store.list('accounts');
      const rules = ctx.rules();
      const pieces = ctx.store.list('pieces', (p) => p.status !== 'retired');
      const at = new Date().toISOString();
      const summary = { checked: 0, blocked: 0, warned: 0, passed: 0, blockedIds: [] };
      for (const piece of pieces) {
        const result = check(piece, rules, accounts);
        await ctx.store.patch('pieces', piece.id, { check: { at, ...result } });
        const st = checkState({ check: result });
        summary.checked += 1;
        summary[st.state] += 1;
        if (st.state === 'blocked') summary.blockedIds.push(piece.id);
      }
      await ctx.store.log(ctx.by, 'content.check-all', { checked: summary.checked, blocked: summary.blocked });
      return { at, ...summary };
    },
  },
  {
    method: 'POST',
    path: '/api/pieces/:id/check',
    handler: async (ctx) => {
      const draft = ctx.body?.piece;
      const accounts = ctx.store.list('accounts');
      if (draft && typeof draft === 'object') {
        const result = check(draft, ctx.rules(), accounts);
        return { at: new Date().toISOString(), stored: false, ...result };
      }
      const piece = ctx.store.get('pieces', ctx.params.id);
      if (!piece) throw new ctx.HttpError(404, 'Piece not found');
      const result = check(piece, ctx.rules(), accounts);
      const record = { at: new Date().toISOString(), ...result };
      await ctx.store.patch('pieces', piece.id, { check: record });
      return record;
    },
  },
  {
    method: 'GET',
    path: '/api/content/review-pass',
    handler: async () => {
      const list = eligibleForPass();
      return { total: list.length, pieces: list.map((p) => ({ id: p.id, hook: p.hook, type: p.type })) };
    },
  },
  {
    method: 'POST',
    path: '/api/content/review-pass',
    handler: async (ctx) => {
      let pieces = eligibleForPass();
      const only = Array.isArray(ctx.body?.ids) ? ctx.body.ids : null;
      if (only) pieces = pieces.filter((p) => only.includes(p.id));
      if (ctx.body?.limit) pieces = pieces.slice(0, Number(ctx.body.limit));
      if (!pieces.length) return { jobId: null, total: 0, message: 'No piece is waiting for the review pass.' };
      const instruction = standingInstruction(ctx.rules());
      // handOutputs: { pieceId: output } written by hand in the refine schema; used as the answer for that piece.
      const hand = ctx.body?.handOutputs && typeof ctx.body.handOutputs === 'object' ? ctx.body.handOutputs : {};
      const inputs = pieces.map((p) => ({ piece: textView(p), instruction, standing: true, ...(hand[p.id] ? { handOutput: hand[p.id] } : {}) }));
      if (ctx.body?.dryRun) {
        const first = await promptFor('refine', inputs[0], ctx);
        return { dryRun: true, total: inputs.length, pieceIds: pieces.map((p) => p.id), instruction, firstPrompt: first };
      }
      const job = ctx.ai.createJob('refine', inputs, ctx.by);
      watchJob(job, pieces.map((p) => p.id), ctx.by);
      await ctx.store.log(ctx.by, 'content.review-pass.queue', { jobId: job.id, total: inputs.length });
      return { jobId: job.id, total: inputs.length, pieceIds: pieces.map((p) => p.id), status: job.status };
    },
  },
  {
    method: 'GET',
    path: '/api/content/review-pass/:jobId',
    handler: async (ctx) => {
      const job = ctx.ai.getJob(ctx.params.jobId);
      if (!job) throw new ctx.HttpError(404, 'Job not found');
      const items = (job.pieceIds || []).map((id, i) => ({
        pieceId: id,
        ok: job.results[i] ? job.results[i].ok : null,
        error: job.results[i] && !job.results[i].ok ? job.results[i].error : null,
        applied: job.applied?.[i] || null,
      }));
      return { id: job.id, status: job.status, total: job.total, done: job.done, items, appliedAt: job.appliedAt || null };
    },
  },
  {
    method: 'POST',
    path: '/api/content/prompt/:op',
    handler: async (ctx) => promptFor(ctx.params.op, ctx.body?.input || ctx.body || {}, ctx),
  },
  {
    method: 'GET',
    path: '/api/content/prompt/:op',
    handler: async (ctx) => {
      let input = {};
      if (ctx.query.input) {
        try { input = JSON.parse(ctx.query.input); } catch { throw new ctx.HttpError(400, 'input must be JSON'); }
      }
      if (ctx.query.pieceId) {
        const piece = ctx.store.get('pieces', ctx.query.pieceId);
        if (!piece) throw new ctx.HttpError(404, 'Piece not found');
        input.piece = piece;
        if (!input.pis && piece.pis) input.pis = piece.pis;
        if (!input.type) input.type = piece.type;
        if (!input.targets) input.targets = piece.targets;
      }
      for (const k of ['moment', 'pillar', 'sector', 'type', 'instruction']) if (ctx.query[k] && input[k] === undefined) input[k] = ctx.query[k];
      if (ctx.query.targets && !input.targets) input.targets = ctx.query.targets.split(',');
      return promptFor(ctx.params.op, input, ctx);
    },
  },
];

// Exposed for the module's own tests.
export const _internal = { applyRefine, watchJob, eligibleForPass };
