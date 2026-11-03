// Content: the piece editor (#/content/:id) and the helpers the library and the
// review queue share. [content]
//
// Three columns on a laptop, stacked on a phone. Left: the piece. Middle: the
// renditions per target account with live previews. Right: the checker, the
// versions and the AI panel. The deterministic checker runs on the working copy
// through POST /api/pieces/:id/check, debounced, and Approve stays disabled
// while a block stands.
//
// `#/content/new?type=&date=&time=&targets=a,b&slotId=` opens a blank, unsaved
// piece (the calendar uses it for "Create new" on a slot).

import { api } from '../api.js';
import { roleOf, me as whoAmI } from '../roles.js';
import {
  el, card, field, input, textarea, select, button, chip, statusPill, dialog, toast, tabs, empty, fmt, icon, preview,
} from '../ui.js';

export const route = '#/content/:id';
export const title = (params) => (params?.id === 'new' ? 'New piece' : 'Piece');

// ------------------------------------------------------------ shared data

export const TYPES = [
  ['reel-animated', 'Animated reel'], ['episode', 'Episode'], ['carousel', 'Carousel'], ['broll', 'B-roll video'],
  ['linkedin-text', 'LinkedIn post'], ['linkedin-carousel', 'LinkedIn carousel'], ['status-rule', 'Status rule'], ['greeting', 'Greeting'],
  ['wa-note', 'Monthly note'], ['youtube-long', 'YouTube long video'], ['youtube-short', 'YouTube Short'], ['field-story', 'Field story'],
  ['announcement', 'Announcement'], ['image-post', 'Image post'],
].map(([value, label]) => ({ value, label }));
export const PILLARS = [
  ['problem', 'Problem'], ['science', 'Science'], ['glimpse', 'Glimpse'], ['offer', 'Offer'], ['founder', 'Founder'],
  ['greeting', 'Greeting'], ['announcement', 'Announcement'],
].map(([value, label]) => ({ value, label }));
export const STATUSES = ['idea', 'draft', 'in-review', 'director-review', 'changes-requested', 'approved', 'scheduled', 'posted', 'measured', 'retired'];
/** The statuses that wait for a review: with the manager, or with the director. */
export const AWAITING_REVIEW = ['in-review', 'director-review'];
/** The statuses from which a piece may be submitted for review. */
export const SUBMITTABLE = ['idea', 'draft', 'changes-requested'];
export const STATUS_LABEL = { 'in-review': 'In review', 'director-review': 'With the director', 'changes-requested': 'Changes requested' };
export const statusLabel = (s) => STATUS_LABEL[s] || (String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1));
export const typeLabel = (t) => TYPES.find((x) => x.value === t)?.label || t || '';
export const pillarLabel = (p) => PILLARS.find((x) => x.value === p)?.label || p || '';

export const TARGET_RENDITION = {
  'vd-ig': 'ig', 'p-ig': 'ig', 'vd-fb': 'fb', 'p-fb': 'fb', yt: 'yt', 'vd-li': 'liCo', 'p-li': 'li', 'wa-st': 'waStatus', fam: 'waStatus', 'wa-note': 'waNote',
};
export const RENDITION_LABEL = { ig: 'Instagram', li: 'LinkedIn', liCo: 'LinkedIn page', fb: 'Facebook', waStatus: 'WhatsApp Status', waNote: 'WhatsApp note', yt: 'YouTube' };
const RENDITION_ORDER = ['ig', 'li', 'liCo', 'fb', 'waStatus', 'waNote', 'yt'];
const DEFAULT_TARGETS = {
  'reel-animated': ['vd-ig'], episode: ['vd-ig'], carousel: ['vd-ig'], broll: ['vd-ig'], 'image-post': ['vd-ig'],
  'linkedin-text': ['p-li'], 'linkedin-carousel': ['p-li'], 'field-story': ['p-li'], announcement: ['p-li'],
  'status-rule': ['wa-st'], greeting: ['wa-st'], 'wa-note': ['wa-note'], 'youtube-long': ['yt'], 'youtube-short': ['yt'],
};
export const defaultTargets = (type) => [...(DEFAULT_TARGETS[type] || ['vd-ig'])];
const SCRIPT_TYPES = ['broll', 'youtube-long'];
const SLIDE_TYPES = ['carousel', 'linkedin-carousel'];

/** True when a rendition carries any text. An empty one does not count as a form of the piece. */
export function renditionHasText(key, r) {
  if (!r) return false;
  if (key === 'ig') return Boolean(String(r.caption || '').trim() || (r.hashtags || []).length || String(r.firstComment || '').trim());
  if (key === 'yt') return Boolean(String(r.title || '').trim() || String(r.description || '').trim());
  return Boolean(String(r.text || '').trim() || String(r.firstComment || '').trim());
}

export function renditionKeys(piece) {
  const keys = new Set();
  for (const t of piece.targets || []) if (TARGET_RENDITION[t]) keys.add(TARGET_RENDITION[t]);
  for (const [k, r] of Object.entries(piece.renditions || {})) if (renditionHasText(k, r)) keys.add(k);
  return RENDITION_ORDER.filter((k) => keys.has(k));
}

/** The card-maker template that fits a piece type, for the Visuals card. */
export const TEMPLATE_FOR_TYPE = {
  broll: 'the hook card, as the Reel cover', 'reel-animated': 'the hook card, as the Reel cover', episode: 'the hook card, as the Reel cover', 'youtube-short': 'the hook card, as the Short cover',
  'status-rule': 'the Status rule card', greeting: 'the Status rule card', carousel: 'the carousel slides', 'linkedin-carousel': 'the carousel slides',
  'youtube-long': 'the YouTube thumbnail', 'youtube-short': 'the YouTube thumbnail', 'linkedin-text': 'the LinkedIn image', 'field-story': 'the LinkedIn image',
  announcement: 'the LinkedIn image', 'image-post': 'the hook card', 'wa-note': 'the quote card',
};
const TYPE_HINT = {
  'reel-animated': 'Rendered on the Mac from the animation files; Studio keeps the text and the rendered file. For a new video, choose B-roll video and write the say-and-sees script.',
  episode: 'Rendered on the Mac from the animation files; Studio keeps the text and the rendered file. For a new video, choose B-roll video and write the say-and-sees script.',
  broll: 'A filmed Reel: write what is said and what the viewer sees, row by row, in the say-and-sees table below.',
  carousel: 'Seven slides in the kit\'s four slide types; the pictures are made from them in Visuals.',
  'status-rule': 'One line for WhatsApp Status; the card is made from it in Visuals.',
};

export function ensureStyles() {
  if (document.getElementById('content-css')) return;
  document.head.appendChild(el('link', { id: 'content-css', rel: 'stylesheet', href: 'css/content.css' }));
}

let refsCache = null;
export async function loadRefs(force = false) {
  if (refsCache && !force && Date.now() - refsCache.at < 20000) return refsCache.value;
  const [accounts, rules, settings, campaigns, solutions] = await Promise.all([
    api.get('/accounts'), api.rules(), api.settings(), api.get('/campaigns').catch(() => []), api.get('/solutions').catch(() => []),
  ]);
  const value = { accounts, rules, settings, campaigns, solutions };
  refsCache = { at: Date.now(), value };
  return value;
}

/** The chosen user's role from the settings users (roles.me() is the server's answer; this is the synchronous one). */
export function roleIn(settings) {
  const who = (api.user.get() || '').toLowerCase();
  const u = who ? (settings?.users || []).find((x) => String(x.email).toLowerCase() === who) : null;
  return u ? roleOf(u) : null;
}
/** An approver is a manager or the director (docs/ROLES.md). */
export function isApprover(settings) { const r = roleIn(settings); return r === 'manager' || r === 'director'; }
export function isDirector(settings) { return roleIn(settings) === 'director'; }

// ----------------------------------------------------------- review routing
// settings.reviewRouting decides which pieces must reach the director. The server
// decorates queue pieces with needsDirector; directorRoute() works it out here
// for a piece that came without it.
export const ROUTING_DEFAULTS = { directorTypes: ['youtube-long', 'episode', 'announcement'], directorPillars: ['offer', 'founder'], directorOnWarnings: false };
export function routingOf(settings) {
  const r = settings?.reviewRouting || {};
  return {
    directorTypes: Array.isArray(r.directorTypes) ? r.directorTypes : ROUTING_DEFAULTS.directorTypes,
    directorPillars: Array.isArray(r.directorPillars) ? r.directorPillars : ROUTING_DEFAULTS.directorPillars,
    directorOnWarnings: typeof r.directorOnWarnings === 'boolean' ? r.directorOnWarnings : ROUTING_DEFAULTS.directorOnWarnings,
  };
}
const TYPE_PLURAL = { 'youtube-long': 'Long YouTube videos', episode: 'Episodes', announcement: 'Announcements' };
/** { needsDirector, why } for a piece, from the server's decoration or from the routing. */
export function directorRoute(piece, settings, check) {
  if (typeof piece?.needsDirector === 'boolean') return { needsDirector: piece.needsDirector, why: piece.needsDirectorWhy || '' };
  const r = routingOf(settings);
  if (r.directorTypes.includes(piece?.type)) return { needsDirector: true, why: `${TYPE_PLURAL[piece.type] || `Pieces of the type ${typeLabel(piece.type)}`} go to the director` };
  if (r.directorPillars.includes(piece?.pillar)) return { needsDirector: true, why: `Pieces on the ${pillarLabel(piece.pillar).toLowerCase()} pillar go to the director` };
  const v = (check || piece?.check)?.violations;
  if (r.directorOnWarnings && Array.isArray(v) && v.some((x) => x.severity === 'warn')) return { needsDirector: true, why: 'Pieces with a checker warning go to the director' };
  return { needsDirector: false, why: '' };
}

