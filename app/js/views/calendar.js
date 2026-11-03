// Calendar: month and week planner, day panel, pick-a-piece, move, allotted days, export. [calendar]
//
// Routes: #/calendar and #/calendar/:yyyy-mm
// Query:  view=week&week=YYYY-MM-DD   the week view
//         day=YYYY-MM-DD               opens the day panel
//         slot=<slotId>                opens the panel on that slot
//         place=<pieceId>&slot=<id>    places a piece the content editor just made, then opens the slot
//
// The server owns every rule (fit table, dark days, go dark). This view only
// asks and shows the reason when it is refused.

import { api } from '../api.js';
import { el, button, chip, statusPill, dialog, toast, select, input, field, empty, icon, preview, confirm } from '../ui.js';
import { checkChip } from './library.js';
import { isApprover, loadRefs } from './piece.js';
import { render as renderToday, summary as todaySummary } from './today.js';

export const route = ['#/calendar', '#/calendar/:month'];
export const title = 'Calendar';

// ------------------------------------------------------------------ constants

const DOW_HEAD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const KIND_LABEL = {
  reel: 'Reel', trial: 'Trial reel', carousel: 'Carousel', li: 'Post', 'li-carousel': 'PDF carousel', status: 'Status',
  'status-opt': 'Status (optional)', note: 'Monthly note', 'yt-long': 'Long video', 'yt-short': 'Short', reshare: 'Reshare',
  family: 'Family Status', greeting: 'Greeting',
};
const STATE_LABEL = { open: 'Open', optional: 'Optional', derived: 'Derived', 'greeting-only': 'Greeting only', dark: 'Dark', filled: 'Filled' };
const MARKER_LABEL = { dark: 'Dark', 'greeting-only': 'Greeting only', compliance: 'Compliance', event: 'Event', quiet: 'Quiet', greeting: 'Greeting', rule: 'Standing rule' };
const MARKER_TONE = { dark: 'bad', 'greeting-only': 'warn', compliance: 'lime', event: 'navy', quiet: 'muted', greeting: 'muted', rule: 'muted' };
const GROUPS = ['Venture Drafters', 'Palak', 'WhatsApp'];
const STATUS_RANK = { approved: 0, scheduled: 1, 'in-review': 2, 'director-review': 2, 'changes-requested': 3, draft: 4, idea: 5, posted: 6, measured: 7, retired: 9 };
const APPROVED = ['approved', 'scheduled', 'posted', 'measured'];
const MODE_KEY = 'studio.calendar.mode';

// -------------------------------------------------------------- date helpers

