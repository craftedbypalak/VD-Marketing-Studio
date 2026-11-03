// Occasions: every dated day in one calendar, sorted by category; the branded greeting image for each
// festival; festival ideas for the big ones; and announcements. [recurring]
//
// Each occasion has one post type: greeting plus an idea post (big festivals), greeting only, or no post.
// Greetings are branded images (cards/festivalGreeting.js) and go to everyone (3 November 2026).
// Plain-text one-to-one wishes belong to the Network tool. The mourning switch is in Settings.

import { api } from '../api.js';
import { roleOf } from '../roles.js';
import { el, card, field, input, textarea, select, button, chip, checkbox, tabs, toast, dialog, confirm, empty, fmt, bullets } from '../ui.js';
import { ready as cardsReady } from '../cards/index.js';
import * as greetingCard from '../cards/festivalGreeting.js';
import { svgToPng, downloadBlob } from '../cards/png.js';
import { setBrand, setCards } from '../cards/_kit.js';

export const route = '#/occasions';
export const title = 'Occasions';

// The occasion settings: settings.occasions, edited in Builder, Occasions (app/js/builder/boxes/occasions.js).
// The same fallbacks as server/recurring.mjs (occasionsConfig).
export const OCCASION_DEFAULTS = Object.freeze({
  greetingTime: '19:00', statusAccount: 'wa-st', conceptYears: 4,
  conceptTypes: Object.freeze({ 'reel-animated': 'reel', broll: 'reel', carousel: 'carousel', 'status-rule': 'status' }),
});
const isTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || ''));
export function occasionsConfig(settings) {
  const o = (settings && typeof settings.occasions === 'object' && settings.occasions) || {};
  const d = OCCASION_DEFAULTS;
  const years = Math.round(Number(o.conceptYears));
  const types = {};
  if (o.conceptTypes && typeof o.conceptTypes === 'object' && !Array.isArray(o.conceptTypes)) {
    for (const [k, v] of Object.entries(o.conceptTypes)) if (String(k).trim() && String(v || '').trim()) types[String(k).trim()] = String(v).trim();
  }
  return {
    greetingTime: [o.greetingTime, settings?.calendar?.greetingTime, d.greetingTime].find(isTime),
    statusAccount: String(o.statusAccount || '').trim() || d.statusAccount,
    conceptYears: o.conceptYears !== null && o.conceptYears !== undefined && o.conceptYears !== '' && Number.isFinite(years) && years >= 1 && years <= 50 ? years : d.conceptYears,
    conceptTypes: Object.keys(types).length ? types : { ...d.conceptTypes },
  };
}
let OCC = occasionsConfig(null);

const TABS = [
  { id: 'events', label: 'Calendar', about: () => ['Every festival and important date', 'Choose what we post for each'] },
  { id: 'greetings', label: 'Greetings', about: () => ['A branded greeting image per festival', `Posted the evening before, at ${OCC.greetingTime}`, 'Goes to everyone'] },
  { id: 'concepts', label: 'Festival ideas', about: () => ['Big festivals only', 'A post that links the festival to our work', 'Goes out a few days before; pick one of three ideas'] },
  { id: 'announcements', label: 'Announcements', about: () => ['News about us: a launch, an offer, an event', 'Write the facts once, get a post per account'] },
];

// What an occasion is. Set on each event as `category` (server/recurring.mjs, categoryOf).
const CATEGORIES = ['festival', 'national', 'business', 'wedding', 'local', 'break'];
const CATEGORY_LABEL = { festival: 'Festival', national: 'National day', business: 'Tax and business', wedding: 'Wedding date', local: 'Local event', break: 'Holiday break' };
const CATEGORY_PLURAL = { festival: 'Festivals', national: 'National days', business: 'Tax and business dates', wedding: 'Wedding dates', local: 'Local events', break: 'Holiday breaks' };
const DEFAULT_CATEGORIES = ['festival', 'national'];
const categoryOf = (e) => (CATEGORIES.includes(e.category) ? e.category : 'festival');

// What we post for it.
const POSTS = ['creative', 'wish', 'none'];
const POST_LABEL = { creative: 'Greeting and idea', wish: 'Greeting', none: 'No post' };
const POST_TONE = { creative: 'accent', wish: 'navy', none: 'muted' };
const GREETING_KINDS = ['greeting', 'greeting-only'];
const postOf = (e) => (e.conceptAllowed ? 'creative' : GREETING_KINDS.includes(e.kind) && e.greetingText ? 'wish' : 'none');
const defaultWish = (name) => `Wishing you and your family a happy ${name}. Palak Gupta, Venture Drafters`;
const CONCEPT_TYPE_LABEL = { broll: 'B-roll video', 'reel-animated': 'Animated reel', carousel: 'Carousel', 'status-rule': 'Status rule' };
const conceptTypeOptions = () => Object.keys(OCC.conceptTypes).map((value) => ({ value, label: CONCEPT_TYPE_LABEL[value] || cap(value.replace(/-/g, ' ')) }));