const TRAIL_ACTION = { submitted: 'Submitted for review', approved: 'Approved', escalated: 'Sent to the director', 'changes-requested': 'Changes requested', returned: 'Returned to the manager' };
const ROLE_WORD = { employee: 'Employee', manager: 'Manager', director: 'Director' };
/** The review trail as a compact list, newest first: date, name, role, action, note. */
export function trailList(trail, settings) {
  const list = Array.isArray(trail) ? trail : [];
  if (!list.length) return el('p', { class: 'note', text: 'No review steps yet. The trail starts when the piece is submitted for review.' });
  const nameOf = (by) => (settings?.users || []).find((u) => String(u.email).toLowerCase() === String(by || '').toLowerCase())?.name || by || 'unknown';
  return el('ul', { class: 'ct-trail' }, [...list].reverse().map((t) => el('li', {}, [
    el('div', { class: 'ct-ver-top' }, [
      el('b', { text: TRAIL_ACTION[t.action] || t.action }),
      el('span', { class: 'ct-ver-meta', text: `${nameOf(t.by)}${t.role ? `, ${ROLE_WORD[t.role] || t.role}` : ''} · ${fmt.dateTime(t.at)}` }),
    ]),
    t.note ? el('div', { class: 'ct-ver-note', text: t.note }) : null,
  ])));
}

/** A note dialog for the review steps that need one. Resolves on send; onSend may throw to keep it open. */
export function noteDialog({ title, label = 'Note', placeholder = '', sendLabel = 'Send', intro, onSend }) {
  const note = textarea({ rows: 4, placeholder });
  let d;
  d = dialog({
    title,
    body: [intro ? el('p', { class: 'note', text: intro }) : null, field({ label, input: note })],
    actions: [
      button({ label: 'Cancel', onClick: () => d.close() }),
      button({ kind: 'primary', label: sendLabel, onClick: async (e) => {
        const v = note.value.trim();
        if (!v) { toast('A note is required', 'warn'); return; }
        const btn = e.currentTarget; btn.disabled = true;
        try { await onSend(v); d.close(); } catch (err) { toast(err.message, 'bad'); btn.disabled = false; }
      } }),
    ],
  });
  setTimeout(() => note.focus(), 50);
  return d;
}

/**
 * A confirmation dialog. ui.confirm resolves false when its own button closes the
 * dialog (onClose fires before the answer), so the content views use this one.
 */
export function ask({ title = 'Please confirm', message, confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const d = dialog({
      title,
      body: el('p', { text: message || '' }),
      actions: [
        button({ label: 'Cancel', onClick: () => { finish(false); d.close(); } }),
        button({ kind: danger ? 'danger' : 'primary', label: confirmLabel, onClick: () => { finish(true); d.close(); } }),
      ],
      onClose: () => finish(false),
    });
  });
}

export function aiFailed(err) {
  const msg = String(err?.message || 'The request failed').replace(/\.+$/, '');
  if (err?.status === 502 || /login|authenticate|oauth|session expired|claude/i.test(msg)) {
    toast('Claude is not signed in on this Mac, so the AI step could not run. Ask Palak to run claude and /login in a terminal. The piece can still be written by hand.', 'bad', { ms: 10000 });
    return;
  }
  if (err?.status === 504) { toast('Claude took too long to answer. Try once more; if it fails again, write the piece by hand.', 'bad', { ms: 9000 }); return; }
  toast(`${msg}.`, 'bad', { ms: 9000 });
}

export const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };
/** A field whose label is a node (for a live counter beside the label). */
function fieldNode(labelNode, control, hint) {
  return el('label', { class: 'field' }, [el('span', { class: 'field-label' }, labelNode), control, hint && el('span', { class: 'field-hint', text: hint })]);
}
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const wordCount = (s) => String(s || '').replace(/\*/g, '').split(/\s+/).filter(Boolean).length;
const linesToList = (t) => String(t || '').split('\n').map((s) => s.trim()).filter(Boolean);
const tagsToList = (t) => String(t || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).map((s) => (s.startsWith('#') ? s : `#${s}`));

// ---------------------------------------------------------------- checker UI

export function violationList(violations = []) {
  if (!violations.length) return el('p', { class: 'ct-ok', text: 'Nothing to report.' });
  const ul = el('ul', { class: 'ct-viols' });
  for (const v of violations) {
    ul.appendChild(el('li', { class: `ct-viol ${v.severity === 'block' ? 'block' : ''}` }, [
      el('div', { class: 'ct-viol-top' }, [
        chip({ label: v.severity === 'block' ? 'Block' : 'Warning', tone: v.severity === 'block' ? 'bad' : 'warn' }),
        v.source === 'ai' && chip({ label: 'AI', tone: 'muted' }),
        el('span', { class: 'ct-viol-field', text: v.field || '' }),
      ]),
      v.text && el('div', { class: 'ct-viol-text', text: `“${v.text}”` }),
      el('div', { class: 'ct-viol-rule', text: v.rule }),
      v.fix && el('div', { class: 'ct-viol-fix', text: `Fix: ${v.fix}` }),
    ]));
  }
  return ul;
}

export function checkSummary(check) {
  if (!check) return el('div', { class: 'ct-sum' }, chip({ label: 'Not checked yet', tone: 'muted' }));
  const b = check.violations.filter((v) => v.severity === 'block').length;
  const w = check.violations.length - b;
  return el('div', { class: 'ct-sum' }, [
    b ? chip({ label: `${b} blocking`, tone: 'bad' }) : chip({ label: 'No blocking items', tone: 'ok' }),
    w ? chip({ label: `${w} ${w === 1 ? 'warning' : 'warnings'}`, tone: 'warn' }) : null,
  ]);
}

// -------------------------------------------------------------- comparison

function tokens(s) { return String(s || '').split(/(\s+)/).filter((x) => x !== ''); }

function diffOps(a, b) {
  const A = tokens(a); const B = tokens(b);
  if (A.length > 2400 || B.length > 2400) return [{ t: 'del', v: String(a) }, { t: 'add', v: String(b) }];
  const n = A.length; const m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = []; let i = 0; let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push({ t: 'eq', v: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ t: 'del', v: A[i++] });
    else ops.push({ t: 'add', v: B[j++] });
  }
  while (i < n) ops.push({ t: 'del', v: A[i++] });
  while (j < m) ops.push({ t: 'add', v: B[j++] });
  return ops;
}

/** Readable text blocks of a piece: [{ key, label, text }]. */
export function textBlocks(piece = {}) {
  const out = [];
  const push = (key, label, text) => { if (text !== undefined && text !== null && String(text).trim() !== '') out.push({ key, label, text: String(text) }); };
  push('hook', 'Hook', piece.hook);
  const p = piece.pis || {};
  push('pis.problem', 'Problem', p.problem);
  push('pis.impact', 'Impact', p.impact);
  push('pis.solution', 'Solution', (Array.isArray(p.solution) ? p.solution : [p.solution]).filter(Boolean).join('\n'));
  push('pis.close', 'Close', p.close);
  const r = piece.renditions || {};
  if (r.ig) {
    push('ig.caption', 'Instagram caption', r.ig.caption);
    push('ig.hashtags', 'Instagram hashtags', (r.ig.hashtags || []).join(' '));
    push('ig.firstComment', 'Instagram first comment', r.ig.firstComment);
  }
  if (r.li) { push('li.text', 'LinkedIn post', r.li.text); push('li.firstComment', 'LinkedIn first comment', r.li.firstComment); }
  if (r.liCo) push('liCo.text', 'LinkedIn page line', r.liCo.text);
  if (r.fb) push('fb.text', 'Facebook text', r.fb.text);
  if (r.waStatus) push('waStatus.text', 'WhatsApp Status', r.waStatus.text);
  if (r.waNote) push('waNote.text', 'WhatsApp note', r.waNote.text);
  if (r.yt) { push('yt.title', 'YouTube title', r.yt.title); push('yt.description', 'YouTube description', r.yt.description); push('yt.tags', 'YouTube tags', (r.yt.tags || []).join(', ')); }
  if (piece.script?.length) push('script', 'Script (what you say)', piece.script.map((row, i) => `${i + 1}. ${row.say || '(end card)'}  [${row.sees || ''}]`).join('\n'));
  if (piece.slides?.length) {
    push('slides', 'Slides', piece.slides.map((s, i) => `${i + 1}. ${[s.eyebrow, s.head, s.body, (s.items || []).join('; '), s.foot].filter(Boolean).join(' | ')}`).join('\n'));
  }
  push('notes', 'Notes', piece.notes);
  return out;
}

