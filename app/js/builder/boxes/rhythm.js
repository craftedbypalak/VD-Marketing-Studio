// Builder box: Posting rhythm. Contract: docs/BUILDER.md.
// Weekly and monthly slots per account (accounts[].weekly, accounts[].monthly), the
// calendar defaults (settings.calendar, read by server/slots.mjs with its own defaults),
// the time zone and go dark (settings.timezone, settings.goDark), and a calendar rebuild.
import { el, bullets, card, button, field, input, select, switchInput, confirm, toast } from '../../ui.js';
import { rowList } from '../kit.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NTH = [{ value: '1', label: '1st' }, { value: '2', label: '2nd' }, { value: '3', label: '3rd' }, { value: '4', label: '4th' }, { value: '5', label: '5th' }];
const FALLBACK = {
  defaults: { singleLinkedInBefore: '2026-11-16', carouselFrom: '2026-11-25', carouselEveryDays: 14, monthlyFrom: { 'yt-long': '2026-12-01' }, greetingTime: '19:00' },
  kinds: {
    reel: 'Reel', trial: 'Trial Reel', carousel: 'Instagram carousel', li: 'LinkedIn post', 'li-carousel': 'LinkedIn PDF carousel',
    status: 'Status', 'status-opt': 'optional Status', note: 'monthly note', 'yt-long': 'YouTube long video', 'yt-short': 'YouTube Short',
    reshare: 'company page reshare', family: 'family Status', greeting: 'greeting',
  },
};
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isMonth = (s) => /^\d{4}-\d{2}$/.test(String(s || ''));
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** "Tue, Thu 08:30" or "every other Mon 11:00" for one account's weekly rules. */
function weeklyLine(acc) {
  const rows = (acc.weekly || []).filter((w) => !w.derived);
  if (!rows.length) return '';
  const parts = [];
  const plain = rows.filter((w) => !(w.every > 1)).sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day));
  if (plain.length) {
    const days = [...new Set(plain.map((w) => w.day))].join(', ');
    const times = [...new Set(plain.map((w) => w.time).filter(Boolean))];
    parts.push(`${days}${times.length === 1 ? ` ${times[0]}` : ''}`);
  }
  for (const w of rows.filter((x) => x.every > 1)) parts.push(`${w.every === 2 ? 'every other' : `every ${w.every} weeks,`} ${w.day}${w.time ? ` ${w.time}` : ''}`);
  return parts.join('; ');
}

function summary(ctx) {
  const lines = [];
  for (const acc of ctx.accounts || []) {
    const line = weeklyLine(acc);
    if (line) lines.push(`${acc.label || acc.id}: ${line}`);
  }
  const monthly = (ctx.accounts || []).reduce((n, a) => n + (a.monthly || []).length, 0);
  const gd = ctx.settings?.goDark;
  const out = lines.slice(0, monthly ? 2 : 3);
  if (monthly) out.push(`${monthly} monthly slot${monthly === 1 ? '' : 's'}`);
  out.push(gd?.on ? `Go dark: on${gd.reason ? `, ${gd.reason}` : ''}` : 'Go dark: off');
  return out.length ? out : ['No slots yet'];
}