const toDate = (ymd) => new Date(`${ymd}T00:00:00Z`);
const toYmd = (d) => d.toISOString().slice(0, 10);
const addDays = (ymd, n) => { const d = toDate(ymd); d.setUTCDate(d.getUTCDate() + n); return toYmd(d); };
const mondayOf = (ymd) => addDays(ymd, -((toDate(ymd).getUTCDay() + 6) % 7));
const daysIn = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
const addMonths = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)); return toYmd(d).slice(0, 7); };
const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(toDate(s).getTime());
function* eachDay(from, to) { for (let d = from; d <= to; d = addDays(d, 1)) yield d; }
const monthName = (ym) => toDate(`${ym}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const longDate = (ymd) => toDate(ymd).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = (ymd) => toDate(ymd).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
function istToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// The month on a laptop, the week on a phone, until the person chooses.
function readMode() {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === 'week' || m === 'month') return m;
  } catch { /* private mode */ }
  return window.matchMedia('(max-width: 800px)').matches ? 'week' : 'month';
}
function writeMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch { /* private mode */ } }

let cssReady = null;
function ensureCss() {
  if (cssReady) return cssReady;
  cssReady = new Promise((resolve) => {
    const existing = document.querySelector('link[data-cal-css]');
    if (existing) { resolve(); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'css/calendar.css'; link.dataset.calCss = '1';
    link.onload = () => resolve(); link.onerror = () => resolve();
    document.head.appendChild(link);
    setTimeout(resolve, 1500);
  });
  return cssReady;
}

// ---------------------------------------------------------------------- view

export async function render(container, params) {
  await ensureCss();
  const today0 = istToday();
  const query = params.query || {};
  const mode0 = query.view === 'week' ? 'week' : query.view === 'month' ? 'month' : readMode();
  // The home view opens on today's month; before the first posting week it opens on the first month that has slots.
  let homeMonth = today0.slice(0, 7);
  if (!isMonth(params.month) && !isYmd(query.week)) {
    try { const first = await api.get('/slots', { _sort: 'date', _limit: 1 }); if (first?.[0]?.date && first[0].date.slice(0, 7) > homeMonth) homeMonth = first[0].date.slice(0, 7); } catch { /* keep today's month */ }
  }
  const month0 = isMonth(params.month) ? params.month : (isYmd(query.week) ? query.week.slice(0, 7) : homeMonth);
  const anchor0 = isYmd(query.week) ? query.week : (month0 === today0.slice(0, 7) ? today0 : `${month0}-01`);

  const S = {
    mode: mode0, month: month0, anchor: mondayOf(anchor0), group: 'all', kind: 'all',
    day: isYmd(query.day) ? query.day : null, focusSlot: null,
    data: null, accounts: [], byAcc: {}, pieces: null, piecesAt: 0, autoTried: false,
  };
  let disposed = false;
  let drag = null;
  let pop = null;

  const root = el('div', { class: 'cal' });
  const body = el('div', { class: 'cal-body' });
  // The Today strip: one line always, the full lists when unfolded (or when arriving from #/today).
  const strip = el('details', { class: 'cal-today', open: query.today === '1' });
  const stripSum = el('summary', { class: 'cal-today-sum' }, el('span', { class: 'muted small', text: 'Today: loading' }));
  const stripBody = el('div', { class: 'cal-today-body' });
  strip.append(stripSum, stripBody);
  const toolbarHost = el('div');
  root.append(strip, toolbarHost, body);
  let todayData = null;
  let todayDrawn = false;
  async function loadStrip() {
    try { todayData = await api.today(); } catch (err) { stripSum.replaceChildren(el('span', { class: 'muted small', text: `Today could not load: ${err.message}` })); return; }
    stripSum.replaceChildren(todaySummary(todayData));
    if (strip.open) drawStrip();
  }
  async function drawStrip() {
    if (todayDrawn || !todayData) return;
    todayDrawn = true;
    stripBody.replaceChildren();
    await renderToday(stripBody, {}, { today: todayData, accounts: S.accounts });
  }
  strip.addEventListener('toggle', () => { if (strip.open) drawStrip(); });
  const drawer = el('aside', { class: 'cal-drawer', 'aria-label': 'Day panel' });
  const backdrop = el('div', { class: 'cal-backdrop' });
  backdrop.addEventListener('click', () => closeDay());
  container.replaceChildren(root);
  document.body.append(drawer, backdrop);
  const onKey = (e) => { if (e.key === 'Escape' && drawer.classList.contains('open') && !document.querySelector('.dialog-back')) closeDay(); };
  document.addEventListener('keydown', onKey);

  const cleanup = () => {
    disposed = true;
    document.removeEventListener('keydown', onKey);
    drawer.remove(); backdrop.remove(); hidePop();
  };

  // --- routing helpers
  const hashFor = (o = {}) => {
    const mode = o.mode || S.mode;
    const month = o.month || S.month;
    const q = new URLSearchParams();
    if (mode === 'week') { q.set('view', 'week'); q.set('week', o.anchor || S.anchor); }
    if (o.day) q.set('day', o.day);
    if (o.slot) q.set('slot', o.slot);
    const s = q.toString();
    return `#/calendar/${month}${s ? `?${s}` : ''}`;
  };
  const rememberDay = () => {
    const h = hashFor({ day: S.day });
    history.replaceState(null, '', h);
  };
  const go = (hash) => { location.hash = hash; };

  function range() {
    if (S.mode === 'week') return { from: S.anchor, to: addDays(S.anchor, 6) };
    const first = `${S.month}-01`;
    return { from: mondayOf(first), to: addDays(mondayOf(addDays(`${S.month}-${String(daysIn(S.month)).padStart(2, '0')}`, 0)), 6) };
  }

  // --- data
  async function load({ quiet = false } = {}) {
    const { from, to } = range();
    try {
      if (!S.accounts.length) {
        S.accounts = await api.get('/accounts');
        try { S.approver = isApprover((await loadRefs()).settings); } catch { S.approver = false; }
        S.byAcc = Object.fromEntries(S.accounts.map((a) => [a.id, a]));
      }
      let data = await api.get('/calendar', { from, to });
      if (!data.slots.length && !S.autoTried) {
        S.autoTried = true;
        await api.post('/slots/regenerate', { from, to });
        data = await api.get('/calendar', { from, to });
      }
      if (disposed) return false;
      S.data = data;
      return true;
    } catch (err) {
      if (!quiet) body.replaceChildren(el('div', { class: 'banner banner-bad' }, [icon('warn'), el('div', { text: `The calendar could not be loaded: ${err.message}` })]));
      return false;
    }
  }

  async function getPieces(force = false) {
    if (!force && S.pieces && Date.now() - S.piecesAt < 20000) return S.pieces;
    S.pieces = await api.get('/pieces');
    S.piecesAt = Date.now();
    return S.pieces;
  }

  const slotsOn = (date) => S.data.slots.filter((s) => s.date === date);
  const eventsOn = (date) => S.data.events.filter((e) => e.date === date);
  const dayInfo = (date) => S.data.days[date] || { rule: 'normal', reasons: [], quiet: false };
  const accShort = (id) => S.byAcc[id]?.short || id;
  const accLabel = (id) => S.byAcc[id]?.label || id;
  const passes = (s) => (S.group === 'all' || S.byAcc[s.accountId]?.group === S.group) && (S.kind === 'all' || s.kind === S.kind);
  const pieceLabel = (s) => s.piece?.hook || s.csv?.hook || s.pieceId || '';

  // --- reload helper used after every change
  async function refresh({ keepPanel = true } = {}) {
    const ok = await load({ quiet: true });
    if (!ok || disposed) return;
    drawGrid();
    if (keepPanel && S.day) drawPanel();
  }

  // --- place / unplace / move (the server decides)
  async function place(pieceId, bodyIn, okText) {
    try {
      const res = await api.post(`/pieces/${encodeURIComponent(pieceId)}/place`, bodyIn);
      toast(okText || `Placed on ${shortDate(res.slot.date)}${res.slot.time ? ` at ${res.slot.time}` : ''}`, 'ok');
      for (const w of res.warnings || []) toast(w, 'warn', { ms: 5200 });
      S.pieces = null;
      await refresh();
      return res;
    } catch (err) {
      toast(err.message, 'bad', { ms: 8000 });
      return null;
    }
  }
  async function unplace(slot) {
    if (!(await confirm({ title: 'Take the piece out of this slot', message: `"${pieceLabel(slot)}" leaves ${shortDate(slot.date)}; the slot becomes open again. The piece stays in the library.`, confirmLabel: 'Take it out' }))) return;
    try {
      await api.post(`/pieces/${encodeURIComponent(slot.pieceId)}/unplace`, { slotId: slot.id });
      toast('The piece is out of the calendar', 'ok');
      S.pieces = null;
      await refresh();
    } catch (err) { toast(err.message, 'bad', { ms: 8000 }); }
  }

  // ------------------------------------------------------------- toolbar
  function drawToolbar() {
    const title2 = S.mode === 'week'
      ? `${shortDate(S.anchor)} to ${shortDate(addDays(S.anchor, 6))}`
      : monthName(S.month);
    const step = (n) => {
      if (S.mode === 'week') {
        const a = addDays(S.anchor, 7 * n);
        go(hashFor({ month: a.slice(0, 7), anchor: a }));
      } else go(hashFor({ month: addMonths(S.month, n) }));
    };
    const todayBtn = button({ kind: 'secondary', small: true, label: 'Today', onClick: () => {
      const t = S.data?.today || istToday();
      if (S.mode === 'week') go(hashFor({ month: t.slice(0, 7), anchor: mondayOf(t) })); else go(hashFor({ month: t.slice(0, 7) }));
    } });
    const modeTabs = el('div', { class: 'tabs', role: 'tablist' }, ['month', 'week'].map((m) => el('button', {
      class: `tab${S.mode === m ? ' active' : ''}`, type: 'button', role: 'tab', text: m === 'month' ? 'Month' : 'Week',
      onClick: () => {
        if (S.mode === m) return;
        writeMode(m);
        const base = S.day && isYmd(S.day) ? S.day : (S.month === istToday().slice(0, 7) ? istToday() : `${S.month}-01`);
        if (m === 'week') go(hashFor({ mode: 'week', month: base.slice(0, 7), anchor: mondayOf(base) })); else go(hashFor({ mode: 'month', month: base.slice(0, 7) }));
      },
    })));
    const groupSel = select({
      options: [{ value: 'all', label: 'All accounts' }, ...GROUPS.map((g) => ({ value: g, label: g }))], value: S.group,
      'aria-label': 'Filter by account group', onChange: (e) => { S.group = e.target.value; drawGrid(); },
    });
    const kindSel = select({
      options: [{ value: 'all', label: 'All kinds' }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))],
      value: S.kind, 'aria-label': 'Filter by kind', onChange: (e) => { S.kind = e.target.value; drawGrid(); },
    });
    const bar = el('div', { class: 'cal-toolbar' }, [
      el('div', { class: 'cal-nav' }, [
        button({ kind: 'secondary', small: true, icon: 'back', title: S.mode === 'week' ? 'Previous week' : 'Previous month', onClick: () => step(-1) }),
        el('div', { class: 'cal-title', text: title2 }),
        button({ kind: 'secondary', small: true, icon: 'next', title: S.mode === 'week' ? 'Next week' : 'Next month', onClick: () => step(1) }),
        todayBtn,
      ]),
      modeTabs,
      el('div', { class: 'cal-filters' }, [groupSel, kindSel]),
      // The approver's file actions are rare; they fold away so the calendar itself comes first.
      S.approver ? el('details', { class: 'cal-more' }, [
        el('summary', { text: 'Files' }),
        el('div', { class: 'cal-actions' }, [
          button({ kind: 'secondary', small: true, label: 'Fill from import file', onClick: importRows }),
          button({ kind: 'secondary', small: true, label: 'Regenerate slots', onClick: regenerate }),
          button({ kind: 'secondary', small: true, label: 'Write calendar.csv', onClick: exportCsv }),
        ]),
      ]) : null,
    ]);
    return bar;
  }

  async function regenerate() {
    const { from, to } = range();
    try {
      const r = await api.post('/slots/regenerate', { from, to });
      toast(`Slots regenerated for ${shortDate(from)} to ${shortDate(to)}: ${r.created} added, ${r.updated} updated, ${r.removed} removed. Filled slots are untouched.`, 'ok', { ms: 5200 });
      await refresh();
    } catch (err) { toast(err.message, 'bad', { ms: 7000 }); }
  }
  async function importRows() {
    try {
      const r = await api.post('/calendar/import-rows', {});
      toast(r.message || (r.ok ? 'Imported' : 'Nothing was imported'), r.ok ? 'ok' : 'warn', { ms: 7000 });
      if (r.ok) { S.pieces = null; await refresh(); }
    } catch (err) { toast(err.message, 'bad', { ms: 7000 }); }
  }
  async function exportCsv() {
    const ok = await confirm({
      title: 'Write calendar.csv',
      message: 'This replaces Marketing/POSTING/calendar.csv with the rows now in the calendar. The present file is kept next to it as calendar.csv.bak. Run build-kit.mjs afterwards to rebuild calendar.html.',
      confirmLabel: 'Write the file',
    });
    if (!ok) return;
    try {
      const r = await api.post('/calendar/export-csv', {});
      toast(r.message || `Wrote ${r.rows} rows`, 'ok', { ms: 7000 });
    } catch (err) { toast(err.message, 'bad', { ms: 8000 }); }
  }

  // --------------------------------------------------------------- grid
  function legend() {
    const k = (cls, text) => el('span', { class: 'cal-key' }, [el('i', { class: cls }), text]);
    return el('div', { class: 'cal-legend', 'aria-hidden': 'true' }, [
      k('k-filled', 'Filled'), k('k-open', 'Open'), k('k-dark', 'Dark day'), k('k-gonly', 'Greeting only'), k('k-quiet', 'Quiet window'), k('k-today', 'Today'),
      el('span', { text: 'Compliance dates: move any post by a day.' }),
    ]);
  }

  function banners() {
    const out = [];
    if (S.data.goDark?.on) {
      out.push(el('div', { class: 'banner banner-bad' }, [icon('warn'), el('div', {}, [el('b', { text: 'Go dark is on. ' }),
        `Every slot from ${S.data.goDark.from || 'today'}${S.data.goDark.to ? ` to ${S.data.goDark.to}` : ''} is held and cannot take a piece. ${S.data.goDark.reason || ''}`])]));
    }
    if (S.data.eventsEmpty) {
      out.push(el('div', { class: 'banner banner-info' }, [icon('warn'), el('div', { text: 'The events list is empty, so dark days, quiet windows and events come from the posting rules in channels.json. Import the India calendar under Recurring to add festivals and compliance dates.' })]));
    }
    return out;
  }

  function markerNodes(date, info, limit) {
    const evs = eventsOn(date).filter((e) => e.marker !== 'rule');
    const order = { dark: 0, 'greeting-only': 1, compliance: 2, event: 3, greeting: 4, quiet: 5 };
    evs.sort((a, b) => (order[a.marker] ?? 9) - (order[b.marker] ?? 9));
    const nodes = evs.slice(0, limit).map((e) => el('span', { class: `cal-mark cal-mark-${e.marker}`, title: `${MARKER_LABEL[e.marker] || e.marker}: ${e.name}${e.hint ? `. ${e.hint}` : ''}`, text: e.shortName || e.name }));
    if (evs.length > limit) nodes.push(el('span', { class: 'cal-more', text: `+${evs.length - limit} more` }));
    if (info.quiet && info.quietLabel && !evs.some((e) => e.marker === 'quiet')) nodes.push(el('span', { class: 'cal-mark cal-mark-quiet', title: info.quietLabel, text: 'Quiet window' }));
    return nodes;
  }

  function slotRow(s, { full }) {
    const label = s.piece?.hook || s.csv?.hook;
    let text;
    if (s.pieceId || s.csv) text = label || s.pieceId || 'Calendar row';
    else if (s.state === 'optional') text = 'Optional';
    else if (s.state === 'derived') text = s.kind === 'reshare' ? 'Reshare the strongest post' : 'Derived';
    else if (s.state === 'greeting-only') text = 'Greeting';
    else if (s.state === 'dark') text = 'Held (go dark)';
    else text = 'Open';
    const ps = s.state === 'filled' || s.pieceId ? (s.piece ? (APPROVED.includes(s.piece.status) ? 'ps-approved' : 'ps-pending') : 'ps-missing') : '';
    const row = el('div', {
      class: `cal-slot st-${s.state} ${ps}${S.focusSlot === s.id ? ' is-focus' : ''}`, dataset: { slot: s.id, kind: s.kind },
      title: `${accLabel(s.accountId)} · ${KIND_LABEL[s.kind] || s.kind}${s.time ? ` · ${s.time}` : ''} · ${text}`,
    }, [
      el('div', { class: 'cal-slot-top' }, [
        el('span', { class: 'cal-acc', text: accShort(s.accountId) }),
        el('span', { class: 'cal-time', text: s.time || (s.timeNote ? '' : '') }),
        el('span', { class: 'cal-kind', text: KIND_LABEL[s.kind] || s.kind }),
      ]),
      el('span', { class: 'cal-hook', text }),
    ]);
    row.addEventListener('click', (e) => { e.stopPropagation(); openDay(s.date, s.id); });
    // Drag a placed piece to another slot or day (desktop).
    if (s.pieceId && s.piece && matchMedia('(pointer: fine)').matches) {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        drag = { pieceId: s.pieceId, slotId: s.id, kind: s.kind };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', s.pieceId);
        row.classList.add('dragging');
        hidePop();
      });
      row.addEventListener('dragend', () => { row.classList.remove('dragging'); drag = null; for (const n of root.querySelectorAll('.drop-ok')) n.classList.remove('drop-ok'); });
    }
    // Dropping on a specific slot.
    row.addEventListener('dragover', (e) => { if (drag && s.id !== drag.slotId && !s.pieceId) { e.preventDefault(); e.stopPropagation(); row.classList.add('drop-ok'); } });
    row.addEventListener('dragleave', () => row.classList.remove('drop-ok'));
    row.addEventListener('drop', (e) => {
      if (!drag) return;
      e.preventDefault(); e.stopPropagation();
      row.classList.remove('drop-ok');
      const d = drag; drag = null;
      place(d.pieceId, { slotId: s.id, fromSlotId: d.slotId }, `Moved to ${shortDate(s.date)}`);
    });
    // Hover preview of the piece.
    if (s.piece && matchMedia('(hover: hover)').matches) {
      row.addEventListener('mouseenter', () => showPop(row, s));
      row.addEventListener('mouseleave', hidePop);
    }
    return row;
  }

  function dayCell(date, { full = false, outside = false } = {}) {
    const info = dayInfo(date);
    const slots = slotsOn(date).filter(passes);
    const evs = eventsOn(date).filter((e) => e.marker !== 'rule');
    const cls = ['cal-day'];
    if (outside) cls.push('is-out');
    if (date === S.data.today) cls.push('is-today');
    if (info.rule === 'dark' || info.goDark) cls.push('is-dark'); else if (info.rule === 'greeting-only') cls.push('is-gonly');
    if (info.quiet && info.rule === 'normal' && !info.goDark) cls.push('is-quiet');
    if (S.day === date) cls.push('is-selected');
    if (!slots.length && !evs.length && !info.quiet) cls.push('is-bare');
    const ruleText = info.goDark ? 'Go dark' : info.rule === 'dark' ? 'Dark' : info.rule === 'greeting-only' ? 'Greeting only' : '';
    const head = el('div', { class: 'cal-head' }, [
      el('span', { class: 'cal-num', text: String(+date.slice(8, 10)) }),
      el('span', { class: 'cal-wd', text: DOW_HEAD[(toDate(date).getUTCDay() + 6) % 7] }),
      ruleText && el('span', { class: 'cal-rule', text: ruleText, title: (info.goDark ? info.goDarkReason : info.reasons.join('; ')) || ruleText }),
    ]);
    const cell = el('div', { class: cls.join(' '), tabindex: '0', role: 'button', 'aria-label': `${longDate(date)}${ruleText ? `, ${ruleText.toLowerCase()}` : ''}, ${slots.length} slots`, dataset: { date } }, [
      head,
      el('div', { class: 'cal-marks' }, markerNodes(date, info, full ? 6 : 2)),
      ...slots.map((s) => slotRow(s, { full })),
    ]);
    cell.addEventListener('click', () => openDay(date));
    cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDay(date); } });
    // Dropping on a day: the first open slot that fits, or a new slot of the same kind.
    cell.addEventListener('dragover', (e) => { if (drag) { e.preventDefault(); cell.classList.add('drop-ok'); } });
    cell.addEventListener('dragleave', (e) => { if (!cell.contains(e.relatedTarget)) cell.classList.remove('drop-ok'); });
    cell.addEventListener('drop', (e) => {
      if (!drag) return;
      e.preventDefault(); cell.classList.remove('drop-ok');
      const d = drag; drag = null;
      place(d.pieceId, { date, fromSlotId: d.slotId, create: true }, `Moved to ${shortDate(date)}`);
    });
    return cell;
  }

  function drawGrid() {
    if (!S.data) return;
    const { from, to } = range();
    const grid = el('div', { class: `cal-grid${S.mode === 'week' ? ' is-week' : ''}`, role: 'grid' });
    if (S.mode === 'month') for (const d of DOW_HEAD) grid.appendChild(el('div', { class: 'cal-dow', text: d }));
    else for (const d of DOW_HEAD) grid.appendChild(el('div', { class: 'cal-dow', text: d }));
    for (const date of eachDay(from, to)) {
      grid.appendChild(dayCell(date, { full: S.mode === 'week', outside: S.mode === 'month' && date.slice(0, 7) !== S.month }));
    }
    body.replaceChildren(...banners(), legend(), grid, allottedPanel());
    root.classList.toggle('has-drawer', drawer.classList.contains('open'));
    // The toolbar shows the filters and the title, so it is rebuilt with the grid.
    toolbarHost.replaceChildren(drawToolbar());
  }

  // ---------------------------------------------------------- hover preview
  function previewFor(s) {
    const p = s.piece;
    if (['reel', 'trial', 'carousel', 'yt-short'].includes(s.kind)) return preview.instagram(p);
    if (['li', 'li-carousel'].includes(s.kind)) return preview.linkedin(p);
    if (s.kind === 'yt-long') return preview.youtube(p);
    return preview.status(p);
  }
  function showPop(anchor, s) {
    hidePop();
    if (drag) return;
    pop = el('div', { class: 'cal-pop' }, previewFor(s));
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const w = 300;
    let left = r.right + 10; if (left + w > window.innerWidth - 10) left = Math.max(10, r.left - w - 10);
    let top = r.top; const h = pop.offsetHeight;
    if (top + h > window.innerHeight - 10) top = Math.max(10, window.innerHeight - h - 10);
    pop.style.left = `${left}px`; pop.style.top = `${top}px`;
  }
  function hidePop() { if (pop) { pop.remove(); pop = null; } }

  // --------------------------------------------------------- allotted days
  function ruleList(items) {
    return el('ul', { class: 'cal-rules' }, items.map((t) => el('li', { text: t })));
  }
  function allottedPanel() {
    const rows = S.accounts.filter((a) => (a.weekly || []).length || (a.monthly || []).length);
    const tbl = el('table', { class: 'table' }, [
      el('thead', {}, el('tr', {}, ['Account', 'Weekly', 'Monthly', 'Also goes to'].map((h) => el('th', { text: h })))),
      el('tbody', {}, rows.map((a) => el('tr', {}, [
        el('td', {}, [el('b', { text: a.short }), el('div', { class: 'muted small', text: a.label }), a.role && el('div', { class: 'muted small', style: { marginTop: '4px' }, text: a.role })]),
        el('td', {}, ruleList((a.weekly || []).map((w) => `${w.day} ${w.time || w.timeNote || 'any time'}: ${KIND_LABEL[w.kind] || w.kind}${w.optional ? ' (optional)' : ''}${w.derived ? ' (derived)' : ''}${w.alternate ? ' (alternate weeks)' : ''}`))),
        el('td', {}, ruleList((a.monthly || []).map((m) => `${m.rule} ${m.time || m.timeNote || ''}: ${KIND_LABEL[m.kind] || m.kind}${m.skipMonths?.length ? ` (not in ${m.skipMonths.join(', ')})` : ''}`))),
        el('td', {}, ruleList([...new Set((a.repurposeTo || []).map((r) => accShort(r.accountId)))])),
      ]))),
    ]);
    const det = el('details', { class: 'cal-allot card' }, [
      el('summary', { text: 'Allotted days' }),
      el('div', { class: 'card-body' }, [
        el('p', { class: 'muted small', text: 'The fixed weekly and monthly slots for every account, read from the account settings. LinkedIn has one slot a week until 16 November 2026, then two, with a PDF carousel in alternate weeks from 25 November 2026 in place of Thursday\'s post.' }),
        el('div', { class: 'table-wrap' }, tbl),
        el('div', { style: { marginTop: '10px' } }, button({ kind: 'ghost', small: true, label: 'Change the rules in Settings', href: '#/settings?tab=accounts' })),
      ]),
    ]);
    return det;
  }

  // ------------------------------------------------------------ day panel
  function closeDay() {
    S.day = null; S.focusSlot = null;
    drawer.classList.remove('open'); backdrop.classList.remove('open');
    root.classList.remove('has-drawer');
    history.replaceState(null, '', hashFor({}));
    for (const n of root.querySelectorAll('.is-selected')) n.classList.remove('is-selected');
  }
  function openDay(date, slotId) {
    S.day = date; S.focusSlot = slotId || null;
    if (window.matchMedia('(max-width: 800px)').matches) backdrop.classList.add('open');
    drawer.classList.add('open');
    root.classList.add('has-drawer');
    for (const n of root.querySelectorAll('.cal-day')) n.classList.toggle('is-selected', n.dataset.date === date);
    drawPanel();
    rememberDay();
    if (slotId) {
      const target = drawer.querySelector(`[data-slotcard="${CSS.escape(slotId)}"]`);
      if (target) target.scrollIntoView({ block: 'center' });
    }
  }

  function drawPanel() {
    if (!S.day || !S.data) return;
    const date = S.day;
    const inRange = date >= S.data.from && date <= S.data.to;
    const info = dayInfo(date);
    const head = el('div', { class: 'cal-drawer-head' }, [
      button({ kind: 'ghost', small: true, icon: 'back', title: 'Previous day', onClick: () => stepDay(-1) }),
      el('h2', { text: longDate(date) }),
      button({ kind: 'ghost', small: true, icon: 'next', title: 'Next day', onClick: () => stepDay(1) }),
      button({ kind: 'ghost', small: true, icon: 'close', title: 'Close', onClick: closeDay }),
    ]);
    const pb = el('div', { class: 'cal-drawer-body' });
    if (!inRange) {
      pb.appendChild(empty({ title: 'This day is outside the visible range', hint: 'Open its month to see it.', action: button({ kind: 'secondary', label: 'Open the month', onClick: () => go(hashFor({ mode: 'month', month: date.slice(0, 7), day: date })) }) }));
      drawer.replaceChildren(head, pb);
      return;
    }
    if (info.goDark) pb.appendChild(el('div', { class: 'banner banner-bad' }, [icon('warn'), el('div', {}, [el('b', { text: 'Go dark. ' }), `${info.goDarkReason || 'Nothing is posted.'} Slots are held; none can take a piece.`])]));
    if (info.rule === 'dark') pb.appendChild(el('div', { class: 'banner banner-bad' }, [icon('warn'), el('div', {}, [el('b', { text: 'Dark day. ' }), `${info.reasons.join('; ') || 'Do not post.'} No post is planned; a piece cannot be placed here.`])]));
    if (info.rule === 'greeting-only') pb.appendChild(el('div', { class: 'banner banner-warn' }, [icon('warn'), el('div', {}, [el('b', { text: 'Greeting only. ' }), `${info.reasons.join('; ') || 'Greeting only.'} Only a plain greeting goes out today.`])]));
    if (info.quiet) pb.appendChild(el('div', { class: 'banner banner-info' }, [icon('warn'), el('div', { text: info.quietLabel || 'Quiet window: calls come first; nothing new is tried.' })]));

    const evs = eventsOn(date);
    if (evs.length) {
      pb.appendChild(el('div', { class: 'cal-evs' }, evs.map((e) => el('div', { class: 'cal-ev' }, [
        chip({ label: MARKER_LABEL[e.marker] || e.marker, tone: MARKER_TONE[e.marker] || 'muted' }),
        el('div', {}, [el('div', { text: e.name }), e.hint && el('p', { class: 'note', text: e.hint }), e.note && el('p', { class: 'note', text: e.note })]),
      ]))));
    }

    const slots = slotsOn(date);
    if (!slots.length) pb.appendChild(el('p', { class: 'muted', style: { margin: '12px 0' }, text: info.rule === 'dark' ? 'No slots are planned on a dark day.' : 'No slots on this day.' }));
    for (const s of slots) pb.appendChild(slotCard(s));
    if (info.rule === 'normal' && !info.goDark) {
      pb.appendChild(el('div', { class: 'cal-btns' }, [button({ kind: 'secondary', small: true, icon: 'plus', label: 'Add a slot', onClick: () => addSlot(date) })]));
    }
    drawer.replaceChildren(head, pb);
  }
  function stepDay(n) {
    const next = addDays(S.day, n);
    if (next < S.data.from || next > S.data.to) { go(hashFor({ mode: S.mode, month: next.slice(0, 7), anchor: mondayOf(next), day: next })); return; }
    openDay(next);
  }

  /** The editor route for a new piece made from this slot: type, account, day and time travel with it. */
  function newPieceHash(slot) {
    const fits = S.data.fit?.[slot.kind] || [];
    const q = new URLSearchParams();
    q.set('slotId', slot.id);
    if (fits[0]) q.set('type', fits[0]);
    q.set('date', slot.date);
    if (slot.time) q.set('time', slot.time);
    q.set('targets', slot.accountId);
    return `#/content/new?${q.toString()}`;
  }
  function repurposeFor(slot) {
    const acc = S.byAcc[slot.accountId];
    return (acc?.repurposeTo || []).filter((r) => !r.when || !r.when.kind || r.when.kind === slot.kind);
  }
  /** The plan's reason for this slot, from the account's weekly or monthly rule of the same kind. */
  function whyFor(slot) {
    const acc = S.byAcc[slot.accountId];
    if (!acc) return '';
    const dow = toDate(slot.date).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
    const weekly = (acc.weekly || []).find((w) => w.kind === slot.kind && w.day === dow) || (acc.weekly || []).find((w) => w.kind === slot.kind);
    const monthly = (acc.monthly || []).find((m) => m.kind === slot.kind);
    return (weekly || monthly)?.why || '';
  }

  function slotCard(s) {
    const piece = s.piece;
    const ps = s.pieceId ? (piece ? (APPROVED.includes(piece.status) ? 'ps-approved' : 'ps-pending') : 'ps-missing') : '';
    const card = el('section', { class: `cal-slotcard st-${s.state} ${ps}${S.focusSlot === s.id ? ' is-focus' : ''}`, dataset: { slotcard: s.id } });
    card.appendChild(el('div', { class: 'cal-slotcard-head' }, [
      el('span', { class: 'cal-acc', text: accShort(s.accountId) }),
      s.time ? el('span', { class: 'cal-time', text: s.time }) : (s.timeNote ? el('span', { class: 'cal-time', text: s.timeNote }) : null),
      chip({ label: KIND_LABEL[s.kind] || s.kind, tone: 'muted' }),
      el('span', { class: 'grow' }),
      statusPill(s.state),
    ]));
    card.appendChild(el('h3', { text: s.label || KIND_LABEL[s.kind] || s.kind }));
    if (s.reason && s.state !== 'filled') card.appendChild(el('p', { class: 'cal-reason', text: s.reason }));
    card.appendChild(el('p', { class: 'muted small', style: { margin: '0 0 4px' }, text: accLabel(s.accountId) }));
    const why = whyFor(s);
    if (why) card.appendChild(el('details', { class: 'cal-why' }, [el('summary', { text: 'Why this slot' }), el('p', { text: why })]));

    if (s.pieceId) {
      const pbox = el('div', { class: 'cal-piece' });
      if (piece) {
        pbox.appendChild(el('div', { class: 'cal-piece-hook', text: piece.hook || piece.id }));
        pbox.appendChild(el('div', { class: 'row' }, [chip({ label: S.data.typeNames?.[piece.type] || piece.type, tone: 'muted' }), statusPill(piece.status), piece.pillar && chip({ label: piece.pillar })]));
        if (!APPROVED.includes(piece.status)) pbox.appendChild(el('p', { class: 'note', style: { margin: '6px 0 0' }, text: 'Not approved yet. Approval happens in the review queue.' }));
      } else {
        pbox.appendChild(el('div', { class: 'cal-piece-hook', text: s.csv?.hook || s.pieceId }));
        pbox.appendChild(el('p', { class: 'note', style: { margin: 0 }, text: `From calendar.csv${s.csv?.id ? ` (${s.csv.id})` : ''}. The piece is not in the library yet; run the content import.` }));
      }
      if (s.csv?.notes) pbox.appendChild(el('p', { class: 'note', style: { margin: '6px 0 0' }, text: s.csv.notes }));
      card.appendChild(pbox);
      const btns = el('div', { class: 'cal-btns' });
      if (piece) btns.appendChild(button({ kind: 'secondary', small: true, icon: 'edit', label: 'Open piece', href: `#/content/${encodeURIComponent(piece.id)}` }));
      if (piece) btns.appendChild(button({ kind: 'secondary', small: true, label: 'Move', onClick: () => moveDialog(s) }));
      btns.appendChild(button({ kind: 'ghost', small: true, label: 'Take out', onClick: () => unplace(s) }));
      card.appendChild(btns);
    } else if (s.csv) {
      card.appendChild(el('div', { class: 'cal-piece' }, [el('div', { class: 'cal-piece-hook', text: s.csv.hook || s.csv.id }), el('p', { class: 'note', style: { margin: 0 }, text: 'A calendar row with no piece yet.' })]));
    } else if (['open', 'optional', 'greeting-only'].includes(s.state)) {
      const fits = (S.data.fit?.[s.kind] || []).map((t) => S.data.typeNames?.[t] || t);
      card.appendChild(el('p', { class: 'muted small', style: { margin: '4px 0 0' }, text: fits.length ? `Takes: ${fits.join(', ')}.` : 'Nothing is placed in this slot.' }));
      const btns = el('div', { class: 'cal-btns' }, [
        button({ kind: 'primary', small: true, label: 'Pick a piece', onClick: () => pickDialog(s) }),
        button({ kind: 'secondary', small: true, label: 'Create new', onClick: () => go(newPieceHash(s)) }),
      ]);
      if (s.source === 'manual') btns.appendChild(button({ kind: 'ghost', small: true, icon: 'trash', label: 'Remove slot', onClick: () => removeSlot(s) }));
      card.appendChild(btns);
    } else if (s.state === 'derived') {
      card.appendChild(el('p', { class: 'cal-reason', text: s.kind === 'reshare' ? 'Derived: reshare the week\'s strongest post from Palak\'s LinkedIn, with one line. Nothing is placed here.' : s.kind === 'family' ? 'Derived: the month\'s most-sent Reel, chosen at the time.' : 'Derived from another post.' }));
    }

    const rp = repurposeFor(s);
    if (rp.length) {
      card.appendChild(el('div', { class: 'cal-repurpose-title', text: 'Also goes to' }));
      card.appendChild(el('ul', { class: 'cal-repurpose' }, rp.map((r) => el('li', {}, [el('b', { text: accShort(r.accountId) }), el('span', { text: r.how })]))));
    }
    return card;
  }

  async function removeSlot(s) {
    if (!(await confirm({ title: 'Remove this slot', message: 'The slot you added by hand is deleted.', confirmLabel: 'Remove', danger: true }))) return;
    try { await api.del(`/slots/${encodeURIComponent(s.id)}`); await refresh(); } catch (err) { toast(err.message, 'bad'); }
  }

  function addSlot(date) {
    const accounts = S.accounts.filter((a) => a.platform !== 'in-person');
    const kinds = Object.keys(S.data.fit || {});
    const accSel = select({ options: accounts.map((a) => ({ value: a.id, label: `${a.short} · ${a.label}` })), value: accounts[0]?.id });
    const kindSel = select({ options: kinds.map((k) => ({ value: k, label: KIND_LABEL[k] || k })), value: 'reel' });
    const time = input({ type: 'time', value: '19:30', class: 'mono' });
    const d = dialog({
      title: `Add a slot on ${shortDate(date)}`,
      body: el('div', {}, [
        el('p', { class: 'muted small', text: 'For a post outside the weekly rules. It is kept when slots are regenerated.' }),
        field({ label: 'Account', input: accSel }), field({ label: 'Kind', input: kindSel }), field({ label: 'Time', input: time }),
      ]),
      actions: [
        button({ kind: 'secondary', label: 'Cancel', onClick: () => d.close() }),
        button({ kind: 'primary', label: 'Add the slot', onClick: async () => {
          try {
            await api.post('/slots', {
              date, time: time.value, accountId: accSel.value, kind: kindSel.value, label: KIND_LABEL[kindSel.value] || kindSel.value,
              state: 'open', baseState: 'open', source: 'manual', generated: false,
            });
            d.close(); toast('Slot added', 'ok'); await refresh();
          } catch (err) { toast(err.message, 'bad'); }
        } }),
      ],
    });
  }

  // ------------------------------------------------- pick a piece (library)
  async function pickDialog(slot) {
    let pieces;
    try { pieces = await getPieces(true); } catch (err) { toast(err.message, 'bad'); return; }
    const fits = S.data.fit?.[slot.kind] || [];
    const list = pieces.filter((p) => fits.includes(p.type) && p.status !== 'retired')
      .sort((a, b) => (STATUS_RANK[a.status] ?? 8) - (STATUS_RANK[b.status] ?? 8) || String(a.hook).localeCompare(String(b.hook)));
    const results = el('div', { class: 'cal-pick' });
    const search = input({ type: 'search', placeholder: 'Search the hook', 'aria-label': 'Search the library' });
    let d;
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const rows = list.filter((p) => !q || String(p.hook || '').toLowerCase().includes(q) || String(p.id).toLowerCase().includes(q));
      results.replaceChildren(...(rows.length ? rows.map((p) => {
        const b = el('button', { class: 'cal-pick-row', type: 'button' }, [
          el('div', { class: 'cal-pick-main' }, [
            el('div', { class: 'cal-pick-hook', text: p.hook || p.id }),
            el('div', { class: 'cal-pick-sub', text: [S.data.typeNames?.[p.type] || p.type, p.pillar, p.plannedDate ? `already planned ${shortDate(p.plannedDate)}` : 'not scheduled'].filter(Boolean).join(' · ') }),
          ]),
          el('div', { class: 'row', style: { flexWrap: 'nowrap' } }, [checkChip(p), statusPill(p.status)]),
        ]);
        b.addEventListener('click', async () => { const r = await place(p.id, { slotId: slot.id }); if (r) d.close(); });
        return b;
      }) : [el('div', { class: 'empty-inline', style: { padding: '14px' }, text: list.length ? 'No piece matches the search.' : 'No piece of a fitting type is in the library yet.' })]));
    };
    search.addEventListener('input', draw);
    d = dialog({
      title: `Pick a piece for ${accShort(slot.accountId)} ${KIND_LABEL[slot.kind] || slot.kind}, ${shortDate(slot.date)}`,
      wide: true,
      body: el('div', {}, [
        el('p', { class: 'muted small', text: `This slot takes: ${fits.map((t) => S.data.typeNames?.[t] || t).join(', ')}. Approved pieces come first; the chip shows how each stands with the checker.` }),
        search, results,
      ]),
      actions: [
        button({ kind: 'secondary', label: 'Create new', onClick: () => { d.close(); go(newPieceHash(slot)); } }),
        button({ kind: 'secondary', label: 'Close', onClick: () => d.close() }),
      ],
    });
    draw();
  }

  // ------------------------------------------------------------ move dialog
  function moveDialog(slot) {
    const piece = slot.piece;
    const dateIn = input({ type: 'date', value: slot.date, class: 'mono', 'aria-label': 'New date' });
    const holder = el('div');
    let choice = null;
    let d;
    const confirmBtn = button({ kind: 'primary', label: 'Move here', disabled: true, onClick: async () => {
      if (!choice) return;
      const r = await place(piece.id, { ...choice, fromSlotId: slot.id }, `Moved to ${shortDate(dateIn.value)}`);
      if (r) d.close();
    } });
    async function look() {
      choice = null; confirmBtn.disabled = true;
      const date = dateIn.value;
      if (!isYmd(date)) { holder.replaceChildren(); return; }
      holder.replaceChildren(el('div', { class: 'loading', text: 'Checking the day' }));
      let data;
      try { data = await api.get('/calendar', { from: date, to: date }); } catch (err) { holder.replaceChildren(el('div', { class: 'banner banner-bad', text: err.message })); return; }
      const info = data.days[date];
      const nodes = [];
      if (info.goDark) nodes.push(el('div', { class: 'banner banner-bad' }, [icon('warn'), el('div', { text: `${shortDate(date)} falls under go dark. ${info.goDarkReason || ''}` })]));
      else if (info.rule === 'dark') nodes.push(el('div', { class: 'banner banner-bad' }, [icon('warn'), el('div', { text: `${shortDate(date)} is a dark day: ${info.reasons.join('; ')}. Choose another date.` })]));
      else if (info.rule === 'greeting-only' && piece.type !== 'greeting') nodes.push(el('div', { class: 'banner banner-warn' }, [icon('warn'), el('div', { text: `${shortDate(date)} is greeting only: ${info.reasons.join('; ')}. Only a plain greeting can go here.` })]));
      else {
        for (const e of data.events.filter((x) => x.marker === 'compliance')) nodes.push(el('p', { class: 'note', text: `${e.name}: ${e.hint}` }));
        if (info.quiet) nodes.push(el('p', { class: 'note', text: info.quietLabel || 'Quiet window.' }));
        const fits = data.fit[slot.kind] ? data.fit : S.data.fit;
        const open = data.slots.filter((x) => x.id !== slot.id && !x.pieceId && !x.csv && ['open', 'optional', 'greeting-only'].includes(x.state) && (fits[x.kind] || []).includes(piece.type));
        const options = open.map((x) => ({ label: `${accShort(x.accountId)} ${KIND_LABEL[x.kind] || x.kind}${x.time ? ` at ${x.time}` : ''} (open slot)`, body: { slotId: x.id } }));
        if (date !== slot.date) options.push({ label: `A new ${KIND_LABEL[slot.kind] || slot.kind} slot for ${accShort(slot.accountId)} on this date`, body: { date, accountId: slot.accountId, kind: slot.kind, create: true } });
        if (!options.length) nodes.push(el('p', { class: 'muted', text: 'There is no open slot on this day that takes this piece.' }));
        options.forEach((o, i) => {
          const radio = el('input', { type: 'radio', name: 'cal-move', value: String(i) });
          const row = el('label', { class: 'cal-choice' }, [radio, el('span', { text: o.label })]);
          radio.addEventListener('change', () => {
            choice = o.body; confirmBtn.disabled = false;
            for (const n of holder.querySelectorAll('.cal-choice')) n.classList.toggle('is-on', n === row);
          });
          nodes.push(row);
        });
      }
      holder.replaceChildren(...nodes);
      holder.querySelector('.cal-choice input')?.click();
    }
    dateIn.addEventListener('change', look);
    d = dialog({
      title: 'Move this piece',
      body: el('div', {}, [
        el('p', { text: piece.hook || piece.id, style: { fontWeight: '700', color: 'var(--navy)' } }),
        el('p', { class: 'muted small', text: `Now on ${shortDate(slot.date)}, ${accShort(slot.accountId)} ${KIND_LABEL[slot.kind] || slot.kind}. The server checks the kind of slot and refuses dark days.` }),
        field({ label: 'Move to', input: dateIn }), holder,
      ]),
      actions: [button({ kind: 'secondary', label: 'Cancel', onClick: () => d.close() }), confirmBtn],
    });
    look();
  }

  // ---------------------------------------------------------------- boot
  toolbarHost.replaceChildren(drawToolbar());
  body.appendChild(el('div', { class: 'cal-loading', text: 'Loading the calendar' }));
  const ok = await load();
  if (disposed) return cleanup;
  loadStrip();
  if (ok) {
    // A piece just made for a slot is placed first, then the slot opens.
    if (query.place && query.slot) {
      const res = await place(query.place, { slotId: query.slot }, 'The new piece is in the calendar');
      if (res?.slot) {
        if (res.slot.date.slice(0, 7) !== S.month && S.mode === 'month') { go(hashFor({ month: res.slot.date.slice(0, 7), day: res.slot.date, slot: res.slot.id })); return cleanup; }
        S.day = res.slot.date; S.focusSlot = res.slot.id;
      }
    } else if (query.slot) {
      try {
        const sl = await api.get(`/slots/${encodeURIComponent(query.slot)}`);
        if (sl.date.slice(0, 7) !== S.month && S.mode === 'month') { go(hashFor({ month: sl.date.slice(0, 7), day: sl.date, slot: sl.id })); return cleanup; }
        S.day = sl.date; S.focusSlot = sl.id;
      } catch { /* the slot is gone */ }
    }
    drawGrid();
    if (S.day) openDay(S.day, S.focusSlot);
  }
  return cleanup;
}