/** Side by side, changed blocks first; unchanged blocks folded away. */
export function compareView(original, current, { leftTitle = 'Original', rightTitle = 'Current' } = {}) {
  const a = new Map(textBlocks(original).map((b) => [b.key, b]));
  const b = new Map(textBlocks(current).map((x) => [x.key, x]));
  const keys = [...new Set([...b.keys(), ...a.keys()])];
  const wrap = el('div', { class: 'ct-cmp' });
  const same = [];
  for (const k of keys) {
    const L = a.get(k); const R = b.get(k);
    const label = (R || L).label;
    if (L && R && L.text === R.text) { same.push(label); continue; }
    const ops = diffOps(L?.text || '', R?.text || '');
    const left = el('div', { class: 'ct-cmp-col' }, [el('span', { class: 'ct-cmp-head', text: leftTitle })]);
    const right = el('div', { class: 'ct-cmp-col' }, [el('span', { class: 'ct-cmp-head', text: rightTitle })]);
    for (const o of ops) {
      if (o.t === 'eq') { left.appendChild(document.createTextNode(o.v)); right.appendChild(document.createTextNode(o.v)); }
      else if (o.t === 'del') left.appendChild(el('del', { text: o.v }));
      else right.appendChild(el('ins', { text: o.v }));
    }
    wrap.appendChild(el('div', { class: 'ct-cmp-block' }, [el('div', { class: 'ct-cmp-label', text: label }), el('div', { class: 'ct-cmp-cols' }, [left, right])]));
  }
  if (!wrap.children.length) wrap.appendChild(el('p', { class: 'note', text: 'The two versions carry the same text.' }));
  if (same.length) wrap.appendChild(el('details', {}, [el('summary', { text: `Unchanged: ${same.join(', ')}` })]));
  return wrap;
}

// ----------------------------------------------------------------- previews

export function previewNode(piece, key) {
  if (key === 'ig') return preview.instagram(piece);
  if (key === 'li') return preview.linkedin(piece);
  if (key === 'waStatus') return preview.status(piece);
  if (key === 'yt') return preview.youtube(piece);
  const r = piece.renditions?.[key] || {};
  const text = r.text || '';
  if (key === 'liCo') return preview.linkedin({ ...piece, renditions: { li: { text } } });
  return el('div', { class: `pe-textprev${key === 'waNote' ? ' wa' : ''}` }, [
    el('div', { class: 'pe-textprev-label', text: RENDITION_LABEL[key] || key }),
    el('div', { class: 'pe-textprev-body', text: text || 'Nothing written yet.' }),
    el('div', { class: 'preview-meta', style: { padding: '8px 0 0' } }, [el('span', { class: 'mono', text: String(text.length) }), ' characters']),
  ]);
}

export function mediaOf(piece) {
  const assets = piece.assets || [];
  return {
    videos: assets.filter((a) => a.kind === 'video' && a.path),
    images: assets.filter((a) => ['image', 'cover'].includes(a.kind) && a.path),
    pdfs: assets.filter((a) => a.kind === 'pdf' && a.path),
  };
}

// ------------------------------------------------------------------ the view