const RULES = ['normal', 'greeting-only', 'dark', 'quiet'];
const RULE_LABEL = { normal: 'Post as usual', 'greeting-only': 'Greeting only', dark: 'No posting', quiet: 'Quiet' };
const RULE_TONE = { normal: 'default', 'greeting-only': 'warn', dark: 'bad', quiet: 'muted' };
const CAMPAIGN_KINDS = ['announcement', 'launch', 'offer', 'event', 'milestone'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_ANNOUNCE_TARGETS = ['vd-li', 'p-li', 'wa-st'];

const pad = (n) => String(n).padStart(2, '0');
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const ymdLocal = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthLabel = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const weekdayOf = (ymd) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${ymd}T00:00:00Z`).getUTCDay()];
const shortOf = (ev) => ev.shortName || ev.name;

function ensureCss() {
  if (document.getElementById('recurring-css')) return;
  document.head.appendChild(el('link', { id: 'recurring-css', rel: 'stylesheet', href: 'css/recurring.css' }));
}

/** A failed AI call: a toast with the hint, never a raw stack. */
function aiFailure(err, what) {
  const hint = err.status === 502 || err.status === 503 || err.status === 0 || err.status === 500
    ? ' Run claude and /login in a terminal, then try again.' : '';
  toast(`${what} did not complete. ${err.status === 504 ? 'Claude took too long to answer.' : 'Claude could not be reached.'}${hint}`, 'bad', { ms: 7000 });
}

/** A run of prose (an AI scene) as one bullet a sentence. */
function sentenceBullets(text) {
  const parts = String(text || '').split(/(?<=[.?!])\s+/).map((x) => x.trim()).filter(Boolean);
  return parts.length ? bullets(parts, { compact: true }) : null;
}

function ruleChip(rule) { return chip({ label: RULE_LABEL[rule] || rule, tone: RULE_TONE[rule] || 'default' }); }

export async function render(container, params) {
  ensureCss();
  let events;
  let accounts;
  let approver = false;   // a manager or the director: imports, expands, allows concepts
  let director = false;   // deletes (docs/ROLES.md section 3)
  try {
    let settings;
    [events, accounts, settings] = await Promise.all([api.get('/events'), api.get('/accounts'), api.settings().catch(() => null)]);
    const me = (api.user.get() || '').toLowerCase();
    setBrand(settings?.brand); setCards(settings?.cards);
    OCC = occasionsConfig(settings);
    const role = roleOf((settings?.users || []).find((u) => String(u.email).toLowerCase() === me));
    approver = Boolean(me) && (role === 'manager' || role === 'director');
    director = Boolean(me) && role === 'director';
  } catch (err) {
    container.appendChild(el('div', { class: 'banner banner-bad', text: `Could not load events: ${err.message}` }));
    return;
  }

  const panel = el('div');
  const tabIds = TABS.map((t) => t.id);
  const bar = tabs({
    items: TABS,
    active: tabIds.includes(params.query?.tab) ? params.query.tab : 'events',
    onChange: (id) => { history.replaceState(null, '', `#/occasions?tab=${id}`); show(id); },
  });
  bar.classList.add('rc-tabs');
  const about = el('div', { class: 'rc-about' });
  container.append(bar, about, panel);

  const views = { events: eventsTab, greetings: greetingsTab, concepts: conceptsTab, announcements: announcementsTab };
  async function show(id) {
    const tab = TABS.find((t) => t.id === id);
    about.replaceChildren(tab ? bullets(tab.about(), { compact: true }) : '');
    panel.replaceChildren(el('div', { class: 'loading', text: 'Loading' }));
    try {
      const node = await views[id]();
      panel.replaceChildren(node);
    } catch (err) {
      panel.replaceChildren(el('div', { class: 'banner banner-bad', text: `Could not show this tab: ${err.message}` }));
    }
  }
  async function reloadEvents() { events = await api.get('/events'); }
  show(bar.dataset.active);

  // ============================================================= calendar
  async function eventsTab() {
    const f = { cats: new Set(DEFAULT_CATEGORIES), post: '', q: '', month: '', day: '' };
    const today = ymdLocal();
    const months = [...new Set(events.map((e) => e.date.slice(0, 7)))].sort();
    f.month = months.includes(today.slice(0, 7)) ? today.slice(0, 7) : (months[0] || today.slice(0, 7));

    const root = el('div');
    if (!events.length) {
      root.appendChild(empty({
        title: 'No occasions yet',
        hint: 'Import the India calendar to begin.',
        action: button({ kind: 'primary', label: 'Import the India calendar', icon: 'upload', onClick: runImport }),
      }));
      return root;
    }

    const counts = Object.fromEntries(CATEGORIES.map((c) => [c, events.filter((e) => categoryOf(e) === c).length]));
    const catBar = el('div', { class: 'rc-cats', role: 'group', 'aria-label': 'Show' });
    function drawCats() {
      catBar.replaceChildren(...CATEGORIES.filter((c) => counts[c]).map((c) => el('button', {
        type: 'button', class: `rc-cat${f.cats.has(c) ? ' on' : ''}`, 'aria-pressed': String(f.cats.has(c)),
        onClick: () => { if (f.cats.has(c)) f.cats.delete(c); else f.cats.add(c); drawCats(); redraw(); },
      }, [el('span', { text: CATEGORY_PLURAL[c] }), el('span', { class: 'rc-cat-n', text: String(counts[c]) })])));
    }
    drawCats();
    const postSel = select({ options: [{ value: '', label: 'Any post' }, ...POSTS.map((k) => ({ value: k, label: POST_LABEL[k] }))], value: '', 'aria-label': 'Post', onChange: (e) => { f.post = e.target.value; redraw(); } });
    const search = input({ type: 'search', placeholder: 'Search', 'aria-label': 'Search', onInput: (e) => { f.q = e.target.value.trim().toLowerCase(); redraw(); } });

    root.appendChild(el('div', { class: 'rc-toolbar rc-toolbar-stack' }, [
      catBar,
      el('div', { class: 'rc-toolbar-row' }, [
        postSel, search,
        el('span', { class: 'rc-spacer' }),
        button({ kind: 'primary', label: 'Add', icon: 'plus', onClick: () => editEvent(null) }),
        approver && button({ kind: 'ghost', label: 'Import again', icon: 'upload', onClick: runImport, title: 'Adds missing days from the India calendar' }),
      ]),
    ]));

    const strip = el('div');
    const list = el('div');
    root.append(strip, list);

    const passes = (e) => f.cats.has(categoryOf(e)) && (!f.post || postOf(e) === f.post)
      && (!f.q || `${e.name} ${e.shortName || ''} ${e.note || ''}`.toLowerCase().includes(f.q));
    const matches = (e) => passes(e) && (!f.month || e.date.startsWith(f.month)) && (!f.day || e.date === f.day);

    function drawStrip() {
      const [y, m] = f.month.split('-').map(Number);
      const first = new Date(Date.UTC(y, m - 1, 1));
      const lead = (first.getUTCDay() + 6) % 7;
      const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const byDate = new Map();
      for (const e of events) {
        if (!passes(e) || !e.date.startsWith(f.month)) continue;
        if (!byDate.has(e.date)) byDate.set(e.date, []);
        byDate.get(e.date).push(e);
      }
      const idx = months.indexOf(f.month);
      const head = el('div', { class: 'rc-month-head' }, [
        el('div', { class: 'rc-month-title', text: monthLabel(f.month) }),
        el('div', { class: 'rc-month-nav' }, [
          f.day && button({ kind: 'ghost', small: true, label: 'Whole month', onClick: () => { f.day = ''; redraw(); } }),
          button({ kind: 'secondary', small: true, icon: 'back', title: 'Previous month', disabled: idx <= 0, onClick: () => { f.month = months[idx - 1]; f.day = ''; redraw(); } }),
          button({ kind: 'secondary', small: true, icon: 'next', title: 'Next month', disabled: idx < 0 || idx >= months.length - 1, onClick: () => { f.month = months[idx + 1]; f.day = ''; redraw(); } }),
        ]),
      ]);
      const grid = el('div', { class: 'rc-grid' }, DOW.map((d) => el('div', { class: 'rc-dow', text: d })));
      for (let i = 0; i < lead; i++) grid.appendChild(el('div', { class: 'rc-day blank' }));
      for (let d = 1; d <= nDays; d++) {
        const date = `${f.month}-${pad(d)}`;
        const evs = byDate.get(date) || [];
        const classes = ['rc-day', date === today && 'today', f.day === date && 'picked'].filter(Boolean).join(' ');
        const label = evs.map((e) => `${shortOf(e)} (${POST_LABEL[postOf(e)]})`).join('; ');
        grid.appendChild(el('button', {
          class: classes, type: 'button', title: label || fmt.date(date), 'aria-label': `${fmt.date(date)}${label ? `: ${label}` : ''}`,
          onClick: () => { f.day = f.day === date ? '' : date; redraw(); },
        }, [
          el('span', { class: 'rc-day-n', text: String(d) }),
          el('span', { class: 'rc-dots' }, evs.slice(0, 6).map((e) => el('i', { class: `rc-dot post-${postOf(e)}` }))),
        ]));
      }
      const legend = el('div', { class: 'rc-legend' }, POSTS.map((k) => el('span', {}, [el('i', { class: `rc-dot post-${k}` }), POST_LABEL[k]])));
      strip.replaceChildren(el('div', { class: 'rc-month' }, [head, grid, legend]));
    }

    function drawList() {
      const rows = events.filter(matches).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
      const head = el('div', { class: 'section-title' }, [
        el('h2', { text: f.day ? fmt.date(f.day) : monthLabel(f.month) }),
        el('span', { class: 'count', text: String(rows.length) }),
      ]);
      const body = el('div', { class: 'card', style: { padding: '0 6px' } });
      if (!rows.length) body.appendChild(el('div', { class: 'empty-inline', style: { padding: '18px 12px' }, text: f.cats.size ? 'Nothing this month.' : 'Choose what to show above.' }));
      for (const e of rows) body.appendChild(eventRow(e));
      list.replaceChildren(el('div', { class: 'rc-list' }, [head, body]));
    }

    function eventRow(e) {
      const post = postOf(e);
      return el('div', { class: 'list-row', role: 'button', tabindex: '0', onClick: () => editEvent(e), onKeydown: (k) => { if (k.key === 'Enter') editEvent(e); } }, [
        el('div', { class: 'rc-date' }, [el('b', { text: fmt.date(e.date).replace(/ \d{4}$/, '') }), e.weekday || weekdayOf(e.date)]),
        el('div', { class: 'list-main' }, [
          el('div', { class: 'list-title', title: e.name, text: shortOf(e) }),
          el('div', { class: 'rc-row-chips' }, [
            chip({ label: CATEGORY_LABEL[categoryOf(e)], tone: 'muted' }),
            chip({ label: POST_LABEL[post], tone: POST_TONE[post] }),
            e.postingRule && e.postingRule !== 'normal' && ruleChip(e.postingRule),
          ]),
        ]),
      ]);
    }

    function redraw() { drawStrip(); drawList(); }
    redraw();
    return root;
  }

  async function runImport() {
    try {
      const r = await api.post('/recurring/import', {});
      toast(r.created ? `Imported ${r.created} events; ${r.alreadyPresent} were already present` : 'Nothing new to import; every seed event is already present', r.created ? 'ok' : 'info');
      await reloadEvents();
      show(bar.dataset.active);
    } catch (err) { toast(err.message, 'bad'); }
  }

  // ------------------------------------------------------------ editor
  function editEvent(ev) {
    const isNew = !ev;
    const e = ev ? { ...ev } : {
      date: ymdLocal(), name: '', shortName: '', kind: 'event', category: 'festival', scope: 'national', postingRule: 'normal',
      whoGets: 'none', greetingText: '', confidence: 'expected', recurrence: 'manual', tiers: [], note: '', source: '',
    };
    const date = input({ type: 'date', value: e.date, class: 'mono' });
    const name = input({ value: e.name, placeholder: 'For example, Diwali' });
    const category = select({ options: CATEGORIES.map((k) => ({ value: k, label: CATEGORY_LABEL[k] })), value: categoryOf(e) });
    const post = select({ options: POSTS.map((k) => ({ value: k, label: POST_LABEL[k], disabled: k === 'creative' && !approver && postOf(e) !== 'creative' })), value: postOf(e) });
    const rule = select({ options: RULES.map((k) => ({ value: k, label: RULE_LABEL[k] })), value: e.postingRule || 'normal' });
    const text = textarea({ value: e.greetingText || '', rows: 3, placeholder: defaultWish(e.shortName || e.name || 'the day') });
    const note = textarea({ value: e.note || '', rows: 2 });
    const wishField = field({ label: 'Greeting line', input: text, hint: 'Shown on the greeting image under the festival name.' });
    const syncWish = () => { wishField.hidden = post.value === 'none'; };
    post.addEventListener('change', syncWish);
    syncWish();
    const body = el('div', {}, [
      el('div', { class: 'form-grid' }, [
        field({ label: 'Date', input: date }),
        field({ label: 'Name', input: name }),
        field({ label: 'Category', input: category }),
        field({ label: 'Post', input: post, hint: approver ? '' : 'A manager or the director sets festival ideas.' }),
        field({ label: 'Other posts that day', input: rule }),
      ]),
      wishField,
      field({ label: 'Note', input: note }),
      e.generated?.pieceId && el('p', { class: 'note', text: `Wish piece: ${e.generated.pieceId}` }),
    ]);
    const d = dialog({
      title: isNew ? 'Add an occasion' : shortOf(e),
      wide: true,
      body,
      actions: [
        !isNew && director && button({ kind: 'danger', label: 'Delete', icon: 'trash', onClick: async () => {
          if (!(await confirm({ title: 'Delete', message: `Remove ${shortOf(e)} on ${fmt.date(e.date)}?`, confirmLabel: 'Delete', danger: true }))) return;
          try { await api.del(`/events/${e.id}`); d.close(); await reloadEvents(); toast('Deleted', 'ok'); show(bar.dataset.active); } catch (err) { toast(err.message, 'bad'); }
        } }),
        button({ kind: 'secondary', label: 'Cancel', onClick: () => d.close() }),
        button({ kind: 'primary', label: isNew ? 'Add' : 'Save', onClick: async () => {
          if (!date.value || !name.value.trim()) { toast('A date and a name are required', 'warn'); return; }
          const p = post.value;
          const label = e.shortName || name.value.trim();
          const wish = p === 'none' ? '' : (text.value.trim() || defaultWish(label));
          const payload = {
            ...(ev || { templates: {}, generated: {} }),
            date: date.value, weekday: weekdayOf(date.value), name: name.value.trim(),
            shortName: e.shortName || name.value.trim(), category: category.value, postingRule: rule.value, note: note.value.trim(),
            greetingText: wish,
            // A wish needs a greeting kind; festival wishes go to everyone.
            kind: p === 'none' ? e.kind : (GREETING_KINDS.includes(e.kind) ? e.kind : 'greeting'),
            whoGets: p === 'none' ? 'none' : 'everyone',
            tiers: p === 'none' || e.noGenerate ? [] : ['platinum', 'gold', 'silver', 'bronze'],
            ...(approver ? { conceptAllowed: p === 'creative' } : {}),
          };
          try {
            if (isNew) await api.post('/events', payload); else await api.put(`/events/${e.id}`, payload);
            d.close(); await reloadEvents(); toast(isNew ? 'Added' : 'Saved', 'ok'); show(bar.dataset.active);
          } catch (err) { toast(err.message, 'bad'); }
        } }),
      ].filter(Boolean),
    });
  }

  // ============================================================ greetings
  async function greetingsTab() {
    let days = 30;
    const root = el('div');
    const summary = el('div');
    const listBox = el('div');
    const controls = el('div', { class: 'rc-toolbar' });
    root.append(controls, summary, listBox);
    let data = null;

    const daysSel = select({ options: [14, 30, 60, 90].map((n) => ({ value: n, label: `Next ${n} days` })), value: 30, onChange: (e) => { days = Number(e.target.value); load(); } });
    const mkRange = () => ({ from: data.from, to: data.to });

    async function runGenerate(extra = {}, label) {
      try {
        const r = await api.post('/recurring/generate', { ...mkRange(), ...extra });
        const t = r.totals;
        toast(`${label || 'Done'}: ${t.piecesCreated} ${t.piecesCreated === 1 ? 'piece' : 'pieces'} created, ${t.piecesExisting} already there`, 'ok', { ms: 5000 });
        if (!extra.eventId) showSummary(r);
        await load(true);
      } catch (err) { toast(err.message, 'bad'); }
    }

    function showSummary(r) {
      const lines = r.events.filter((e) => !e.skipped).map((e) => {
        const bits = [];
        if (e.piece) bits.push(`${e.piece === 'created' ? 'made' : 'already there'}, ${fmt.date(e.eve)} at ${OCC.greetingTime}`);
        return el('li', {}, [el('b', { text: `${e.name}: ` }), bits.join('; ')]);
      });
      summary.replaceChildren(card({
        class: 'rc-summary', title: 'Added to the calendar', eyebrow: `${fmt.date(r.from)} to ${fmt.date(r.to)}`,
        body: lines.length ? el('ul', {}, lines) : el('p', { class: 'note', text: 'None in this range.' }),
      }));
    }

    async function load() {
      listBox.replaceChildren(el('div', { class: 'loading', text: 'Loading' }));
      data = await api.get('/recurring/upcoming', { days });
      const items = data.items.filter((e) => e.hasGreeting);
      const generatable = items.filter((e) => !e.alternate);
      controls.replaceChildren(
        field({ label: 'Range', input: daysSel }),
        el('span', { class: 'rc-spacer' }),
        button({ kind: 'primary', label: 'Add all to the calendar', icon: 'content', disabled: !generatable.length, title: `A draft greeting on the eve, ${OCC.greetingTime}, for each festival in range`, onClick: () => runGenerate({}, 'Greetings') }),
      );
      if (data.goDark?.on) {
        summary.replaceChildren(el('div', { class: 'banner banner-warn' }, `Go dark is on${data.goDark.from ? ` from ${fmt.date(data.goDark.from)}` : ''}. Nothing posts until it is switched off in Settings.`));
      } else if (!summary.children.length) summary.replaceChildren();
      listBox.replaceChildren();
      if (!items.length) {
        listBox.appendChild(empty({ title: 'No greetings in this range', hint: 'Choose a longer range.' }));
        return;
      }
      await cardsReady().catch(() => {});
      const grid = el('div', { class: 'rc-greet-grid' }, items.map((e) => greetingTile(e)));
      listBox.appendChild(grid);
    }

    function greetingTile(e) {
      const fields = greetingCard.greetingFields(e, 'square');
      let preview;
      try {
        const svg = greetingCard.render(fields, 'navy', { embedFonts: false, warnings: [] });
        preview = el('div', { class: 'rc-greet-img', 'aria-label': `Greeting image for ${shortOf(e)}` });
        preview.innerHTML = svg;
      } catch { preview = el('div', { class: 'rc-greet-img empty-text', text: 'Preview unavailable' }); }
      const download = async (format) => {
        const f = greetingCard.greetingFields(e, format);
        const { w, h } = greetingCard.size(f);
        try {
          const png = await svgToPng(greetingCard.render(f, 'navy', { warnings: [] }), w, h);
          downloadBlob(png, `${(e.shortName || e.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${format}.png`);
        } catch (err) { toast(`The image could not be made: ${err.message}`, 'bad'); }
      };
      const when = e.daysAway === 0 ? 'Today' : e.daysAway === 1 ? 'Tomorrow' : `In ${e.daysAway} days`;
      return el('div', { class: 'card rc-greet' }, [
        preview,
        el('div', { class: 'rc-greet-body' }, [
          el('div', { class: 'eyebrow', text: `${fmt.date(e.date)}. ${when}` }),
          el('h3', { text: shortOf(e) }),
          el('div', { class: 'rc-meta' }, [
            e.conceptAllowed && chip({ label: 'Festival idea too', tone: POST_TONE.creative }),
            e.pieceGenerated && chip({ label: 'In the calendar', tone: 'ok', icon: 'check' }),
            e.alternate && chip({ label: 'Same festival, other date', tone: 'muted' }),
          ].filter(Boolean)),
          e.alternate ? null : el('div', { class: 'row rc-greet-actions' }, [
            button({ kind: 'secondary', small: true, icon: 'download', label: 'Status', title: 'Download the 1080 x 1920 image', onClick: () => download('status') }),
            button({ kind: 'secondary', small: true, icon: 'download', label: 'Post', title: 'Download the 1080 x 1080 image', onClick: () => download('square') }),
            e.pieceId
              ? button({ kind: 'ghost', small: true, label: 'Open', href: `#/content/${e.pieceId}` })
              : button({ kind: 'ghost', small: true, label: 'Add to calendar', onClick: () => runGenerate({ eventId: e.id }, shortOf(e)) }),
            button({ kind: 'ghost', small: true, icon: 'edit', label: 'Edit', onClick: () => editEvent(events.find((x) => x.id === e.id) || e) }),
          ]),
        ]),
      ]);
    }

    await load();
    return root;
  }

  // ============================================================= concepts
  async function conceptsTab() {
    const root = el('div');
    const listBox = el('div');
    root.append(
      el('div', { class: 'rc-intro' }, bullets([
        'Get three ideas for a big festival',
        'Pick one: it becomes a post three to seven days before',
        `Ideas never repeat within ${OCC.conceptYears} years`,
        'The greeting still goes on the eve',
      ], { compact: true })),
      listBox,
    );
    let data = null;
    async function load() {
      listBox.replaceChildren(el('div', { class: 'loading', text: 'Loading' }));
      data = await api.get('/occasions/concepts', { days: 365 });
      const allowed = data.items.filter((e) => e.conceptAllowed);
      const rest = data.items.filter((e) => !e.conceptAllowed);
      listBox.replaceChildren();
      if (!allowed.length) listBox.appendChild(empty({ title: 'No creative posts planned', hint: 'Set an occasion to Creative post in the Calendar tab.' }));
      for (const e of allowed) listBox.appendChild(conceptCard(e));
      void rest;
    }
    function conceptCard(e) {
      const meta = [
        chip({ label: `${e.anglesUnused} fresh ideas left`, tone: e.anglesUnused ? 'muted' : 'warn' }),
        e.pieceId && chip({ label: `Piece made: ${e.pieceStatus}${e.pieceDate ? `, ${fmt.date(e.pieceDate)}` : ', not placed'}`, tone: 'ok', icon: 'check' }),

      ].filter(Boolean);
      const body = [el('div', { class: 'rc-meta' }, meta)];
      if (e.proposals.length) {
        body.push(el('div', { class: 'rc-concepts' }, e.proposals.map((c, i) => {
          const typeSel = select({ options: conceptTypeOptions(), value: c.type });
          const used = e.usedAngleId === c.angleId;
          return el('div', { class: `rc-concept${used ? ' is-used' : ''}` }, [
            el('div', { class: 'eyebrow', text: `Idea ${i + 1}. ${c.solutionName}` }),
            el('h3', { text: c.idea }),
            sentenceBullets(c.scene),
            el('details', { class: 'rc-more' }, [el('summary', { text: 'Show lines' }), el('dl', { class: 'rc-lines' }, [
              el('dt', { text: 'Reel hook' }), el('dd', { text: c.reelHook }),
              el('dt', { text: 'Reel caption' }), el('dd', { text: c.reelCaption }),
              el('dt', { text: 'Status' }), el('dd', { text: c.statusLine }),
              el('dt', { text: 'LinkedIn opening' }), el('dd', { text: c.linkedinOpening }),
              el('dt', { text: 'Carousel cover' }), el('dd', { text: c.carouselCover }),
            ])]),
            el('div', { class: 'row' }, used ? [chip({ label: 'Made into the piece', tone: 'ok', icon: 'check' })] : e.pieceId ? [] : [
              field({ label: 'As a', input: typeSel, inline: true }),
              button({ kind: 'primary', small: true, label: 'Make the piece', onClick: async (ev) => {
                ev.currentTarget.disabled = true;
                try {
                  const r = await api.post('/occasions/concepts/make', { eventId: e.id, index: i, type: typeSel.value });
                  toast(r.placed ? `Made and placed on ${fmt.date(r.placed.date)}${r.placed.time ? ` at ${r.placed.time}` : ''}; it is in the review queue` : (r.note || 'Made; not placed'), r.placed ? 'ok' : 'warn', { ms: 7000 });
                  await load();
                } catch (err) { toast(err.message, 'bad'); ev.currentTarget.disabled = false; }
              } }),
            ]),
          ]);
        })));
      } else body.push(el('p', { class: 'note', text: 'No ideas yet.' }));
      const actions = [
        button({ kind: e.proposals.length ? 'secondary' : 'primary', small: true, icon: 'sparkle', label: e.proposals.length ? 'New ideas' : 'Get ideas', disabled: !e.anglesUnused || Boolean(e.pieceId), title: `Three ideas from angles not used in the last ${OCC.conceptYears} years`, onClick: async (ev) => {
          const btn = ev.currentTarget; btn.disabled = true; const old = btn.lastChild.textContent; btn.lastChild.textContent = 'Proposing';
          try { await api.post('/occasions/concepts/propose', { eventId: e.id }); toast(`Three ideas for ${e.shortName}`, 'ok'); await load(); }
          catch (err) { aiFailure(err, 'The ideas'); btn.disabled = false; btn.lastChild.textContent = old; }
        } }),
        e.pieceId && button({ kind: 'ghost', small: true, label: 'Open the piece', href: `#/content/${encodeURIComponent(e.pieceId)}` }),
      ].filter(Boolean);
      return card({
        class: 'rc-greeting',
        eyebrow: `${fmt.date(e.date)}${e.daysAway === 0 ? '. Today' : e.daysAway === 1 ? '. Tomorrow' : `. In ${e.daysAway} days`}`,
        title: e.shortName,
        body, footer: actions,
        actions: [button({ kind: 'ghost', small: true, icon: 'edit', label: 'Edit', onClick: () => editEvent(events.find((x) => x.id === e.id) || e) })],
      });
    }
    await load();
    return root;
  }

  // ======================================================== announcements
  async function announcementsTab() {
    const campaigns = (await api.get('/campaigns')).sort((a, b) => String(b.from || b.createdAt).localeCompare(String(a.from || a.createdAt)));
    const pieces = campaigns.length ? await api.get('/pieces') : [];
    const root = el('div');
    root.appendChild(el('div', { class: 'rc-toolbar' }, [
      el('div', { style: { flex: '1 1 260px' } }, bullets(['Launches, offers, events and milestones', 'Add the facts; Claude drafts a post per account'], { compact: true })),
      button({ kind: 'primary', label: 'New campaign', icon: 'plus', onClick: () => editCampaign(null) }),
    ]));
    if (!campaigns.length) {
      root.appendChild(empty({ title: 'No campaigns yet', hint: 'Add a name, dates and the facts.', action: button({ kind: 'primary', label: 'New campaign', icon: 'plus', onClick: () => editCampaign(null) }) }));
      return root;
    }
    for (const c of campaigns) {
      const mine = (c.pieceIds || []).map((id) => pieces.find((p) => p.id === id)).filter(Boolean);
      root.appendChild(card({
        eyebrow: `${cap(c.kind)}${c.from ? `. ${fmt.date(c.from)}${c.to && c.to !== c.from ? ` to ${fmt.date(c.to)}` : ''}` : ''}`,
        title: c.name,
        actions: [button({ kind: 'ghost', small: true, icon: 'edit', label: 'Edit', onClick: () => editCampaign(c) })],
        body: [
          c.facts?.length ? el('ul', { class: 'rc-facts' }, c.facts.map((f) => el('li', { text: f }))) : el('p', { class: 'note', text: 'No facts yet. Add them before drafting.' }),
          c.thirdParty && el('p', { class: 'note', text: `Host or partner to thank: ${c.thirdParty}` }),
          c.notes && el('p', { class: 'note', text: c.notes }),
          mine.length
            ? el('div', { class: 'rc-pieces' }, mine.map((p) => el('a', { href: `#/content/${p.id}`, class: 'chip chip-navy', text: `${(accounts.find((a) => a.id === p.targets?.[0]) || {}).short || p.targets?.[0] || 'Piece'}: ${p.status}` })))
            : el('p', { class: 'note', text: 'No pieces drafted yet.' }),
        ],
        footer: [
          director && button({ kind: 'danger', small: true, icon: 'trash', label: 'Delete', onClick: async () => {
            if (!(await confirm({ title: 'Delete this campaign', message: `${c.name} will be removed. Its pieces stay in the library.`, confirmLabel: 'Delete', danger: true }))) return;
            try { await api.del(`/campaigns/${c.id}`); toast('Campaign deleted', 'ok'); show('announcements'); } catch (err) { toast(err.message, 'bad'); }
          } }),
          button({ kind: 'primary', small: true, icon: 'sparkle', label: 'Draft pieces', disabled: !c.facts?.length, title: c.facts?.length ? '' : 'Add the facts first', onClick: () => draftDialog(c) }),
        ],
      }));
    }
    return root;
  }

  function editCampaign(c) {
    const isNew = !c;
    const name = input({ value: c?.name || '', placeholder: 'For example, the first intake opens' });
    const kind = select({ options: CAMPAIGN_KINDS.map((k) => ({ value: k, label: cap(k) })), value: c?.kind || 'announcement' });
    const from = input({ type: 'date', value: c?.from || '', class: 'mono' });
    const to = input({ type: 'date', value: c?.to || '', class: 'mono' });
    const facts = textarea({ value: (c?.facts || []).join('\n'), rows: 6, placeholder: 'One plain fact per line. Only what is true and may be said.' });
    const third = input({ value: c?.thirdParty || '', placeholder: 'A host, chapter or client to thank, if any' });
    const notes = textarea({ value: c?.notes || '', rows: 2 });
    const d = dialog({
      title: isNew ? 'New campaign' : 'Edit campaign',
      wide: true,
      body: el('div', {}, [
        el('div', { class: 'form-grid' }, [field({ label: 'Name', input: name }), field({ label: 'Kind', input: kind }), field({ label: 'From', input: from }), field({ label: 'To', input: to })]),
        field({ label: 'Facts', input: facts, hint: 'One a line. Claude uses only these; mark example numbers.' }),
        field({ label: 'Host or partner to thank (optional)', input: third, hint: 'Thanked first; Venture Drafters comes second.' }),
        field({ label: 'Notes', input: notes }),
      ]),
      actions: [
        button({ kind: 'secondary', label: 'Cancel', onClick: () => d.close() }),
        button({ kind: 'primary', label: isNew ? 'Create campaign' : 'Save', onClick: async () => {
          if (!name.value.trim()) { toast('A name is required', 'warn'); return; }
          const payload = {
            ...(c || { pieceIds: [] }), name: name.value.trim(), kind: kind.value, from: from.value || undefined, to: to.value || undefined,
            facts: facts.value.split('\n').map((s) => s.trim()).filter(Boolean), thirdParty: third.value.trim(), notes: notes.value.trim(),
          };
          try {
            if (isNew) await api.post('/campaigns', payload); else await api.put(`/campaigns/${c.id}`, payload);
            d.close(); toast(isNew ? 'Campaign created' : 'Campaign saved', 'ok'); show('announcements');
          } catch (err) { toast(err.message, 'bad'); }
        } }),
      ],
    });
  }

  function draftDialog(c) {
    const groups = [...new Set(accounts.map((a) => a.group))];
    const boxes = new Map();
    const body = el('div', { class: 'rc-accounts' }, [
      bullets(['Choose the accounts to draft for', 'One piece each, from the facts alone'], { compact: true }),
      ...groups.flatMap((g) => [
        el('span', { class: 'eyebrow group', text: g }),
        ...accounts.filter((a) => a.group === g && a.platform !== 'in-person').map((a) => {
          const box = checkbox({ label: `${a.label}`, checked: (c.targets || DEFAULT_ANNOUNCE_TARGETS).includes(a.id) });
          boxes.set(a.id, box);
          return box;
        }),
      ]),
    ]);
    const out = el('div');
    body.appendChild(out);
    const chosen = () => [...boxes].filter(([, b]) => b.querySelector('input').checked).map(([id]) => id);
    let go;
    const d = dialog({
      title: `Draft pieces: ${c.name}`,
      wide: true,
      body,
      actions: [
        button({ kind: 'ghost', label: 'Preview the prompt', onClick: async () => {
          const targets = chosen();
          if (!targets.length) { toast('Choose at least one account', 'warn'); return; }
          try {
            const r = await api.post('/recurring/announce', { campaignId: c.id, targets, dryRun: true });
            out.replaceChildren(el('pre', { class: 'rc-prompt', text: `${r.system}\n\n---\n\n${r.user}` }));
          } catch (err) { toast(err.message, 'bad'); }
        } }),
        button({ kind: 'secondary', label: 'Close', onClick: () => d.close() }),
        go = button({ kind: 'primary', label: 'Draft pieces', icon: 'sparkle', onClick: async () => {
          const targets = chosen();
          if (!targets.length) { toast('Choose at least one account', 'warn'); return; }
          go.disabled = true;
          go.lastChild.textContent = 'Drafting';
          try {
            const r = await api.post('/recurring/announce', { campaignId: c.id, targets });
            toast(`${r.pieces.length} ${r.pieces.length === 1 ? 'piece' : 'pieces'} drafted`, 'ok');
            d.close();
            show('announcements');
          } catch (err) {
            aiFailure(err, 'The draft');
            go.disabled = false;
            go.lastChild.textContent = 'Draft pieces';
          }
        } }),
      ],
    });
  }

}