async function render(container, ctx) {
  const { api, canEdit } = ctx;
  let conf = FALLBACK;
  try { conf = await api.get('/calendar/config'); } catch { /* the fallback */ }
  let role = canEdit ? 'director' : 'employee';
  try { role = (await api.get('/me'))?.role || role; } catch { /* keep the guess */ }
  const canRebuild = canEdit || role === 'manager' || role === 'director';
  const kindOptions = Object.entries(conf.kinds || FALLBACK.kinds).map(([value, label]) => ({ value, label }));
  const kindLabel = (k) => (conf.kinds || {})[k] || k;

  // -------------------------------------------------------- slots per account
  const slotsHost = el('div');
  let current = (ctx.accounts || []).find((a) => (a.weekly || []).length || (a.monthly || []).length)?.id || ctx.accounts?.[0]?.id;

  const rebuildCard = () => card({
    title: 'Rebuild the calendar',
    body: bullets(['Rebuilds open slots from these rules', 'Filled slots stay as they are', 'Managers and the director can rebuild'], { compact: true }),
    footer: canRebuild ? [button({ kind: 'secondary', icon: 'calendar', label: 'Rebuild the calendar', onClick: rebuild })] : undefined,
  });

  async function rebuild() {
    const ok = await confirm({ title: 'Rebuild the calendar', message: 'Rebuild open slots from the current rules? Filled slots are kept.', confirmLabel: 'Rebuild' });
    if (!ok) return;
    try {
      const r = await api.post('/slots/regenerate', {});
      toast(`Calendar rebuilt: ${r.created} added, ${r.updated} changed, ${r.removed} removed`, 'ok', { ms: 5000 });
    } catch (err) { toast(err.message, 'bad'); }
  }

  function drawSlots() {
    const acc = (ctx.accounts || []).find((a) => a.id === current);
    const picker = select({
      options: (ctx.accounts || []).map((a) => ({ value: a.id, label: `${a.label || a.id} (${(a.weekly || []).length + (a.monthly || []).length})` })),
      value: current || '',
      onChange: (e) => { current = e.target.value; drawSlots(); },
      'aria-label': 'Account',
    });
    if (!acc) {
      slotsHost.replaceChildren(card({ title: 'Slots', body: bullets(['Add an account first, in Settings']) }));
      return;
    }
    // Copies; unknown fields (derived, alternate, scheduledUpload, from, why...) ride along untouched.
    const weekly = clone(acc.weekly || []);
    const monthly = clone(acc.monthly || []).map((m) => {
      const [n, wd] = String(m.rule || '').split(' ');
      return { ...m, _n: n ? String(parseInt(n, 10) || '') : '2', _wd: wd || 'Wed', _skip: (m.skipMonths || []).join(', ') };
    });
    const mark = () => { if (saveBtn) saveBtn.disabled = false; };
    const saveBtn = canEdit && button({ kind: 'primary', label: 'Save slots', disabled: true, onClick: () => saveSlots(acc, weekly, monthly) });

    const weeklyList = rowList(weekly, {
      canEdit, onChange: mark, addLabel: 'Add weekly slot',
      newRow: () => ({ day: 'Mon', time: '09:00', kind: kindOptions[0]?.value || 'reel', label: '' }),
      columns: [
        { key: 'day', label: 'Day', type: 'select', options: DAYS, width: '80px' },
        { key: 'time', label: 'Time', type: 'time', width: '110px' },
        { key: 'kind', label: 'Kind', type: 'select', options: kindOptions },
        { key: 'label', label: 'Label', placeholder: 'LinkedIn post', width: '100%' },
        { key: 'why', label: 'Why', placeholder: 'One line', width: '100%' },
        { key: 'every', label: 'Every (weeks)', type: 'number', width: '90px' },
        { key: 'anchor', label: 'Anchor date', placeholder: 'YYYY-MM-DD', width: '120px' },
        { key: 'timeNote', label: 'Time note', placeholder: 'evening', width: '110px' },
        { key: 'optional', label: 'Optional', type: 'check', width: '100px' },
      ],
    });
    const monthlyList = rowList(monthly, {
      canEdit, onChange: mark, addLabel: 'Add monthly slot',
      newRow: () => ({ _n: '2', _wd: 'Wed', time: '10:30', kind: 'note', label: '', _skip: '' }),
      columns: [
        { key: '_n', label: 'Week', type: 'select', options: NTH, width: '80px' },
        { key: '_wd', label: 'Day', type: 'select', options: DAYS, width: '80px' },
        { key: 'time', label: 'Time', type: 'time', width: '110px' },
        { key: 'kind', label: 'Kind', type: 'select', options: kindOptions },
        { key: 'label', label: 'Label', placeholder: 'Monthly note', width: '100%' },
        { key: '_skip', label: 'Skip months', placeholder: '2027-03, 2027-08', width: '100%' },
      ],
    });

    slotsHost.replaceChildren(
      card({
        title: 'Slots',
        body: [
          field({ label: 'Account', input: picker }),
          bullets([
            `Weekly: ${weeklyLine(acc) || 'none'}`,
            'Every 2 weeks needs an anchor date',
            'Derived and alternate rules keep their settings',
          ], { compact: true }),
          el('div', { class: 'bx-list-label', text: `Weekly (${weekly.length})` }),
          weeklyList,
          el('div', { class: 'bx-list-label', style: { marginTop: '10px' }, text: `Monthly (${monthly.length})` }),
          monthlyList,
        ],
        footer: canEdit ? [saveBtn] : undefined,
      }),
    );
  }

  async function saveSlots(acc, weekly, monthly) {
    const outW = [];
    for (const w of weekly) {
      const row = { ...w };
      if (!DAYS.includes(row.day)) { toast('Each weekly slot needs a day', 'warn'); return; }
      if (!row.kind) { toast('Each weekly slot needs a kind', 'warn'); return; }
      row.time = row.time || '';
      if (!(row.every > 1)) delete row.every;
      if (row.every > 1 && !isYmd(row.anchor)) { toast(`${row.day} every ${row.every} weeks needs an anchor date (YYYY-MM-DD)`, 'warn'); return; }
      if (row.anchor === '' || row.anchor === null) delete row.anchor;
      if (!row.optional) delete row.optional;
      for (const k of ['label', 'why', 'timeNote']) { if (typeof row[k] === 'string') row[k] = row[k].trim(); if (!row[k]) delete row[k]; }
      if (!row.label) { const k = kindLabel(row.kind); row.label = k.charAt(0).toUpperCase() + k.slice(1); }
      outW.push(row);
    }
    const outM = [];
    for (const m of monthly) {
      const { _n, _wd, _skip, ...row } = m;
      if (!row.kind) { toast('Each monthly slot needs a kind', 'warn'); return; }
      row.rule = `${({ 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th' })[_n] || '2nd'} ${_wd || 'Wed'}`;
      const skip = String(_skip || '').split(/[\s,]+/).filter(Boolean);
      const bad = skip.find((s) => !isMonth(s));
      if (bad) { toast(`Skip months are YYYY-MM, not ${bad}`, 'warn'); return; }
      if (skip.length) row.skipMonths = skip; else delete row.skipMonths;
      row.time = row.time || '';
      for (const k of ['label', 'why', 'timeNote']) { if (typeof row[k] === 'string') row[k] = row[k].trim(); if (!row[k]) delete row[k]; }
      if (!row.label) { const k = kindLabel(row.kind); row.label = k.charAt(0).toUpperCase() + k.slice(1); }
      outM.push(row);
    }
    try {
      const fresh = await api.get(`/accounts/${encodeURIComponent(acc.id)}`);
      const saved = await api.put(`/accounts/${encodeURIComponent(acc.id)}`, { ...fresh, weekly: outW, monthly: outM });
      ctx.accounts = (ctx.accounts || []).map((a) => (a.id === saved.id ? saved : a));
      drawSlots();
      toast('Saved', 'ok');
      offerRebuild();
    } catch (err) { toast(err.message, 'bad'); }
  }

  function offerRebuild() {
    if (!canRebuild) return;
    const t = toast('Slots saved. Rebuild the calendar to use them.', 'info', { ms: 8000 });
    t.appendChild(button({ kind: 'secondary', small: true, label: 'Rebuild', onClick: () => { t.remove(); rebuild(); } }));
  }

  // -------------------------------------------------------- calendar defaults
  const defaults = conf.defaults || FALLBACK.defaults;
  function defaultsCard() {
    const stored = clone(ctx.settings?.calendar || {});
    const eff = (k) => (stored[k] !== undefined && stored[k] !== null && stored[k] !== '' ? stored[k] : defaults[k]);
    const vals = {
      singleLinkedInBefore: eff('singleLinkedInBefore'), carouselFrom: eff('carouselFrom'),
      carouselEveryDays: eff('carouselEveryDays'), greetingTime: eff('greetingTime'),
    };
    const mf = Object.entries({ ...(defaults.monthlyFrom || {}), ...(stored.monthlyFrom || {}) }).map(([kind, date]) => ({ kind, date }));
    const disabled = !canEdit;

    const one = (key, label, type, hint) => {
      const inp = input({ type, value: vals[key] ?? '', disabled, min: type === 'number' ? '1' : undefined, onInput: (e) => { vals[key] = type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value; } });
      const reset = canEdit && button({ kind: 'ghost', small: true, label: 'Reset to default', onClick: () => { vals[key] = defaults[key]; inp.value = defaults[key]; } });
      return field({ label, input: el('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, [inp, reset]), hint: `${hint}. Default ${defaults[key]}` });
    };
    const mfList = rowList(mf, {
      canEdit, addLabel: 'Add start date',
      newRow: () => ({ kind: 'yt-long', date: '' }),
      columns: [
        { key: 'kind', label: 'Kind', type: 'select', options: kindOptions },
        { key: 'date', label: 'From', placeholder: 'YYYY-MM-DD', width: '130px' },
      ],
    });

    const save = async () => {
      const next = {};
      if (isYmd(vals.singleLinkedInBefore) && vals.singleLinkedInBefore !== defaults.singleLinkedInBefore) next.singleLinkedInBefore = vals.singleLinkedInBefore;
      if (isYmd(vals.carouselFrom) && vals.carouselFrom !== defaults.carouselFrom) next.carouselFrom = vals.carouselFrom;
      const every = Number(vals.carouselEveryDays);
      if (vals.carouselEveryDays !== '' && (!Number.isInteger(every) || every < 1)) { toast('Carousel every (days) is a whole number', 'warn'); return; }
      if (vals.carouselEveryDays !== '' && every !== defaults.carouselEveryDays) next.carouselEveryDays = every;
      if (vals.greetingTime && vals.greetingTime !== defaults.greetingTime) next.greetingTime = vals.greetingTime;
      const map = {};
      for (const r of mf) {
        if (!r.kind) continue;
        if (!isYmd(r.date)) { toast(`Start date for ${kindLabel(r.kind)} is YYYY-MM-DD`, 'warn'); return; }
        map[r.kind] = r.date;
      }
      if (!same(map, defaults.monthlyFrom)) next.monthlyFrom = map;
      try {
        await ctx.saveSettings((doc) => {
          const keep = { ...(doc.calendar || {}) };
          for (const k of ['singleLinkedInBefore', 'carouselFrom', 'carouselEveryDays', 'greetingTime', 'monthlyFrom']) delete keep[k];
          const merged = { ...keep, ...next };
          if (Object.keys(merged).length) doc.calendar = merged; else delete doc.calendar;
        });
        drawDefaults();
        offerRebuild();
      } catch (err) { toast(err.message, 'bad'); }
    };
    const resetAll = async () => {
      const ok = await confirm({ title: 'Reset calendar defaults', message: 'Put every calendar default back to the built-in value?', confirmLabel: 'Reset' });
      if (!ok) return;
      try {
        await ctx.saveSettings((doc) => { const keep = { ...(doc.calendar || {}) }; for (const k of ['singleLinkedInBefore', 'carouselFrom', 'carouselEveryDays', 'greetingTime', 'monthlyFrom']) delete keep[k]; if (Object.keys(keep).length) doc.calendar = keep; else delete doc.calendar; });
        drawDefaults();
      } catch (err) { toast(err.message, 'bad'); }
    };

    return card({
      title: 'Calendar defaults',
      body: [
        el('div', { class: 'form-grid' }, [
          one('singleLinkedInBefore', 'One LinkedIn post a week until', 'date', 'Then the full LinkedIn rhythm'),
          one('carouselFrom', 'LinkedIn carousel from', 'date', 'First carousel Wednesday'),
          one('carouselEveryDays', 'Carousel every (days)', 'number', 'Days between carousels'),
          one('greetingTime', 'Greeting slot time', 'time', 'The evening before a festival'),
        ]),
        el('div', { class: 'bx-list-label', text: 'Monthly slots start on' }),
        mfList,
      ],
      footer: canEdit ? [
        button({ kind: 'ghost', label: 'Reset all to default', onClick: resetAll }),
        button({ kind: 'primary', label: 'Save defaults', onClick: save }),
      ] : undefined,
    });
  }
  const defaultsHost = el('div');
  const drawDefaults = () => defaultsHost.replaceChildren(defaultsCard());

  // -------------------------------------------------------- time zone and go dark
  function darkCard() {
    const s = ctx.settings || {};
    const gd = { on: false, from: '', to: '', reason: '', ...(s.goDark || {}) };
    const disabled = !canEdit;
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = []; }
    const tz = input({ value: s.timezone || 'Asia/Kolkata', list: 'bx-rhythm-zones', disabled });
    const save = async () => {
      if (gd.from && gd.to && gd.to < gd.from) { toast('Dark to is before dark from', 'warn'); return; }
      const zone = tz.value.trim() || 'Asia/Kolkata';
      try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { toast(`${zone} is not a time zone`, 'warn'); return; }
      try {
        await ctx.saveSettings((doc) => {
          doc.goDark = { on: Boolean(gd.on), from: gd.from || '', to: gd.to || '', reason: String(gd.reason || '').trim() };
          doc.timezone = zone;
        });
        drawDark();
      } catch (err) { toast(err.message, 'bad'); }
    };
    return card({
      title: 'Time zone and go dark',
      body: [
        bullets(['Go dark pauses every slot in its dates', 'Use it on a day of mourning, through the funeral day', 'The calendar shows it at once'], { compact: true }),
        el('div', { class: 'field' }, switchInput({ label: 'Go dark', checked: gd.on, disabled, onChange: (e) => { gd.on = e.target.checked; } })),
        el('div', { class: 'form-grid' }, [
          field({ label: 'Dark from', input: input({ type: 'date', value: gd.from || '', disabled, onInput: (e) => { gd.from = e.target.value; } }), hint: 'Blank: from today' }),
          field({ label: 'Dark to', input: input({ type: 'date', value: gd.to || '', disabled, onInput: (e) => { gd.to = e.target.value; } }), hint: 'Blank: until switched off' }),
          field({ label: 'Reason', input: input({ value: gd.reason || '', placeholder: 'Mourning, a news day', disabled, onInput: (e) => { gd.reason = e.target.value; } }) }),
          field({ label: 'Time zone', input: tz, hint: 'Default Asia/Kolkata' }),
        ]),
        el('datalist', { id: 'bx-rhythm-zones' }, zones.map((z) => el('option', { value: z }))),
      ],
      footer: canEdit ? [button({ kind: 'primary', label: 'Save', onClick: save })] : undefined,
    });
  }
  const darkHost = el('div');
  const drawDark = () => darkHost.replaceChildren(darkCard());

  drawSlots();
  drawDefaults();
  drawDark();
  container.append(slotsHost, rebuildCard(), defaultsHost, darkHost);
}

export const box = {
  id: 'rhythm', title: 'Posting rhythm', icon: 'calendar', order: 40,
  summary,
  render,
};