export async function render(container, params) {
  ensureStyles();
  container.appendChild(el('div', { class: 'loading', text: 'Loading the piece' }));
  const isNew = params.id === 'new';
  let refs;
  let who;
  let piece;
  let versions = [];
  try {
    [refs, who] = await Promise.all([loadRefs(), whoAmI()]);
    if (isNew) {
      const q = params.query || {};
      const type = q.type || 'reel-animated';
      piece = {
        type, pillar: q.pillar || 'problem', status: 'draft', hook: '',
        pis: { problem: '', impact: '', solution: [], close: '' }, renditions: {}, assets: [], tags: [],
        targets: q.targets ? q.targets.split(',').filter(Boolean) : defaultTargets(type),
      };
      if (q.date) piece.plannedDate = q.date;
      if (q.time) piece.plannedTime = q.time;
    } else {
      piece = await api.get(`/pieces/${encodeURIComponent(params.id)}`);
      versions = await api.get(`/pieces/${encodeURIComponent(params.id)}/versions`);
    }
  } catch (err) {
    container.replaceChildren(el('div', { class: 'banner banner-bad', text: `Could not load the piece: ${err.message}` }));
    return;
  }
  container.replaceChildren();
  delete piece._version;
  piece.pis ||= { problem: '', impact: '', solution: [], close: '' };
  piece.renditions ||= {};
  piece.assets ||= [];
  piece.tags ||= [];
  piece.targets ||= [];

  // The role decides the review controls (docs/ROLES.md section 4); the server enforces them.
  const role = who?.role || roleIn(refs.settings);
  const can = who?.can || {};
  const approver = Boolean(can.approve);
  const director = role === 'director';
  const nameOf = (by) => (refs.settings?.users || []).find((u) => String(u.email).toLowerCase() === String(by || '').toLowerCase())?.name || by || '';
  // A 409 from approve names the route for certain; until then it is worked out from the routing.
  let forcedRoute = null;
  const routeNow = () => forcedRoute || directorRoute(piece, refs.settings, check);
  const limits = refs.rules?.limits || {};
  const slotId = params.query?.slotId || null;
  let savedJson = isNew ? '' : JSON.stringify(piece);
  let check = piece.check || null;
  let aiCheck = null;
  let activeKey = null;
  let readOnly = piece.status === 'approved';
  let disposed = false;

  const eyebrow = document.getElementById('page-eyebrow');
  const heading = document.getElementById('page-title');
  const setHeading = () => {
    if (eyebrow) eyebrow.textContent = `Content · ${typeLabel(piece.type)}${piece.id ? ` · ${piece.id}` : ''}`;
    if (heading) heading.textContent = piece.hook || (isNew ? 'New piece' : piece.id);
  };
  setHeading();

  // ---- hosts
  const leftHost = el('div', { class: 'pe-col' });
  const midHost = el('div', { class: 'pe-col' });
  const rightHost = el('div', { class: 'pe-col pe-col-right' });
  const leftSet = el('fieldset', { class: 'pe-fieldset' }, leftHost);
  const midSet = el('fieldset', { class: 'pe-fieldset' }, midHost);
  const bannerHost = el('div');
  const barHost = el('div');
  const wideHost = el('div', { class: 'pe-col' });
  const wideSet = el('fieldset', { class: 'pe-fieldset pe-wide' }, wideHost);
  const grid = el('div', { class: 'pe-grid' }, [leftSet, midSet, wideSet, rightHost]);
  container.append(bannerHost, grid, barHost, el('div', { class: 'pe-pad' }));
  const applyReadOnly = () => { leftSet.disabled = readOnly; midSet.disabled = readOnly; wideSet.disabled = readOnly; };

  // ---- dirty, checker
  const isDirty = () => JSON.stringify(piece) !== savedJson;
  let checkSeq = 0;
  const runCheck = async () => {
    const seq = ++checkSeq;
    try {
      const res = await api.post(`/pieces/${encodeURIComponent(isNew ? 'new' : piece.id)}/check`, { piece });
      if (seq !== checkSeq || disposed) return;
      check = res;
      drawChecker();
      drawBar();
    } catch (err) {
      if (!disposed) { check = null; drawChecker(`The checker could not run: ${err.message}`); }
    }
  };
  const checkSoon = debounce(runCheck, 600);
  const changed = () => { checkSoon(); drawBar(); };

  // ================================================================== LEFT
  function drawLeft() {
    leftHost.replaceChildren(pieceCard(), pisCard(), assetsCard());
    const wide = [];
    if (SCRIPT_TYPES.includes(piece.type) || piece.script?.length) wide.push(scriptCard());
    if (SLIDE_TYPES.includes(piece.type) || piece.slides?.length) wide.push(slidesCard());
    wideHost.replaceChildren(...wide);
    wideSet.style.display = wide.length ? '' : 'none';
  }

  function pieceCard() {
    const hookLimit = limits.hookWords ?? 8;
    const counter = el('span', { class: 'pe-word' });
    const updateCounter = () => {
      const n = wordCount(piece.hook);
      counter.textContent = `${n} / ${hookLimit} words`;
      counter.classList.toggle('over', n > hookLimit);
    };
    updateCounter();
    const hook = input({ value: piece.hook || '', placeholder: 'The first line the owner reads', onInput: (e) => { piece.hook = e.target.value; updateCounter(); setHeading(); refreshPreview(); changed(); } });
    const typeHint = el('span', { class: 'field-hint', text: TYPE_HINT[piece.type] || '' });
    const typeSel = select({ options: TYPES, value: piece.type, onChange: (e) => {
      const before = defaultTargets(piece.type);
      piece.type = e.target.value;
      // Targets follow the type while they are still the previous type's defaults.
      const stillDefault = piece.targets.length === before.length && before.every((t) => piece.targets.includes(t));
      if (!piece.targets.length || stillDefault) piece.targets = defaultTargets(piece.type);
      setHeading(); drawLeft(); drawMiddle(); changed();
    } });
    const pillar = select({ options: PILLARS, value: piece.pillar || 'problem', onChange: (e) => { piece.pillar = e.target.value; changed(); } });
    const camp = select({
      options: [{ value: '', label: 'No campaign' }, ...(refs.campaigns || []).map((c) => ({ value: c.id, label: c.name || c.id }))],
      value: piece.campaignId || '', onChange: (e) => { piece.campaignId = e.target.value || undefined; changed(); },
    });
    const tags = input({ value: (piece.tags || []).join(', '), placeholder: 'Comma separated', onInput: (e) => { piece.tags = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); changed(); } });
    const notes = textarea({ value: piece.notes || '', placeholder: 'Anything the next person should know', onInput: (e) => { piece.notes = e.target.value; changed(); } });

    const groups = {};
    for (const a of refs.accounts) (groups[a.group || 'Other'] ||= []).push(a);
    const targetsBox = el('div', { class: 'pe-targets' });
    for (const [g, list] of Object.entries(groups)) {
      const row = el('div', { class: 'pe-target-group' }, [el('span', { class: 'eyebrow', text: g })]);
      for (const a of list) {
        const on = piece.targets.includes(a.id);
        const b = el('button', { type: 'button', class: `chip pe-target${on ? ' on' : ''}`, 'aria-pressed': String(on), title: a.role || a.label, text: a.short || a.id });
        b.addEventListener('click', () => {
          const i = piece.targets.indexOf(a.id);
          if (i >= 0) piece.targets.splice(i, 1); else piece.targets.push(a.id);
          b.classList.toggle('on', i < 0);
          b.setAttribute('aria-pressed', String(i < 0));
          drawMiddle();
          changed();
        });
        row.appendChild(b);
      }
      targetsBox.appendChild(row);
    }

    const planned = piece.plannedDate
      ? el('div', { class: 'pe-planned' }, [`${fmt.weekday(piece.plannedDate)} ${fmt.date(piece.plannedDate)}`, piece.plannedTime ? ` at ${piece.plannedTime}` : '',
        ' ', el('a', { href: `#/calendar/${piece.plannedDate.slice(0, 7)}`, text: 'Open in the calendar' })])
      : el('div', { class: 'note', text: 'Not placed in the calendar yet.' });

    return card({
      title: 'The piece',
      body: [
        el('div', { class: 'form-grid' }, [field({ label: 'Type', input: typeSel, hint: TYPE_HINT[piece.type] || '' }), field({ label: 'Pillar', input: pillar })]),
        fieldNode(['Hook ', counter], hook),
        el('div', { class: 'pe-sub', text: 'Goes to' }), targetsBox,
        el('div', { class: 'pe-sub', text: 'Planned' }), planned,
        el('div', { class: 'pe-sub', text: 'Filing' }),
        el('div', { class: 'form-grid' }, [field({ label: 'Tags', input: tags }), field({ label: 'Campaign', input: camp })]),
        field({ label: 'Notes', input: notes }),
      ],
    });
  }

  function pisCard() {
    const p = piece.pis;
    const mk = (label, key, rows = 3) => field({
      label, input: textarea({ value: p[key] || '', rows, onInput: (e) => { p[key] = e.target.value; refreshPreview(); changed(); } }),
    });
    const sol = field({
      label: 'Solution, one line each',
      hint: `Name the tool from the Solutions list (${(refs.solutions || []).slice(0, 4).map((s) => s.publicName).filter(Boolean).join(', ')}${(refs.solutions || []).length > 4 ? ' and others, in Settings, Solutions' : ''}), or say plainly what it does.`,
      input: textarea({ value: (p.solution || []).join('\n'), rows: 3, onInput: (e) => { p.solution = linesToList(e.target.value); refreshPreview(); changed(); } }),
    });
    return card({ title: 'Problem, Impact, Solution', body: [mk('Problem', 'problem'), mk('Impact', 'impact'), sol, mk('Close', 'close', 2)] });
  }

  function scriptCard() {
    piece.script ||= [];
    const host = el('div');
    const stats = el('div', { class: 'pe-word', style: { marginBottom: '8px' } });
    const updateStats = () => {
      const words = piece.script.reduce((n, r) => n + wordCount(r.say), 0);
      stats.textContent = `${words} spoken words, about ${Math.round((words / 140) * 60)} seconds at 140 words a minute`;
    };
    const draw = () => {
      const t = el('table', { class: 'table editor-table pe-script' });
      t.appendChild(el('thead', {}, el('tr', {}, ['#', 'You say', 'Viewer sees', 'Shot codes', 'Seconds', ''].map((h) => el('th', { text: h })))));
      const tb = el('tbody');
      piece.script.forEach((row, i) => {
        const move = (d) => { const j = i + d; if (j < 0 || j >= piece.script.length) return; [piece.script[i], piece.script[j]] = [piece.script[j], piece.script[i]]; draw(); changed(); };
        tb.appendChild(el('tr', {}, [
          el('td', { class: 'pe-n', text: String(i + 1) }),
          el('td', {}, textarea({ value: row.say || '', onInput: (e) => { row.say = e.target.value; updateStats(); changed(); } })),
          el('td', {}, input({ value: row.sees || '', onInput: (e) => { row.sees = e.target.value; changed(); } })),
          el('td', {}, input({ value: (row.codes || []).join(', '), placeholder: 'A, S3', class: 'mono', onInput: (e) => { row.codes = e.target.value.split(/[\s,]+/).filter(Boolean); changed(); } })),
          el('td', {}, input({ type: 'number', min: 0, value: row.seconds ?? '', class: 'mono', style: { width: '70px' }, onInput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) row.seconds = v; else delete row.seconds; changed(); } })),
          el('td', {}, el('div', { class: 'pe-rowbtns' }, [
            button({ kind: 'ghost', small: true, label: 'Up', title: 'Move up', onClick: () => move(-1) }),
            button({ kind: 'ghost', small: true, label: 'Down', title: 'Move down', onClick: () => move(1) }),
            button({ kind: 'ghost', small: true, icon: 'trash', title: 'Delete the row', onClick: () => { piece.script.splice(i, 1); draw(); changed(); } }),
          ])),
        ]));
      });
      t.appendChild(tb);
      host.replaceChildren(stats, el('div', { class: 'table-wrap' }, t),
        el('div', { class: 'row', style: { marginTop: '10px' } }, button({ kind: 'secondary', small: true, icon: 'plus', label: 'Add a row', onClick: () => { piece.script.push({ say: '', sees: '', codes: [] }); draw(); changed(); } })));
      updateStats();
    };
    draw();
    return card({ title: 'Say and sees', body: host });
  }

  function slidesCard() {
    piece.slides ||= [];
    const host = el('div');
    const draw = () => {
      host.replaceChildren();
      piece.slides.forEach((s, i) => {
        const move = (d) => { const j = i + d; if (j < 0 || j >= piece.slides.length) return; [piece.slides[i], piece.slides[j]] = [piece.slides[j], piece.slides[i]]; draw(); changed(); };
        const f = (label, key, area = false) => field({
          label,
          input: (area ? textarea : input)({ value: s[key] || '', onInput: (e) => { if (e.target.value) s[key] = e.target.value; else delete s[key]; changed(); } }),
        });
        host.appendChild(el('div', { class: 'pe-slide' }, [
          el('div', { class: 'pe-slide-head' }, [
            el('b', { class: 'mono', text: `Slide ${i + 1}` }),
            select({ options: ['cover', 'point', 'list', 'cta'], value: s.t || 'point', onChange: (e) => { s.t = e.target.value; changed(); } }),
            el('span', { class: 'ct-spacer' }),
            button({ kind: 'ghost', small: true, label: 'Up', onClick: () => move(-1) }),
            button({ kind: 'ghost', small: true, label: 'Down', onClick: () => move(1) }),
            button({ kind: 'ghost', small: true, icon: 'trash', title: 'Delete the slide', onClick: () => { piece.slides.splice(i, 1); draw(); changed(); } }),
          ]),
          el('div', { class: 'form-grid' }, [f('Eyebrow', 'eyebrow'), f('Number or label', 'n')]),
          f('Head (a word in *stars* turns yellow)', 'head'),
          f('Body', 'body', true),
          field({ label: 'List items, one per line', input: textarea({ value: (s.items || []).join('\n'), onInput: (e) => { const l = linesToList(e.target.value); if (l.length) s.items = l; else delete s.items; changed(); } }) }),
          f('Footer', 'foot'),
        ]));
      });
      host.appendChild(el('div', { class: 'row' }, button({ kind: 'secondary', small: true, icon: 'plus', label: 'Add a slide', onClick: () => { piece.slides.push({ t: 'point', head: '' }); draw(); changed(); } })));
    };
    draw();
    return card({ title: `Slides (${piece.slides.length})`, body: host });
  }

  function assetsCard() {
    const host = el('div');
    const fileIn = el('input', { type: 'file', style: { display: 'none' }, accept: 'video/*,image/*,application/pdf' });
    const draw = () => {
      host.replaceChildren();
      if (!piece.assets.length) host.appendChild(el('p', { class: 'note', text: 'No files yet. Upload one, or link a file already in the media folder.' }));
      piece.assets.forEach((a, i) => {
        let media;
        if (a.kind === 'video') media = el('video', { src: a.path, controls: true, preload: 'metadata', playsinline: true });
        else if (a.kind === 'pdf') media = el('a', { href: a.path, target: '_blank', rel: 'noopener', text: 'PDF' });
        else media = el('img', { src: a.path, alt: a.label || '', loading: 'lazy' });
        host.appendChild(el('div', { class: 'pe-asset' }, [
          el('div', { class: `pe-asset-media${a.kind === 'pdf' ? ' pdf' : ''}` }, media),
          el('div', { class: 'pe-asset-body' }, [
            el('div', { text: a.label || a.id || a.kind }),
            el('div', { class: 'mono', text: [a.kind, a.w && a.h ? `${a.w} x ${a.h}` : '', a.seconds ? `${a.seconds} s` : ''].filter(Boolean).join(' · ') }),
            el('div', { class: 'mono', style: { wordBreak: 'break-all' }, text: a.path }),
            button({ kind: 'ghost', small: true, icon: 'trash', label: 'Remove', onClick: () => { piece.assets.splice(i, 1); draw(); changed(); } }),
          ]),
        ]));
      });
      const linkIn = input({ placeholder: '/media/library/...', class: 'mono' });
      host.appendChild(el('div', { class: 'row', style: { marginTop: '10px' } }, [
        button({ kind: 'secondary', small: true, icon: 'upload', label: 'Upload a file', onClick: () => fileIn.click() }),
        el('span', { class: 'ct-spacer' }),
        linkIn,
        button({ kind: 'ghost', small: true, label: 'Link', onClick: () => {
          const path = linkIn.value.trim();
          if (!path) return;
          const kind = /\.(mp4|mov|webm)$/i.test(path) ? 'video' : /\.pdf$/i.test(path) ? 'pdf' : 'image';
          piece.assets.push({ id: `as-${Date.now().toString(36)}`, kind, path, label: path.split('/').pop() });
          draw(); changed();
        } }),
      ]));
    };
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0];
      if (!f) return;
      try {
        const res = await api.upload(f);
        const kind = f.type.startsWith('video/') ? 'video' : f.type === 'application/pdf' ? 'pdf' : 'image';
        piece.assets.push({ id: `as-${Date.now().toString(36)}`, kind, path: res.path, label: f.name, w: res.w, h: res.h, seconds: res.seconds });
        draw(); changed(); toast('File uploaded', 'ok');
      } catch (err) { toast(err.message, 'bad'); }
      fileIn.value = '';
    });
    draw();
    return card({ title: 'Files', body: [host, fileIn] });
  }

  // ================================================================ MIDDLE
  let previewHost = null;
  function refreshPreview() {
    if (!previewHost || !activeKey) return;
    requestAnimationFrame(() => { if (previewHost) previewHost.replaceChildren(previewNode(piece, activeKey)); });
  }

  function drawMiddle() {
    const keys = renditionKeys(piece);
    if (!keys.length) {
      midHost.replaceChildren(card({ title: 'Renditions', body: empty({ title: 'Choose where the piece goes', hint: 'Pick at least one account on the left. Each account gets its own form of the text.' }) }));
      previewHost = null; activeKey = null;
      return;
    }
    if (!keys.includes(activeKey)) activeKey = keys[0];
    const panel = el('div');
    previewHost = el('div', { class: 'pe-preview' });
    const showPanel = () => { panel.replaceChildren(renditionFields(activeKey)); previewHost.replaceChildren(previewNode(piece, activeKey)); };
    const bar = tabs({ items: keys.map((k) => ({ id: k, label: RENDITION_LABEL[k] })), active: activeKey, onChange: (id) => { activeKey = id; showPanel(); } });
    const fill = button({ kind: 'secondary', small: true, icon: 'sparkle', label: 'Fill from P.I.S.', title: 'Claude writes the missing text for each account from the Problem, Impact and Solution lines. Nothing already written is replaced.', onClick: (e) => fillFromPis(e.currentTarget) });
    midHost.replaceChildren(card({
      title: 'Renditions', actions: [fill],
      body: [el('p', { class: 'ct-hint', style: { margin: '0 0 8px' }, text: 'One tab per account the piece goes to. "Fill from P.I.S." asks Claude to write the empty tabs from the lines on the left; it never replaces text already written.' }), bar, panel, previewHost],
    }));
    showPanel();
  }

  function renditionFields(key) {
    const r = (piece.renditions[key] ||= {});
    const lim = (id, fallback) => refs.accounts.find((a) => a.id === id)?.limits?.textMax ?? fallback;
    const ta = (label, prop, max, rows = 6, hint) => field({
      label, hint,
      input: textarea({ value: r[prop] || '', counter: max, rows, onInput: (e) => { r[prop] = e.target.value; refreshPreview(); changed(); } }),
    });
    const wrap = el('div');
    if (key === 'ig') {
      const max = limits.igHashtags ?? 5;
      const count = el('span', { class: 'pe-word' });
      const upd = () => { const n = (r.hashtags || []).length; count.textContent = `${n} / ${max}`; count.classList.toggle('over', n > max); };
      upd();
      wrap.append(
        ta('Caption', 'caption', lim('vd-ig', 2200), 9, 'No hashtags in the caption; they go in the field below and are placed at the end.'),
        fieldNode(['Hashtags ', count], input({ value: (r.hashtags || []).join(' '), class: 'mono', placeholder: '#BusinessOwners #SmallBusinessIndia', onInput: (e) => { r.hashtags = tagsToList(e.target.value); upd(); refreshPreview(); changed(); } })),
        ta('First comment', 'firstComment', 2200, 3, 'A link, if any, goes here.'),
      );
    } else if (key === 'li') {
      wrap.append(ta('Post', 'text', lim('p-li', 3000), 14, 'The first 210 characters carry the hook. No hashtags in the body; up to three on the last line.'), ta('First comment', 'firstComment', 2000, 3, 'Any link goes here, never in the body.'));
    } else if (key === 'liCo') {
      wrap.append(ta('Reshare line', 'text', lim('vd-li', 3000), 4, 'One line above the reshared post.'));
    } else if (key === 'fb') {
      wrap.append(ta('Text', 'text', lim('vd-fb', 2200), 6));
    } else if (key === 'waStatus') {
      wrap.append(ta('Status text', 'text', lim('wa-st', 700), 4, 'One line. Words in *stars* show in yellow.'));
    } else if (key === 'waNote') {
      wrap.append(ta('Note', 'text', lim('wa-note', 1200), 8, 'About 90 words, to people who said yes.'));
    } else if (key === 'yt') {
      wrap.append(
        field({ label: 'Title', input: textarea({ value: r.title || '', counter: refs.accounts.find((a) => a.id === 'yt')?.limits?.titleMax ?? 100, rows: 2, onInput: (e) => { r.title = e.target.value; refreshPreview(); changed(); } }) }),
        ta('Description', 'description', lim('yt', 5000), 9),
        field({ label: 'Tags', input: input({ value: (r.tags || []).join(', '), placeholder: 'Comma separated', onInput: (e) => { r.tags = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); refreshPreview(); changed(); } }) }),
      );
    }
    return wrap;
  }

  const hasText = (key) => renditionHasText(key, piece.renditions?.[key]);

  async function fillFromPis(btn) {
    const missing = (piece.targets || []).filter((t) => TARGET_RENDITION[t] && !hasText(TARGET_RENDITION[t]));
    const needScript = SCRIPT_TYPES.includes(piece.type) && !(piece.script || []).length;
    const needSlides = SLIDE_TYPES.includes(piece.type) && !(piece.slides || []).length;
    if (!missing.length && !needScript && !needSlides) { toast('Every rendition already has text', 'info'); return; }
    if (!piece.pis.problem && !piece.pis.impact && !(piece.pis.solution || []).length) { toast('Write the Problem, Impact and Solution first', 'warn'); return; }
    btn.disabled = true;
    toast('Drafting the missing renditions', 'info');
    try {
      const res = await api.ai('draft', { pis: piece.pis, type: piece.type, targets: missing.length ? missing : piece.targets, hook: piece.hook, pillar: piece.pillar, notes: piece.notes, existing: piece });
      const out = res.output || {};
      for (const [k, v] of Object.entries(out.renditions || {})) if (!hasText(k)) piece.renditions[k] = v;
      if (!piece.hook && out.hook) piece.hook = out.hook;
      if (needScript && out.script?.length) piece.script = out.script;
      if (needSlides && out.slides?.length) piece.slides = out.slides;
      drawLeft(); drawMiddle(); changed(); setHeading();
      toast('Drafted. Read it through before it goes to review.', 'ok');
    } catch (err) { aiFailed(err); } finally { btn.disabled = false; }
  }

  // ================================================================= RIGHT
  const checkerHost = el('div');
  const versionsHost = el('div');
  const trailHost = el('div');
  const aiHost = el('div');
  const picturesHost = el('div');
  rightHost.append(card({ title: 'Checker', body: [checkerHost, rulesList()] }), card({ title: 'Visuals', body: picturesHost }), card({ title: 'Review history', body: trailHost }), card({ title: 'Versions', body: versionsHost }), card({ title: 'AI', body: aiHost }));

  /** What the checker looks for, from the rules document, so a new writer learns the rules before the first mistake. */
  function rulesList() {
    const checks = refs.rules?.checklist || [];
    const auto = checks.filter((c) => c.auto);
    const byHand = checks.filter((c) => !c.auto);
    const lim = refs.rules?.limits || {};
    const facts = [
      `The hook is ${lim.hookWords ?? 8} words or fewer.`,
      `Instagram takes at most ${lim.igHashtags ?? 5} hashtags, at the end. LinkedIn takes none in the body and ${lim.liHashtagsBottom ?? 3} at most on the last line.`,
      'No emoji, no exclamation marks, no ALL CAPS words. Sentence case.',
      `${(refs.rules?.never || []).length} phrases the brief never uses ("best", "workflow", "the work assigns itself" among them), ${(refs.rules?.courseTerms || []).length} course terms, and every claim the brief blocks.`,
      'No client, lender or staff name; no company outside the allowed list; no rupee, hours or percentage figure that is not marked as an example.',
      'Never that the business runs by itself, on autopilot or without people.',
    ];
    return el('details', { class: 'ct-rules' }, [
      el('summary', { text: 'What the checker looks for' }),
      el('ul', {}, facts.map((t) => el('li', { text: t }))),
      auto.length ? el('p', { class: 'ct-hint', text: `From the brief's checklist, checked here: ${auto.map((c) => c.text.replace(/\.$/, '')).join('; ')}.` }) : null,
      byHand.length ? el('p', { class: 'ct-hint', text: `Checked by the reviewer, not by the tool: ${byHand.map((c) => c.text.replace(/\.$/, '')).join('; ')}.` }) : null,
      el('p', { class: 'ct-hint', text: 'The lists live in Settings, Rules. The brief (00-brief.md) wins where they disagree.' }),
    ]);
  }

  async function drawPictures() {
    if (isNew) { picturesHost.replaceChildren(el('p', { class: 'note', text: 'Save the piece first; then a card can be made from its text in Visuals.' })); return; }
    let images = [];
    try { images = await api.get(`/pieces/${encodeURIComponent(piece.id)}/images`); } catch { images = []; }
    if (disposed) return;
    const fit = TEMPLATE_FOR_TYPE[piece.type] || 'the hook or quote card';
    const nodes = [];
    if (images.length) {
      nodes.push(el('div', { class: 'pe-pics' }, images.map((im) => el('a', { class: 'pe-pic', href: im.path, target: '_blank', rel: 'noopener', title: `${im.template || im.kind} ${im.w} x ${im.h}` }, [
        el('img', { src: im.path, alt: im.template || im.kind, loading: 'lazy' }),
        el('span', { class: 'mono', text: `${im.w} x ${im.h}` }),
      ]))));
      nodes.push(el('p', { class: 'ct-hint', text: `${images.length} ${images.length === 1 ? 'picture is' : 'pictures are'} saved with this piece. They are approved with it.` }));
    } else {
      nodes.push(el('p', { class: 'note', text: `No picture yet. This type usually takes ${fit}; the card maker fills it from the text of this piece.` }));
    }
    nodes.push(el('div', { class: 'row' }, [
      button({ kind: 'secondary', small: true, icon: 'pictures', label: 'Make a card in Visuals', href: `#/visuals?piece=${encodeURIComponent(piece.id)}`, title: `Opens the card maker on this piece, with ${fit} ready to export` }),
      button({ kind: 'ghost', small: true, icon: 'upload', label: 'Upload a photo or clip', title: 'Real photos and footage go under Files, on the left', onClick: () => { leftHost.querySelector('.pe-asset, input[type=file]')?.closest('.card')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }),
    ]));
    picturesHost.replaceChildren(...nodes);
  }

  function drawChecker(errorText) {
    const nodes = [];
    if (errorText) nodes.push(el('p', { class: 'note', text: errorText }));
    nodes.push(checkSummary(check));
    if (check) nodes.push(violationList(check.violations));
    if (aiCheck) {
      nodes.push(el('div', { class: 'pe-sub', text: 'AI check' }));
      nodes.push(el('p', { class: 'note', text: aiCheck.summary || '' }));
      nodes.push(violationList(aiCheck.violations));
      if (aiCheck.checklist?.length) {
        const ul = el('ul', { class: 'ct-checklist' });
        const names = Object.fromEntries((refs.rules?.checklist || []).map((c) => [c.id, c.text]));
        for (const c of aiCheck.checklist) ul.appendChild(el('li', {}, [el('span', { class: `dot${c.ok ? '' : ' no'}` }), el('span', {}, [el('b', { text: c.ok ? 'Pass: ' : 'Look again: ' }), names[c.id] || c.id, c.note ? ` ${c.note}` : ''])]));
        nodes.push(ul);
      }
    }
    checkerHost.replaceChildren(...nodes);
  }

  function drawTrail() {
    if (isNew) { trailHost.replaceChildren(el('p', { class: 'note', text: 'The review history starts once the piece is saved and submitted.' })); return; }
    trailHost.replaceChildren(trailList(piece.reviewTrail, refs.settings));
  }

  function drawVersions() {
    if (isNew) { versionsHost.replaceChildren(el('p', { class: 'note', text: 'Versions appear once the piece is saved.' })); return; }
    if (!versions.length) { versionsHost.replaceChildren(el('p', { class: 'note', text: 'No versions yet.' })); return; }
    const ul = el('ul', { class: 'ct-versions' });
    const latest = versions[versions.length - 1];
    for (const v of [...versions].reverse()) {
      ul.appendChild(el('li', {}, [
        el('div', { class: 'ct-ver-top' }, [
          el('span', { class: 'ct-ver-n', text: `v${v.n}` }),
          v.id === latest.id && chip({ label: 'Latest', tone: 'navy' }),
          el('span', { class: 'ct-ver-meta', text: `${v.by || 'unknown'} · ${fmt.dateTime(v.at)}` }),
        ]),
        el('div', { class: 'ct-ver-note', text: v.changeNote || '' }),
        el('div', { class: 'ct-ver-actions' }, [
          button({ kind: 'secondary', small: true, label: 'Compare', onClick: () => dialog({ title: `Version ${v.n} and the working copy`, wide: true, body: compareView(v.snapshot, piece, { leftTitle: `Version ${v.n}`, rightTitle: 'Working copy' }) }) }),
          button({ kind: 'secondary', small: true, label: 'Revert', disabled: readOnly || v.id === latest.id, title: v.id === latest.id ? 'This is the latest version' : '', onClick: async () => {
            if (!(await ask({ title: `Revert to version ${v.n}`, message: 'The working text is replaced by this version and the revert is saved as a new version.', confirmLabel: 'Revert' }))) return;
            try {
              const res = await api.post(`/pieces/${encodeURIComponent(piece.id)}/revert`, { versionId: v.id });
              await adopt(res.piece);
              toast(`Reverted to version ${v.n}`, 'ok');
            } catch (err) { toast(err.message, 'bad'); }
          } }),
        ]),
      ]));
    }
    versionsHost.replaceChildren(ul);
  }

  function drawAi() {
    const refineBox = textarea({ rows: 3, placeholder: 'For example: shorten the caption, or make the close a question.' });
    const refineOut = el('div');
    const refineBtn = button({ kind: 'secondary', small: true, icon: 'sparkle', label: 'Refine', onClick: async () => {
      const instruction = refineBox.value.trim();
      if (!instruction) { toast('Write an instruction first', 'warn'); return; }
      refineBtn.disabled = true; refineOut.replaceChildren(el('p', { class: 'note', text: 'Refining' }));
      try {
        const res = await api.ai('refine', { piece, instruction });
        const o = res.output;
        const proposal = { ...piece, ...(o.patch || {}) };
        const actions = [];
        if (o.changed) {
          actions.push(button({ kind: 'primary', small: true, label: 'Apply to the working copy', onClick: () => {
            Object.assign(piece, o.patch);
            drawLeft(); drawMiddle(); changed(); setHeading();
            noteInput.value = o.changeNote;
            refineOut.replaceChildren(); toast('Applied. Save to keep it as a new version.', 'ok');
          } }));
        }
        actions.push(button({ kind: 'ghost', small: true, label: 'Discard', onClick: () => refineOut.replaceChildren() }));
        refineOut.replaceChildren(el('div', { class: 'ct-ai-result' }, [
          el('b', { text: o.noChange ? 'No change recommended' : 'Proposal' }),
          el('p', { text: o.changeNote }),
          o.changed ? compareView(piece, proposal, { leftTitle: 'Now', rightTitle: 'Proposal' }) : null,
          el('div', { class: 'ct-ai-actions' }, actions),
        ]));
      } catch (err) { refineOut.replaceChildren(); aiFailed(err); } finally { refineBtn.disabled = false; }
    } });

    const checkBtn = button({ kind: 'secondary', small: true, icon: 'check', label: 'Check with AI', onClick: async () => {
      checkBtn.disabled = true; toast('The AI check is running', 'info');
      try { const res = await api.ai('check', { piece }); aiCheck = res.output; drawChecker(); toast('The AI check is ready', 'ok'); }
      catch (err) { aiFailed(err); } finally { checkBtn.disabled = false; }
    } });

    const imgOut = el('div');
    const imgBtn = button({ kind: 'secondary', small: true, icon: 'sparkle', label: 'Image prompts', onClick: async () => {
      imgBtn.disabled = true; imgOut.replaceChildren(el('p', { class: 'note', text: 'Writing the prompts' }));
      try {
        const res = await api.ai('imagePrompts', { piece });
        const text = JSON.stringify(res.output, null, 2);
        imgOut.replaceChildren(el('div', { class: 'ct-ai-result' }, [el('pre', { text }), el('div', { class: 'ct-ai-actions' }, button({ kind: 'ghost', small: true, label: 'Copy', onClick: () => navigator.clipboard?.writeText(text).then(() => toast('Copied', 'ok')) }))]));
      } catch (err) { imgOut.replaceChildren(); if (err.status === 404) toast('The image prompts operation is not available yet', 'warn'); else aiFailed(err); }
      finally { imgBtn.disabled = false; }
    } });

    const blocks = [
      el('p', { class: 'ct-hint', text: 'Every AI step runs through Claude on the founder\'s subscription and shows its result here before anything is kept. When Claude is not signed in on this Mac, the step fails with a message and the piece can still be written by hand.' }),
      el('div', { class: 'ct-ai-block' }, [el('div', { class: 'pe-sub', text: 'Refine' }), el('p', { class: 'ct-hint', text: 'Write an instruction; Claude proposes a new version of the text and shows the difference. Nothing changes until "Apply".' }), refineBox, el('div', { class: 'ct-ai-actions' }, refineBtn), refineOut]),
      el('div', { class: 'ct-ai-block' }, [el('div', { class: 'pe-sub', text: 'Check with AI' }), el('p', { class: 'ct-hint', text: 'Reads for what word lists cannot catch: a promised result in other words, a coach\'s tone, a casual aside. Adds its findings to the checker above.' }), el('div', { class: 'ct-ai-actions' }, checkBtn)]),
      el('div', { class: 'ct-ai-block' }, [el('div', { class: 'pe-sub', text: 'Illustration prompt' }), el('p', { class: 'ct-hint', text: 'Writes the prompt for a house-style illustration (covers and thumbnails only) and the card texts. It makes no picture; the Visuals card above does.' }), el('div', { class: 'ct-ai-actions' }, imgBtn), imgOut]),
    ];
    if (piece.type === 'youtube-long') {
      blocks.push(el('div', { class: 'ct-ai-block' }, [el('div', { class: 'pe-sub', text: 'Shorts' }), el('div', { class: 'ct-ai-actions' }, button({ kind: 'secondary', small: true, label: 'Make Shorts from this', onClick: async () => {
        if (isNew) { toast('Save the piece first', 'warn'); return; }
        try {
          let vid = piece.videoId;
          if (!vid) { const v = await api.post('/video', { pieceId: piece.id }); vid = v.id || v.video?.id; }
          if (vid) location.hash = `#/video/${vid}`; else toast('The video project could not be opened', 'warn');
        } catch (err) { toast(err.message, 'bad'); }
      } })), el('p', { class: 'ct-hint', text: 'Opens the video project, where the Shorts are cut from the script.' })]));
    }
    aiHost.replaceChildren(...blocks);
  }

  // ============================================================ ACTION BAR
  // The note field is built once, so typing in it survives every redraw of the buttons.
  const noteInput = input({ placeholder: 'Change note (optional)', 'aria-label': 'Change note' });
  const noteWrap = el('div', { class: 'ct-note' }, noteInput);
  const statusHost = el('span');
  const dirtyHost = el('span');
  const actionsHost = el('div', { class: 'row', style: { gap: '10px' } });
  barHost.appendChild(el('div', { class: 'ct-actionbar' }, [statusHost, dirtyHost, el('span', { class: 'ct-spacer' }), noteWrap, actionsHost]));

  function drawBar() {
    const dirty = isDirty();
    const blocks = (check?.violations || []).filter((v) => v.severity === 'block').length;
    const status = piece.status;
    const acts = [];
    noteWrap.style.display = readOnly ? 'none' : '';
    if (readOnly) {
      acts.push(button({ kind: 'secondary', label: 'Edit as new version', icon: 'edit', onClick: () => { readOnly = false; applyReadOnly(); drawBanner(); drawBar(); } }));
    } else {
      acts.push(button({ kind: 'primary', label: 'Save', disabled: !dirty && !isNew, onClick: () => save_(noteInput.value) }));
      if (SUBMITTABLE.includes(status)) {
        acts.push(button({ kind: 'secondary', icon: 'review', label: 'Submit for review', onClick: () => { piece.status = 'in-review'; save_(noteInput.value || (status === 'changes-requested' ? 'Revised and submitted for review' : 'Submitted for review')); } }));
      }
    }
    // The review controls, by role: a manager approves or sends on, the director approves anything.
    const route = routeNow();
    if (!isNew && status === 'in-review' && approver) {
      if (!director && route.needsDirector) {
        acts.push(button({ kind: 'primary', label: 'Send to director', onClick: escalate }));
      } else {
        acts.push(button({ kind: 'primary', label: 'Approve', icon: 'approve', disabled: blocks > 0, title: blocks ? 'The checker blocks approval' : '', onClick: approve }));
        if (!director) acts.push(button({ kind: 'secondary', label: 'Send to director', onClick: escalate }));
      }
      acts.push(button({ kind: 'secondary', label: 'Request changes', onClick: requestChanges }));
    }
    if (!isNew && status === 'director-review' && director) {
      acts.push(button({ kind: 'primary', label: 'Approve', icon: 'approve', disabled: blocks > 0, title: blocks ? 'The checker blocks approval' : '', onClick: approve }));
      acts.push(button({ kind: 'secondary', label: 'Request changes', onClick: requestChanges }));
      acts.push(button({ kind: 'secondary', label: 'Return to manager', onClick: returnToManager }));
    }
    if (['approved', 'scheduled'].includes(status) && !isNew && can.recordPosted) {
      acts.push(button({ kind: 'secondary', label: 'Record as posted', title: 'Records by hand that this piece went out, until posting is connected', onClick: recordPosted }));
    }
    if (status === 'retired') acts.push(button({ kind: 'secondary', label: 'Restore as draft', onClick: () => { piece.status = 'draft'; save_('Restored from retired'); } }));
    else if (!isNew) acts.push(button({ kind: 'danger', label: 'Retire', onClick: retire }));
    statusHost.replaceChildren(statusPill(status));
    dirtyHost.replaceChildren(...(dirty || isNew ? [el('span', { class: 'ct-dirty', text: isNew ? 'Not saved yet' : 'Unsaved changes' })] : []),
      ...(!approver ? [el('span', { class: 'note', style: { marginLeft: '8px' }, text: status === 'in-review' ? 'With the manager for review.' : status === 'director-review' ? 'With the director for review.' : 'Submit it for review when it is ready; the manager reviews it.' })] : []));
    actionsHost.replaceChildren(...acts);
  }

  function drawBanner() {
    const nodes = [];
    const route = routeNow();
    const banner = (tone, ic, head, text) => el('div', { class: `banner banner-${tone}` }, [icon(ic), el('div', {}, [el('b', { text: head }), ' ', text])]);
    if (piece.status === 'changes-requested') {
      const r = piece.review || {};
      nodes.push(banner('warn', 'warn', 'Changes requested.', `${r.by ? `${nameOf(r.by)}: ` : ''}${r.note || 'No note was given.'} ${approver ? 'The author revises the piece and submits it for review again.' : 'Revise the piece and submit it for review again.'}`));
    }
    if (piece.status === 'in-review' && !isNew) {
      if (!approver) nodes.push(banner('info', 'review', 'With the manager.', 'The manager sees it in Review and in the Today strip on the calendar. Nothing has to be sent by hand; add the picture in Visuals if the piece needs one.'));
      else if (director) nodes.push(banner('info', 'review', 'In the manager\'s queue.', `You may approve it here or in Review once the checker is clear.${route.needsDirector ? ` ${route.why}, so the manager would send it to you.` : ''}`));
      else if (route.needsDirector) nodes.push(banner('warn', 'review', 'This piece must reach the director.', `${route.why}. Send it to the director here or in Review, with a note.`));
      else nodes.push(banner('info', 'review', 'In your queue.', 'Approve it here or in Review once the checker is clear, or send it to the director with a note.'));
    }
    if (piece.status === 'director-review' && !isNew) {
      const e = piece.escalation || {};
      const note = e.note ? `${e.by ? `${nameOf(e.by)}: ` : ''}${e.note}` : '';
      if (director) nodes.push(banner('info', 'review', 'Awaiting you.', `${note ? `Note from the manager, ${note}. ` : ''}Approve it, request changes, or return it to the manager.`));
      else nodes.push(banner('info', 'review', 'With the director.', `${note ? `Sent with the note, ${note}. ` : ''}The director approves it, requests changes or returns it to the manager.`));
    }
    if (['posted', 'measured'].includes(piece.status) && piece.measure?.postedAt) {
      const acc = refs.accounts.find((a) => a.id === piece.measure.postedAccount);
      nodes.push(el('div', { class: 'banner banner-info' }, [icon('check'), el('div', {}, [el('b', { text: 'Posted. ' }), `Recorded by hand by ${piece.measure.postedBy || 'unknown'}: ${acc ? acc.label : piece.measure.postedAccount || 'account not named'}, ${fmt.dateTime(piece.measure.postedAt)}${piece.measure.postedLink ? '. ' : '. No link recorded. '}`, piece.measure.postedLink ? el('a', { href: piece.measure.postedLink, target: '_blank', rel: 'noopener', text: 'Open the post' }) : null, ' Posting from Studio is phase 2; until then this record is the only trace.'])]));
    }
    if (readOnly) nodes.push(el('div', { class: 'banner banner-info ct-readonly' }, [icon('check'), el('div', { text: 'This piece is approved and read-only. Use "Edit as new version" to change it; saving sends it back to review.' })]));
    else if (piece.status === 'approved') nodes.push(el('div', { class: 'banner banner-warn' }, [icon('warn'), el('div', { text: 'Saving a change sends the approved piece back to review.' })]));
    bannerHost.replaceChildren(...nodes);
  }

  // ------------------------------------------------------------ operations
  async function adopt(stored) {
    piece = stored; delete piece._version;
    piece.pis ||= { problem: '', impact: '', solution: [], close: '' };
    piece.renditions ||= {}; piece.assets ||= []; piece.tags ||= []; piece.targets ||= [];
    savedJson = JSON.stringify(piece);
    readOnly = piece.status === 'approved';
    versions = await api.get(`/pieces/${encodeURIComponent(piece.id)}/versions`).catch(() => versions);
    applyReadOnly(); setHeading(); drawBanner(); drawLeft(); drawMiddle(); drawTrail(); drawVersions(); drawAi(); drawBar(); drawPictures();
    runCheck();
  }

  async function save_(note, force = false) {
    try {
      const body = clone(piece); delete body._version;
      delete body.needsDirector; delete body.needsDirectorWhy;   // the server's decoration, not part of the piece
      if (isNew) {
        const created = await api.post('/pieces', { ...body, changeNote: note || 'Created' });
        if (slotId) { try { await api.post(`/pieces/${encodeURIComponent(created.id)}/place`, { slotId }); } catch (err) { toast(`Saved, but the slot could not be filled: ${err.message}`, 'warn'); } }
        toast('The piece is saved', 'ok');
        disposed = true;
        location.hash = `#/content/${encodeURIComponent(created.id)}`;
        return;
      }
      const stored = await api.put(`/pieces/${encodeURIComponent(piece.id)}`, { ...body, changeNote: note || undefined, ...(force ? { force: true } : {}) });
      if (noteInput) noteInput.value = '';
      await adopt(stored);
      toast(piece.status === 'in-review' ? 'Saved, and submitted for review' : 'Saved', 'ok');
    } catch (err) {
      if (err.status === 409 && err.detail?.conflict) { conflictDialog(err, note); return; }
      toast(err.message, 'bad');
    }
  }

  /** Someone else saved this piece after it was opened here: reload theirs, or overwrite with this copy. */
  function conflictDialog(err, note) {
    let d;
    d = dialog({
      title: 'Saved by someone else meanwhile',
      body: el('div', {}, [
        el('p', { text: `${err.detail.by || 'Someone else'} saved this piece at ${fmt.dateTime(err.detail.at)}, after you opened it.` }),
        el('p', { class: 'note', text: 'Reload shows their version and discards your unsaved changes. Save anyway keeps yours and theirs stays in the versions list.' }),
      ]),
      actions: [
        button({ kind: 'secondary', label: 'Reload', onClick: async () => { d.close(); try { await adopt(await api.get(`/pieces/${encodeURIComponent(piece.id)}`)); toast('Reloaded the latest version', 'ok'); } catch (e2) { toast(e2.message, 'bad'); } } }),
        button({ kind: 'primary', label: 'Save anyway', onClick: () => { d.close(); save_(note, true); } }),
      ],
    });
  }

  async function approve() {
    try {
      if (isDirty()) await save_(noteInput?.value || '');
      const res = await api.post(`/pieces/${encodeURIComponent(piece.id)}/approve`, {});
      await adopt(res.piece);
      toast('Approved', 'ok');
    } catch (err) {
      if (err.status === 409 && Array.isArray(err.detail)) {
        check = { ...(check || {}), violations: err.detail.concat((check?.violations || []).filter((v) => v.severity !== 'block')) };
        drawChecker(); drawBar();
      }
      if (err.status === 409 && err.detail?.needsDirector) {
        forcedRoute = { needsDirector: true, why: err.detail.why || 'This piece must reach the director' };
        drawBanner(); drawBar();
        toast(`${err.detail.why || 'This piece must reach the director'}. Send it to the director instead.`, 'warn', { ms: 6000 });
        return;
      }
      toast(err.message, 'bad');
    }
  }

  /** The manager sends the piece on to the director, with a note. */
  function escalate() {
    const route = routeNow();
    noteDialog({
      title: 'Send to director', label: 'Note for the director', sendLabel: 'Send to director',
      placeholder: 'What should the director look at?',
      intro: route.needsDirector ? `${route.why}.` : 'This piece may be approved by you; send it on when the director should decide.',
      onSend: async (note) => {
        if (isDirty()) await save_('');
        const res = await api.post(`/pieces/${encodeURIComponent(piece.id)}/escalate`, { note });
        await adopt(res?.piece || res); toast('Sent to the director', 'ok');
      },
    });
  }

  /** The director hands the piece back to the manager's queue, with a note. */
  function returnToManager() {
    noteDialog({
      title: 'Return to manager', label: 'Note for the manager', sendLabel: 'Return to manager',
      placeholder: 'What should the manager decide or check?',
      onSend: async (note) => {
        if (isDirty()) await save_('');
        const res = await api.post(`/pieces/${encodeURIComponent(piece.id)}/return`, { note });
        await adopt(res?.piece || res); toast('Returned to the manager', 'ok');
      },
    });
  }

  function requestChanges() {
    const note = textarea({ rows: 4, placeholder: 'What should change?' });
    let d;
    d = dialog({
      title: 'Request changes',
      body: field({ label: 'Note for the author', input: note }),
      actions: [
        button({ label: 'Cancel', onClick: () => d.close() }),
        button({ kind: 'primary', label: 'Send the request', onClick: async () => {
          if (!note.value.trim()) { toast('A note is required', 'warn'); return; }
          try {
            if (isDirty()) await save_('');
            const stored = await api.post(`/pieces/${encodeURIComponent(piece.id)}/request-changes`, { note: note.value.trim() });
            d.close(); await adopt(stored); toast('Changes requested', 'ok');
          } catch (err) { toast(err.message, 'bad'); }
        } }),
      ],
    });
  }

  /** Posting is phase 2. Until it is connected, the person who posted records it here by hand. */
  function recordPosted() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateIn = input({ type: 'date', value: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, class: 'mono' });
    const timeIn = input({ type: 'time', value: `${pad(now.getHours())}:${pad(now.getMinutes())}`, class: 'mono' });
    const accSel = select({ options: (piece.targets || []).map((t) => { const a = refs.accounts.find((x) => x.id === t); return { value: t, label: a ? a.label : t }; }), value: piece.targets?.[0] });
    const urlIn = input({ type: 'url', placeholder: 'https://', class: 'mono' });
    const noteIn = input({ placeholder: 'Optional: anything to remember about the posting' });
    let d;
    d = dialog({
      title: 'Record as posted',
      body: el('div', {}, [
        el('p', { class: 'note', text: `Recorded by hand, as ${api.user.get() || 'the chosen user'}, after the post has gone up, until posting from Studio is connected (phase 2). The time must have passed. The piece moves to Posted and the calendar's month card counts it as out.` }),
        el('div', { class: 'form-grid' }, [field({ label: 'Date', input: dateIn }), field({ label: 'Time', input: timeIn }), field({ label: 'Account', input: accSel })]),
        field({ label: 'Link to the post', input: urlIn, hint: 'Optional now; needed for the Friday measurement.' }),
        field({ label: 'Note', input: noteIn }),
      ]),
      actions: [
        button({ kind: 'secondary', label: 'Cancel', onClick: () => d.close() }),
        button({ kind: 'primary', label: 'Record', onClick: async () => {
          if (!dateIn.value) { toast('A date is required', 'warn'); return; }
          try {
            const stored = await api.post(`/pieces/${encodeURIComponent(piece.id)}/record-posted`, { postedAt: `${dateIn.value}${timeIn.value ? `T${timeIn.value}` : ''}`, accountId: accSel.value, url: urlIn.value.trim(), note: noteIn.value.trim() });
            d.close(); await adopt(stored); toast('Recorded as posted', 'ok');
          } catch (err) { toast(err.message, 'bad'); }
        } }),
      ],
    });
  }

  async function retire() {
    if (!(await ask({ title: 'Retire this piece', message: 'A retired piece leaves the queues and cannot be placed in the calendar. You can restore it later.', confirmLabel: 'Retire', danger: true }))) return;
    piece.status = 'retired';
    await save_('Retired');
  }

  // ------------------------------------------------------------------ start
  applyReadOnly();
  drawBanner(); drawLeft(); drawMiddle(); drawChecker(); drawTrail(); drawVersions(); drawAi(); drawBar(); drawPictures();
  runCheck();

  return () => { disposed = true; checkSoon.cancel(); previewHost = null; };
}
