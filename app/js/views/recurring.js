// Occasions (named Recurring until 30 October 2026): events and the month strip, greetings for the next 30 days,
// announcement campaigns, and the standing rules. [recurring]

import { api } from '../api.js';
import { roleOf } from '../roles.js';
import { el, card, field, input, textarea, select, button, chip, tabs, toast, dialog, confirm, empty, listRow, checkbox, fmt } from '../ui.js';

export const route = '#/occasions';
export const title = 'Occasions';

const TABS = [
  { id: 'events', label: 'Events' },
  { id: 'greetings', label: 'Greetings' },
  { id: 'concepts', label: 'Concepts' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'rules', label: 'Rules' },
];
const CONCEPT_TYPES = [['broll', 'B-roll video'], ['reel-animated', 'Animated reel'], ['carousel', 'Carousel'], ['status-rule', 'Status rule']];

const KINDS = ['greeting', 'greeting-only', 'dark', 'compliance', 'event', 'wedding-muhurat', 'budget', 'mourning', 'announcement', 'quiet'];
const KIND_LABEL = {
  greeting: 'Greeting', 'greeting-only': 'Greeting only', dark: 'Dark day', compliance: 'Compliance', event: 'Event',
  'wedding-muhurat': 'Wedding muhurat', budget: 'Budget', mourning: 'Mourning', announcement: 'Announcement', quiet: 'Quiet',
};
const SCOPES = ['national', 'mp', 'indore', 'ours'];
const SCOPE_LABEL = { national: 'National', mp: 'Madhya Pradesh', indore: 'Indore', ours: 'Ours' };
const RULES = ['normal', 'greeting-only', 'dark', 'quiet'];
const RULE_LABEL = { normal: 'Normal', 'greeting-only': 'Greeting only', dark: 'Dark', quiet: 'Quiet' };
const RULE_TONE = { normal: 'default', 'greeting-only': 'warn', dark: 'bad', quiet: 'muted' };
const WHO = ['everyone', 'hindu', 'muslim', 'sikh', 'christian', 'jain', 'buddhist', 'business-only', 'none'];
const TIERS = ['platinum', 'gold', 'silver', 'bronze'];
const CONFIDENCE = ['gazetted', 'expected', 'unconfirmed', 'confirmed'];
const RECURRENCE = ['annual-fixed', 'lunar', 'manual', 'none'];
const RECURRENCE_LABEL = { 'annual-fixed': 'Fixed date each year', lunar: 'Lunar, date set each year', manual: 'Set by hand', none: 'One-off' };
const RECURRENCE_SHORT = { 'annual-fixed': 'Yearly', lunar: 'Lunar', manual: 'Manual' };
const CAMPAIGN_KINDS = ['announcement', 'launch', 'offer', 'event', 'milestone'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_ANNOUNCE_TARGETS = ['vd-li', 'p-li', 'wa-st'];

const pad = (n) => String(n).padStart(2, '0');
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const ymdLocal = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthLabel = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const weekdayOf = (ymd) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${ymd}T00:00:00Z`).getUTCDay()];
const shortOf = (ev) => ev.shortName || ev.name;
const tierList = (tiers) => (tiers && tiers.length ? tiers.map(cap).join(', ') : 'none');

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
  container.append(bar, panel);

  const views = { events: eventsTab, greetings: greetingsTab, concepts: conceptsTab, announcements: announcementsTab, rules: rulesTab };
  async function show(id) {
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

  // =============================================================== events
  async function eventsTab() {
    const f = { kind: '', scope: '', rule: '', q: '', month: '', day: '' };
    const today = ymdLocal();
    const months = [...new Set(events.map((e) => e.date.slice(0, 7)))].sort();
    f.month = months.includes(today.slice(0, 7)) ? today.slice(0, 7) : (months[0] || today.slice(0, 7));

    const root = el('div');
    if (!events.length) {
      root.appendChild(empty({
        title: 'No events yet',
        hint: 'Import the India business calendar (festivals, national days, compliance dates, wedding muhurats) to begin.',
        action: button({ kind: 'primary', label: 'Import the India calendar', icon: 'upload', onClick: runImport }),
      }));
      root.appendChild(el('div', { class: 'row', style: { justifyContent: 'center', marginTop: '12px' } },
        button({ kind: 'secondary', label: 'Add an event', icon: 'plus', onClick: () => editEvent(null) })));
      return root;
    }

    const kindSel = select({ options: [{ value: '', label: 'All kinds' }, ...KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))], value: '', onChange: (e) => { f.kind = e.target.value; redraw(); } });
    const scopeSel = select({ options: [{ value: '', label: 'All scopes' }, ...SCOPES.map((k) => ({ value: k, label: SCOPE_LABEL[k] }))], value: '', onChange: (e) => { f.scope = e.target.value; redraw(); } });
    const ruleSel = select({ options: [{ value: '', label: 'Any posting rule' }, ...RULES.map((k) => ({ value: k, label: RULE_LABEL[k] }))], value: '', onChange: (e) => { f.rule = e.target.value; redraw(); } });
    const search = input({ type: 'search', placeholder: 'Search names and notes', onInput: (e) => { f.q = e.target.value.trim().toLowerCase(); redraw(); } });

    root.appendChild(el('div', { class: 'rc-toolbar' }, [
      !approver && el('p', { class: 'note', style: { margin: 0, flex: '1 1 100%' }, text: 'Events are read-only for you except their text and tiers; a manager or the director imports and expands them, and the director deletes.' }),
      field({ label: 'Kind', input: kindSel }),
      field({ label: 'Scope', input: scopeSel }),
      field({ label: 'Posting rule', input: ruleSel }),
      field({ label: 'Search', input: search }),
      el('span', { class: 'rc-spacer' }),
      button({ kind: 'primary', label: 'Add event', icon: 'plus', onClick: () => editEvent(null) }),
      approver && button({ kind: 'secondary', label: 'Import again', icon: 'upload', onClick: runImport, title: 'Adds any seed events not yet present; existing events are left as they are' }),
    ]));

    const strip = el('div');
    const list = el('div');
    root.append(strip, list);

    const matches = (e, { ignoreMonth = false } = {}) => (!f.kind || e.kind === f.kind) && (!f.scope || e.scope === f.scope)
      && (!f.rule || e.postingRule === f.rule)
      && (!f.q || `${e.name} ${e.shortName || ''} ${e.note || ''}`.toLowerCase().includes(f.q))
      && (ignoreMonth || !f.month || e.date.startsWith(f.month))
      && (!f.day || e.date === f.day);

    function drawStrip() {
      const [y, m] = f.month.split('-').map(Number);
      const first = new Date(Date.UTC(y, m - 1, 1));
      const lead = (first.getUTCDay() + 6) % 7;
      const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const byDate = new Map();
      for (const e of events) {
        // the day filter is not applied here, so a picked day stays visible in its month
        if (!((!f.kind || e.kind === f.kind) && (!f.scope || e.scope === f.scope) && (!f.rule || e.postingRule === f.rule)
          && (!f.q || `${e.name} ${e.shortName || ''} ${e.note || ''}`.toLowerCase().includes(f.q)))) continue;
        if (!e.date.startsWith(f.month)) continue;
        if (!byDate.has(e.date)) byDate.set(e.date, []);
        byDate.get(e.date).push(e);
      }
      const idx = months.indexOf(f.month);
      const head = el('div', { class: 'rc-month-head' }, [
        el('div', { class: 'rc-month-title', text: monthLabel(f.month) }),
        el('div', { class: 'rc-month-nav' }, [
          f.day && button({ kind: 'ghost', small: true, label: 'Show the whole month', onClick: () => { f.day = ''; redraw(); } }),
          button({ kind: 'secondary', small: true, icon: 'back', title: 'Previous month', disabled: idx <= 0, onClick: () => { f.month = months[idx - 1]; f.day = ''; redraw(); } }),
          button({ kind: 'secondary', small: true, icon: 'next', title: 'Next month', disabled: idx < 0 || idx >= months.length - 1, onClick: () => { f.month = months[idx + 1]; f.day = ''; redraw(); } }),
        ]),
      ]);
      const grid = el('div', { class: 'rc-grid' }, DOW.map((d) => el('div', { class: 'rc-dow', text: d })));
      for (let i = 0; i < lead; i++) grid.appendChild(el('div', { class: 'rc-day blank' }));
      for (let d = 1; d <= nDays; d++) {
        const date = `${f.month}-${pad(d)}`;
        const evs = byDate.get(date) || [];
        const classes = ['rc-day', date === today && 'today', f.day === date && 'picked', evs.some((e) => e.postingRule === 'dark') && 'has-dark'].filter(Boolean).join(' ');
        const label = evs.map((e) => `${shortOf(e)} (${RULE_LABEL[e.postingRule] || e.postingRule})`).join('; ');
        grid.appendChild(el('button', {
          class: classes, type: 'button', title: label || fmt.date(date), 'aria-label': `${fmt.date(date)}${label ? `: ${label}` : ''}`,
          onClick: () => { f.day = f.day === date ? '' : date; redraw(); },
        }, [
          el('span', { class: 'rc-day-n', text: String(d) }),
          el('span', { class: 'rc-dots' }, evs.slice(0, 6).map((e) => el('i', { class: `rc-dot ${e.postingRule}` }))),
        ]));
      }
      const legend = el('div', { class: 'rc-legend' }, [
        el('span', {}, [el('i', { class: 'rc-dot dark' }), 'Dark']),
        el('span', {}, [el('i', { class: 'rc-dot greeting-only' }), 'Greeting only']),
        el('span', {}, [el('i', { class: 'rc-dot quiet' }), 'Quiet']),
        el('span', {}, [el('i', { class: 'rc-dot normal' }), 'Normal']),
      ]);
      strip.replaceChildren(el('div', { class: 'rc-month' }, [head, grid, legend]));
    }

    function drawList() {
      const rows = events.filter((e) => matches(e)).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
      const wrap = el('div', { class: 'rc-list' });
      const head = el('div', { class: 'section-title' }, [
        el('h2', { text: f.day ? fmt.date(f.day) : monthLabel(f.month) }),
        el('span', { class: 'count', text: `${rows.length} ${rows.length === 1 ? 'event' : 'events'}` }),
      ]);
      const body = el('div', { class: 'card', style: { padding: '0 6px' } });
      if (!rows.length) body.appendChild(el('div', { class: 'empty-inline', style: { padding: '18px 12px' }, text: 'No events match these filters in this month.' }));
      for (const e of rows) body.appendChild(eventRow(e));
      wrap.append(head, body);
      list.replaceChildren(wrap);
    }

    function eventRow(e) {
      const who = e.whoGets && e.whoGets !== 'none' ? `Greets ${e.whoGets}` : 'No greeting';
      const tiers = e.tiers?.length ? `tiers ${tierList(e.tiers)}` : (e.greetingText ? 'Status only' : '');
      const row = el('div', { class: 'list-row', role: 'button', tabindex: '0', onClick: () => editEvent(e), onKeydown: (k) => { if (k.key === 'Enter') editEvent(e); } }, [
        el('div', { class: 'rc-date' }, [el('b', { text: fmt.date(e.date).replace(/ \d{4}$/, '') }), `${e.weekday || weekdayOf(e.date)} ${e.date.slice(0, 4)}`]),
        el('div', { class: 'list-main' }, [
          el('div', { class: 'list-title', title: e.name, text: shortOf(e) }),
          el('div', { class: 'list-sub', text: [e.greetingText ? `${who}${tiers ? `; ${tiers}` : ''}` : '', e.note].filter(Boolean).join('. ') }),
          el('div', { class: 'rc-row-chips' }, [
            chip({ label: KIND_LABEL[e.kind] || e.kind, tone: 'navy' }),
            ruleChip(e.postingRule),
            chip({ label: SCOPE_LABEL[e.scope] || e.scope, tone: 'muted' }),
            chip({ label: cap(e.confidence), tone: e.confidence === 'gazetted' ? 'ok' : 'muted' }),
            e.recurrence && e.recurrence !== 'none' && chip({ label: RECURRENCE_SHORT[e.recurrence] || e.recurrence, tone: 'muted' }),
            e.seedPostingRule && chip({ label: `Moves by a day (was ${e.seedPostingRule})`, tone: 'muted' }),
          ]),
        ]),
      ]);
      return row;
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

  // ------------------------------------------------------------ event editor
  function editEvent(ev) {
    const isNew = !ev;
    const e = ev ? { ...ev, tiers: [...(ev.tiers || [])] } : {
      date: ymdLocal(), name: '', shortName: '', kind: 'event', scope: 'national', postingRule: 'normal', whoGets: 'none',
      greetingText: '', confidence: 'expected', recurrence: 'manual', tiers: [], note: '', source: '',
    };
    const date = input({ type: 'date', value: e.date, class: 'mono' });
    const name = input({ value: e.name, placeholder: 'Festival, day or deadline' });
    const short = input({ value: e.shortName || '', placeholder: 'Used as the hook; eight words or fewer' });
    const kind = select({ options: KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })), value: e.kind });
    const scope = select({ options: SCOPES.map((k) => ({ value: k, label: SCOPE_LABEL[k] })), value: e.scope });
    const rule = select({ options: RULES.map((k) => ({ value: k, label: RULE_LABEL[k] })), value: e.postingRule });
    const who = select({ options: WHO.map((k) => ({ value: k, label: cap(k.replace('-', ' ')) })), value: e.whoGets });
    const conf = select({ options: [...new Set([...CONFIDENCE, e.confidence])].map((k) => ({ value: k, label: cap(k) })), value: e.confidence });
    const rec = select({ options: RECURRENCE.map((k) => ({ value: k, label: RECURRENCE_LABEL[k] })), value: e.recurrence || 'none' });
    const text = textarea({ value: e.greetingText || '', rows: 3, placeholder: 'Plain greeting, signed Palak Gupta, Venture Drafters. Leave empty for no greeting.' });
    const note = textarea({ value: e.note || '', rows: 2 });
    const tierBoxes = TIERS.map((t) => ({ t, box: checkbox({ label: cap(t), checked: e.tiers.includes(t) }) }));
    const conceptBox = checkbox({ label: 'A festival concept may be made for this occasion', checked: Boolean(e.conceptAllowed), disabled: !approver });
    const body = el('div', {}, [
      el('div', { class: 'form-grid' }, [
        field({ label: 'Date', input: date }),
        field({ label: 'Name', input: name }),
        field({ label: 'Short name', input: short }),
        field({ label: 'Kind', input: kind }),
        field({ label: 'Scope', input: scope }),
        field({ label: 'Posting rule', input: rule }),
        field({ label: 'Who gets a greeting', input: who }),
        field({ label: 'Confidence', input: conf }),
        field({ label: 'Recurrence', input: rec }),
      ]),
      field({ label: 'Greeting text', input: text }),
      el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Network tiers this festival goes to' }), el('div', { class: 'row' }, tierBoxes.map((x) => x.box)), el('span', { class: 'field-hint', text: 'The calendar\'s definition only. The Network tool reads it and decides who, by name, receives a greeting.' })]),
      el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Concepts' }), el('div', { class: 'row' }, [conceptBox]), el('span', { class: 'field-hint', text: `Series: ${e.series || 'none'}. A concept is the piece beside the greeting, different every year. Allowed only where a playful commercial note is customary; religious observances of other communities, mourning days and national days keep the greeting only.${approver ? '' : ' A manager or the director changes this.'}` })]),
      field({ label: 'Note', input: note }),
      e.generated?.pieceId && el('p', { class: 'note', text: `A greeting piece exists for this event (${e.generated.pieceId}).` }),
    ]);
    const d = dialog({
      title: isNew ? 'Add an event' : shortOf(e),
      wide: true,
      body,
      actions: [
        !isNew && director && button({ kind: 'danger', label: 'Delete', icon: 'trash', onClick: async () => {
          if (!(await confirm({ title: 'Delete this event', message: `${shortOf(e)} on ${fmt.date(e.date)} will be removed from the calendar.`, confirmLabel: 'Delete', danger: true }))) return;
          try { await api.del(`/events/${e.id}`); d.close(); await reloadEvents(); toast('Event deleted', 'ok'); show(bar.dataset.active); } catch (err) { toast(err.message, 'bad'); }
        } }),
        button({ kind: 'secondary', label: 'Cancel', onClick: () => d.close() }),
        button({ kind: 'primary', label: isNew ? 'Add event' : 'Save', onClick: async () => {
          if (!date.value || !name.value.trim()) { toast('A date and a name are required', 'warn'); return; }
          const payload = {
            ...(ev || { templates: {}, generated: {} }),
            date: date.value, weekday: weekdayOf(date.value), name: name.value.trim(), shortName: short.value.trim(),
            kind: kind.value, scope: scope.value, postingRule: rule.value, whoGets: who.value, confidence: conf.value,
            recurrence: rec.value, greetingText: text.value.trim(), note: note.value.trim(),
            tiers: tierBoxes.filter((x) => x.box.querySelector('input').checked).map((x) => x.t),
            ...(approver ? { conceptAllowed: conceptBox.querySelector('input').checked } : {}),
          };
          try {
            if (isNew) await api.post('/events', payload); else await api.put(`/events/${e.id}`, payload);
            d.close(); await reloadEvents(); toast(isNew ? 'Event added' : 'Event saved', 'ok'); show(bar.dataset.active);
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
        if (e.piece) bits.push(`piece ${e.piece === 'created' ? 'created' : 'already existed'}, planned for ${fmt.date(e.eve)} at 19:00`);
        return el('li', {}, [el('b', { text: `${e.name}: ` }), bits.join('; ')]);
      });
      summary.replaceChildren(card({
        class: 'rc-summary', title: 'Generated for this range', eyebrow: `${fmt.date(r.from)} to ${fmt.date(r.to)}`,
        body: lines.length ? el('ul', {}, lines) : el('p', { class: 'note', text: 'No greeting events fall in this range.' }),
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
        button({ kind: 'primary', label: 'Generate pieces', icon: 'content', disabled: !generatable.length, title: 'Creates a draft greeting piece on the eve’s Status slot for each festival in range', onClick: () => runGenerate({}, 'Pieces') }),
      );
      if (data.goDark?.on) {
        summary.replaceChildren(el('div', { class: 'banner banner-warn' }, `Go dark is switched on${data.goDark.from ? ` from ${fmt.date(data.goDark.from)}` : ''}${data.goDark.reason ? ` (${data.goDark.reason})` : ''}. Greetings generated now will not be posted until it is switched off in Settings.`));
      } else if (!summary.children.length) summary.replaceChildren();
      listBox.replaceChildren();
      if (!items.length) {
        listBox.appendChild(empty({ title: 'No greetings in this range', hint: `Nothing from ${fmt.date(data.from)} to ${fmt.date(data.to)} has a greeting. Choose a longer range.` }));
        return;
      }
      for (const e of items) listBox.appendChild(greetingCard(e));
    }

    function greetingCard(e) {
      const w = e.wording;
      const own = e.templates && (e.templates.status || e.templates.linkedin || e.templates.whatsapp);
      const block = (label, text) => el('div', { class: `rc-text${text ? '' : ' empty-text'}` }, [el('span', { class: 'eyebrow', text: label }), el('p', { text: text || 'Not written yet' })]);
      const meta = [
        ruleChip(e.postingRule),
        chip({ label: `Greets ${e.whoGets}`, tone: 'muted' }),
        e.tiers?.length ? chip({ label: `Goes to ${tierList(e.tiers)}`, tone: 'navy' }) : chip({ label: 'Status only', tone: 'muted' }),
        e.pieceGenerated && chip({ label: 'Piece generated', tone: 'ok', icon: 'check' }),
        own && chip({ label: 'Wording written', tone: 'accent' }),
        e.confidence !== 'gazetted' && chip({ label: cap(e.confidence), tone: 'muted' }),
      ].filter(Boolean);
      const body = [el('div', { class: 'rc-meta' }, meta)];
      if (e.alternate) {
        body.push(el('p', { class: 'note', text: 'This is an alternate reckoning of a festival that has its own entry. No separate greeting is generated, so a contact never receives two.' }));
      } else {
        body.push(el('div', { class: 'rc-texts' }, [block('WhatsApp Status', w.status), block('LinkedIn', w.linkedin)]));
        if (e.note) body.push(el('p', { class: 'note', text: e.note }));
      }
      const actions = e.alternate ? [] : [
        button({ kind: 'ghost', small: true, icon: 'sparkle', label: own ? 'Rewrite wording' : 'Write wording', title: 'Runs the greetingTemplates operation and saves the three lines on the event', onClick: (ev) => writeWording(e, ev.currentTarget) }),
        button({ kind: 'secondary', small: true, label: e.pieceGenerated ? 'Piece exists' : 'Generate piece', disabled: e.pieceGenerated, onClick: () => runGenerate({ eventId: e.id }, shortOf(e)) }),
      ];
      if (e.pieceId) actions.push(button({ kind: 'ghost', small: true, label: 'Open piece', href: `#/content/${e.pieceId}` }));
      return card({
        class: 'rc-greeting',
        eyebrow: `${e.weekday || weekdayOf(e.date)} ${fmt.date(e.date)}${e.alternate ? '' : `. Status on the eve, ${fmt.date(e.eve)}, 19:00`}${e.daysAway === 0 ? '. Today' : e.daysAway === 1 ? '. Tomorrow' : `. In ${e.daysAway} days`}`,
        title: shortOf(e),
        body,
        footer: actions.length ? actions : undefined,
        actions: [button({ kind: 'ghost', small: true, icon: 'edit', label: 'Edit', onClick: () => editEvent(events.find((x) => x.id === e.id) || e) })],
      });
    }

    async function writeWording(e, btn) {
      btn.disabled = true;
      const old = btn.lastChild.textContent;
      btn.lastChild.textContent = 'Writing';
      try {
        await api.post('/recurring/templates', { eventId: e.id });
        toast(`Wording saved for ${shortOf(e)}`, 'ok');
        await reloadEvents();
        await load();
      } catch (err) {
        aiFailure(err, 'The wording');
        btn.disabled = false;
        btn.lastChild.textContent = old;
      }
    }

    await load();
    return root;
  }

  // ============================================================= concepts
  async function conceptsTab() {
    const root = el('div');
    const listBox = el('div');
    root.append(
      card({
        title: 'What Occasions does', eyebrow: 'The rule card',
        body: el('ul', { class: 'rc-rules' }, [
          'Greetings come from the calendar and are regenerated each year: plain text on the eve, signed, never reused verbatim.',
          'A concept is the piece beside the greeting: a festival image, an owner\'s scene and one tool we built, so a festival is remembered for something different every year. It goes out in the three to seven days before the festival, never on a dark or greeting-only day.',
          'Concepts rotate through an angle bank (data/festival-angles.json); an angle used for a festival is not offered again within four years.',
          'Concepts are offered only where a playful commercial note is customary: Diwali, Dhanteras, Ganesh Chaturthi, Holi, Dussehra, Navratri, Makar Sankranti, Raksha Bandhan, Christmas, New Year, Pongal, Onam, Baisakhi, Gudi Padwa, Ugadi. Religious observances of other communities, mourning days and national days keep the greeting only; an approver can change this on the event.',
          'The fun lives in the idea and the image; the wording stays inside the brief: no emoji, no exclamation marks, Problem then Impact then Solution, the tool named.',
        ].map((t) => el('li', { text: t }))),
      }),
      listBox,
    );
    let data = null;
    async function load() {
      listBox.replaceChildren(el('div', { class: 'loading', text: 'Loading' }));
      data = await api.get('/occasions/concepts', { days: 365 });
      const allowed = data.items.filter((e) => e.conceptAllowed);
      const rest = data.items.filter((e) => !e.conceptAllowed);
      listBox.replaceChildren();
      if (!allowed.length) listBox.appendChild(empty({ title: 'No festival in the next year allows a concept', hint: 'Allow one on its event, as an approver.' }));
      for (const e of allowed) listBox.appendChild(conceptCard(e));
      if (rest.length) listBox.appendChild(el('p', { class: 'note', style: { marginTop: '12px' }, text: `Greeting only in the next year: ${rest.map((e) => `${e.shortName} (${fmt.date(e.date)})`).join(', ')}.` }));
    }
    function conceptCard(e) {
      const meta = [
        chip({ label: e.series, tone: 'navy' }),
        chip({ label: `${e.anglesUnused} of ${e.anglesTotal} angles unused`, tone: e.anglesUnused ? 'muted' : 'warn' }),
        e.pieceId && chip({ label: `Piece made: ${e.pieceStatus}${e.pieceDate ? `, ${fmt.date(e.pieceDate)}` : ', not placed'}`, tone: 'ok', icon: 'check' }),
        e.proposedMode && chip({ label: e.proposedMode === 'hand' || e.proposedMode === 'runner' ? 'Concepts written by hand' : 'Concepts by Claude', tone: 'accent' }),
      ].filter(Boolean);
      const body = [el('div', { class: 'rc-meta' }, meta)];
      if (e.proposals.length) {
        body.push(el('div', { class: 'rc-concepts' }, e.proposals.map((c, i) => {
          const typeSel = select({ options: CONCEPT_TYPES.map(([value, label]) => ({ value, label })), value: c.type });
          const used = e.usedAngleId === c.angleId;
          return el('div', { class: `rc-concept${used ? ' is-used' : ''}` }, [
            el('div', { class: 'eyebrow', text: `Concept ${i + 1}. Sells ${c.solutionName}` }),
            el('h3', { text: c.idea }),
            el('p', { class: 'note', text: c.scene }),
            el('dl', { class: 'rc-lines' }, [
              el('dt', { text: 'Reel hook' }), el('dd', { text: c.reelHook }),
              el('dt', { text: 'Reel caption' }), el('dd', { text: c.reelCaption }),
              el('dt', { text: 'Status' }), el('dd', { text: c.statusLine }),
              el('dt', { text: 'LinkedIn opening' }), el('dd', { text: c.linkedinOpening }),
              el('dt', { text: 'Carousel cover' }), el('dd', { text: c.carouselCover }),
            ]),
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
      } else body.push(el('p', { class: 'note', text: 'No concepts proposed yet for this year.' }));
      const actions = [
        button({ kind: e.proposals.length ? 'secondary' : 'primary', small: true, icon: 'sparkle', label: e.proposals.length ? 'Propose again' : 'Propose concepts', disabled: !e.anglesUnused || Boolean(e.pieceId), title: 'Runs the festivalConcept operation over the unused angles and saves three concepts on the event', onClick: async (ev) => {
          const btn = ev.currentTarget; btn.disabled = true; const old = btn.lastChild.textContent; btn.lastChild.textContent = 'Proposing';
          try { await api.post('/occasions/concepts/propose', { eventId: e.id }); toast(`Three concepts for ${e.shortName}`, 'ok'); await load(); }
          catch (err) { aiFailure(err, 'The concepts'); btn.disabled = false; btn.lastChild.textContent = old; }
        } }),
        e.pieceId && button({ kind: 'ghost', small: true, label: 'Open the piece', href: `#/content/${encodeURIComponent(e.pieceId)}` }),
      ].filter(Boolean);
      return card({
        class: 'rc-greeting',
        eyebrow: `${fmt.date(e.date)}${e.daysAway === 0 ? '. Today' : e.daysAway === 1 ? '. Tomorrow' : `. In ${e.daysAway} days`}. The piece goes out three to seven days before`,
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
      el('p', { class: 'note', style: { margin: 0, flex: '1 1 260px' }, text: 'A campaign holds the facts of an announcement, a launch, an offer, an event or a milestone. Claude drafts one piece per account; each is placed through the calendar like any other piece.' }),
      button({ kind: 'primary', label: 'New campaign', icon: 'plus', onClick: () => editCampaign(null) }),
    ]));
    if (!campaigns.length) {
      root.appendChild(empty({ title: 'No campaigns yet', hint: 'Create one with its name, dates and the facts in plain lines.', action: button({ kind: 'primary', label: 'New campaign', icon: 'plus', onClick: () => editCampaign(null) }) }));
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
        field({ label: 'Facts', input: facts, hint: 'Claude uses only these. No result, saving or number that is not marked as an example.' }),
        field({ label: 'Host or partner to thank (optional)', input: third, hint: 'The post then praises them and keeps Venture Drafters in the second line.' }),
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
      el('p', { class: 'note', text: 'Choose the accounts to draft for. One piece is created for each, in the register, from the facts alone.' }),
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

  // ================================================================= rules
  async function rulesTab() {
    const info = await api.get('/recurring/rules');
    const gd = info.goDark || { on: false };
    const root = el('div', { class: 'grid-2' });

    root.appendChild(card({
      title: 'Greetings',
      eyebrow: 'Standing rules',
      body: el('ul', { class: 'rc-rules' }, [
        `A greeting goes on WhatsApp Status the evening before the day, at ${info.greetingTime}, as plain typed text.`,
        'No offer, no call to action, no link and no designed card in a greeting. Nothing within two days of Diwali, Holi, Eid or Dussehra asks for anything.',
        'One greeting for each festival. A second reckoning of the same festival is shown on the calendar but never produces a second greeting.',
        'Every greeting is signed Palak Gupta, Venture Drafters. Nothing is sent from here: the tool prepares and the founder posts.',
        'One-to-one greetings to named people are prepared in the separate Network tool, which reads each festival\'s tiers and community from this calendar.',
        'No topical tie-ins. A greeting never mentions news, markets or the economy.',
      ].map((t) => el('li', { text: t }))),
    }));

    root.appendChild(card({
      title: 'Dark days and quiet days',
      eyebrow: 'Posting rules',
      body: [
        el('ul', { class: 'rc-rules' }, [
          el('li', {}, [ruleChip('dark'), ' Nothing is posted. The calendar refuses to place a piece here. A greeting scheduled on the eve is the only exception.']),
          el('li', {}, [ruleChip('greeting-only'), ' Only the plain greeting goes out, nothing else.']),
          el('li', {}, [ruleChip('quiet'), ' Posting is allowed but nothing that needs a live reply. A marker, not a block.']),
          el('li', {}, [ruleChip('normal'), ' No restriction.']),
        ]),
        el('p', { class: 'note', text: 'Compliance days (GST returns, TDS deposits, advance tax, the financial year end) are always quiet. A post due on one of them moves by a day; they never block the calendar.' }),
      ],
    }));

    root.appendChild(card({
      title: 'Which tiers a festival goes to',
      eyebrow: 'Read by the Network tool',
      body: [
        el('ul', { class: 'rc-rules' }, [
          el('li', {}, [el('b', { text: 'Diwali' }), ': Platinum, Gold, Silver and Bronze.']),
          el('li', {}, [el('b', { text: 'Holi, Makar Sankranti, Rangpanchami, Dussehra' }), ': Platinum and Gold.']),
          el('li', {}, [el('b', { text: 'New Year' }), ': Platinum, Gold and Silver.']),
          el('li', {}, [el('b', { text: 'Eid, Ramadan, Gurpurab, Lohri, Christmas, Easter, Mahavir Jayanti, Samvatsari, Buddha Purnima' }), ': Platinum, Gold and Silver, to people of that community only.']),
          el('li', {}, [el('b', { text: 'Other Hindu festivals' }), ': Platinum and Gold, to Hindu contacts.']),
          el('li', {}, [el('b', { text: 'Republic Day, Independence Day, Gandhi Jayanti, Ambedkar Jayanti, civic days, Raksha Bandhan, Onam' }), ': Status only, no message.']),
        ]),
        el('p', { class: 'note', text: 'Tiers on each event can be changed from the Events tab. No name or number is held here; the Network tool matches tiers and community to people.' }),
      ],
    }));

    root.appendChild(card({
      title: 'Mourning rule',
      eyebrow: 'Standing rule',
      body: [
        el('blockquote', { class: 'rc-quote', text: info.mourningRule.text }),
        info.mourningRule.note && el('p', { class: 'note', text: info.mourningRule.note }),
        el('div', { class: 'row', style: { marginTop: '8px' } }, [
          el('b', { text: 'Go dark switch' }),
          chip({ label: gd.on ? 'On' : 'Off', tone: gd.on ? 'bad' : 'ok' }),
          gd.on && gd.from && chip({ label: `From ${fmt.date(gd.from)}${gd.to ? ` to ${fmt.date(gd.to)}` : ''}`, tone: 'muted' }),
          gd.on && gd.reason && chip({ label: gd.reason, tone: 'muted' }),
        ]),
        el('p', { class: 'note', style: { marginTop: '8px' }, text: 'When it is on, every scheduled slot from its start date is treated as dark and nothing is posted. Switch it on at once when the rule above applies, and off when day three of mourning has passed.' }),
      ],
      footer: [button({ kind: 'secondary', small: true, icon: 'settings', label: 'Open the switch in Settings', href: '#/settings?tab=posting' })],
    }));
    return root;
  }
}
