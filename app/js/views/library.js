// Content library (#/content). [content]
// A filtered list of every piece, with search over hook and text, bulk actions,
// "New piece" and "Propose from a moment".

import { api } from '../api.js';
import { el, button, field, input, select, textarea, chip, statusPill, dialog, toast, empty, fmt, checkbox } from '../ui.js';
import {
  TYPES, PILLARS, STATUSES, AWAITING_REVIEW, SUBMITTABLE, statusLabel, typeLabel, pillarLabel, defaultTargets, ensureStyles, loadRefs, aiFailed, ask,
} from './piece.js';

export const route = '#/content';
export const title = 'Content';

// "Awaiting review" covers both review statuses: with the manager and with the director.
const STATUS_FILTERS = [{ value: 'awaiting-review', label: 'Awaiting review (either)' }, ...STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))];

/** How a piece's last stored check stands: unchecked | blocked | warned | passed. */
export function checkState(p) {
  const v = p?.check?.violations;
  if (!Array.isArray(v)) return { state: 'unchecked', blocks: 0, warns: 0 };
  const blocks = v.filter((x) => x.severity === 'block').length;
  const warns = v.length - blocks;
  return { state: blocks ? 'blocked' : warns ? 'warned' : 'passed', blocks, warns };
}

/** A small chip for the checker state, shared by the library and the calendar picker. */
export function checkChip(p) {
  const c = checkState(p);
  if (c.state === 'blocked') return chip({ label: `Blocked, ${c.blocks}`, tone: 'bad' });
  if (c.state === 'warned') return chip({ label: `${c.warns} to look at`, tone: 'warn' });
  if (c.state === 'passed') return chip({ label: 'Passes', tone: 'ok' });
  return chip({ label: 'Not checked yet', tone: 'muted' });
}
const CHECKER_FILTERS = [
  { value: 'blocked', label: 'Blocked by the checker' },
  { value: 'warned', label: 'Warnings only' },
  { value: 'passed', label: 'Passes the checker' },
  { value: 'unchecked', label: 'Not checked yet' },
];

function haystack(p) {
  const parts = [p.id, p.hook, p.notes, ...(p.tags || [])];
  const pis = p.pis || {};
  parts.push(pis.problem, pis.impact, ...(Array.isArray(pis.solution) ? pis.solution : [pis.solution]), pis.close);
  for (const r of Object.values(p.renditions || {})) {
    parts.push(r?.text, r?.caption, r?.title, r?.description, r?.firstComment, ...(r?.hashtags || []));
  }
  for (const row of p.script || []) parts.push(row.say);
  for (const s of p.slides || []) parts.push(s.eyebrow, s.head, s.body, ...(s.items || []));
  return parts.filter(Boolean).join(' \n').toLowerCase();
}

export async function render(container, params) {
  ensureStyles();
  container.appendChild(el('div', { class: 'loading', text: 'Loading the library' }));
  let pieces; let refs;
  try {
    [pieces, refs] = await Promise.all([api.get('/pieces'), loadRefs(true)]);
  } catch (err) {
    container.replaceChildren(el('div', { class: 'banner banner-bad', text: `Could not load the library: ${err.message}` }));
    return;
  }
  container.replaceChildren();
  const short = Object.fromEntries(refs.accounts.map((a) => [a.id, a.short || a.id]));
  const hay = new Map(pieces.map((p) => [p.id, haystack(p)]));
  const f = { q: String(params?.query?.q || '').trim().toLowerCase(), type: '', pillar: '', status: '', target: '', tag: '', campaign: '', checker: CHECKER_FILTERS.some((c) => c.value === params?.query?.checker) ? params.query.checker : '', unscheduled: false, sort: 'planned' };
  const selected = new Set();

  // ------------------------------------------------------------ controls
  const tagSet = [...new Set(pieces.flatMap((p) => p.tags || []))].sort();
  const opt = (list, all) => [{ value: '', label: all }, ...list];
  const q = input({ type: 'search', value: f.q, placeholder: 'Search the hook and the text', 'aria-label': 'Search', onInput: (e) => { f.q = e.target.value.trim().toLowerCase(); draw(); } });
  const sel = (key, options, all) => select({ options: opt(options, all), value: f[key], onChange: (e) => { f[key] = e.target.value; draw(); } });
  const filters = el('div', { class: 'ct-filters' }, [
    field({ label: 'Type', input: sel('type', TYPES, 'All types') }),
    field({ label: 'Pillar', input: sel('pillar', PILLARS, 'All pillars') }),
    field({ label: 'Status', input: sel('status', STATUS_FILTERS, 'All statuses') }),
    field({ label: 'Account', input: sel('target', refs.accounts.map((a) => ({ value: a.id, label: a.label })), 'All accounts') }),
    field({ label: 'Tag', input: sel('tag', tagSet.map((t) => ({ value: t, label: t })), 'All tags') }),
    field({ label: 'Campaign', input: sel('campaign', (refs.campaigns || []).map((c) => ({ value: c.id, label: c.name || c.id })), 'All campaigns') }),
    field({ label: 'Checker', input: sel('checker', CHECKER_FILTERS, 'Any checker result') }),
    field({ label: 'Order', input: select({ options: [{ value: 'planned', label: 'Planned date' }, { value: 'updated', label: 'Last updated' }, { value: 'hook', label: 'Hook' }], value: f.sort, onChange: (e) => { f.sort = e.target.value; draw(); } }) }),
    checkbox({ label: 'Not yet scheduled', checked: false, onChange: (e) => { f.unscheduled = e.target.checked; draw(); } }),
  ]);

  const countEl = el('span', { class: 'ct-count' });
  const bulkHost = el('div');
  const listHost = el('div');

  container.append(
    el('div', { class: 'ct-toolbar' }, [
      q,
      el('span', { class: 'ct-spacer' }),
      button({ kind: 'secondary', icon: 'check', label: 'Check all', title: 'Runs the brief checker over every piece and stores the result', onClick: checkAll }),
      button({ kind: 'secondary', icon: 'sparkle', label: 'Propose from a moment', onClick: () => proposeDialog() }),
      button({ kind: 'primary', icon: 'plus', label: 'New piece', onClick: () => newDialog() }),
    ]),
    filters,
    el('div', { class: 'row spread', style: { marginBottom: '8px' } }, [countEl]),
    bulkHost,
    el('div', { class: 'ct-card-wrap' }, el('div', { class: 'table-wrap' }, listHost)),
  );

  // --------------------------------------------------------------- list
  function visible() {
    let rows = pieces.filter((p) => {
      if (f.type && p.type !== f.type) return false;
      if (f.pillar && p.pillar !== f.pillar) return false;
      if (f.status === 'awaiting-review') { if (!AWAITING_REVIEW.includes(p.status)) return false; } else if (f.status && p.status !== f.status) return false;
      if (f.target && !(p.targets || []).includes(f.target)) return false;
      if (f.tag && !(p.tags || []).includes(f.tag)) return false;
      if (f.campaign && p.campaignId !== f.campaign) return false;
      if (f.checker && checkState(p).state !== f.checker) return false;
      if (f.unscheduled && p.plannedDate) return false;
      if (f.q && !hay.get(p.id).includes(f.q)) return false;
      return true;
    });
    const cmp = {
      planned: (a, b) => `${a.plannedDate || '9999'} ${a.plannedTime || ''} ${a.id}`.localeCompare(`${b.plannedDate || '9999'} ${b.plannedTime || ''} ${b.id}`),
      updated: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
      hook: (a, b) => String(a.hook || '').localeCompare(String(b.hook || '')),
    }[f.sort];
    rows = rows.sort(cmp);
    return rows;
  }

  function draw() {
    const rows = visible();
    countEl.textContent = `Showing ${rows.length} of ${pieces.length}`;
    for (const id of [...selected]) if (!rows.some((p) => p.id === id)) selected.delete(id);
    drawBulk(rows);
    if (!rows.length) { listHost.replaceChildren(empty({ title: 'No piece matches', hint: 'Clear a filter or write a new piece.' })); return; }
    const all = el('input', { type: 'checkbox', 'aria-label': 'Select all shown', checked: rows.every((p) => selected.has(p.id)) });
    all.addEventListener('change', () => { if (all.checked) rows.forEach((p) => selected.add(p.id)); else rows.forEach((p) => selected.delete(p.id)); draw(); });
    const table = el('table', { class: 'ct-lib' });
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', { class: 'ct-sel' }, all), el('th', { text: 'Hook' }), el('th', { class: 'col-md', text: 'Type' }), el('th', { class: 'col-md', text: 'Pillar' }),
      el('th', { text: 'Status' }), el('th', { text: 'Checker' }), el('th', { text: 'Planned' }), el('th', { class: 'col-md', text: 'Goes to' }), el('th', { class: 'col-md', text: 'Updated' }),
    ])));
    const tb = el('tbody');
    for (const p of rows) {
      const cb = el('input', { type: 'checkbox', checked: selected.has(p.id), 'aria-label': `Select ${p.hook || p.id}` });
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => { if (cb.checked) selected.add(p.id); else selected.delete(p.id); drawBulk(rows); });
      const tr = el('tr', { dataset: { id: p.id } }, [
        el('td', { class: 'ct-sel' }, cb),
        el('td', {}, [el('div', { class: 'ct-hook', text: p.hook || '(no hook yet)' }), el('div', { class: 'ct-id', text: p.id })]),
        el('td', { class: 'col-md', text: typeLabel(p.type) }),
        el('td', { class: 'col-md', text: pillarLabel(p.pillar) }),
        el('td', {}, statusPill(p.status)),
        el('td', {}, checkChip(p)),
        el('td', { class: 'ct-planned', text: p.plannedDate ? `${fmt.weekday(p.plannedDate)} ${p.plannedDate.slice(5)}${p.plannedTime ? ` ${p.plannedTime}` : ''}` : '' }),
        el('td', { class: 'col-md' }, el('div', { class: 'chips' }, (p.targets || []).map((t) => chip({ label: short[t] || t, tone: 'muted' })))),
        el('td', { class: 'col-md ct-planned', text: fmt.dateTime(p.updatedAt) }),
      ]);
      tr.addEventListener('click', () => { location.hash = `#/content/${encodeURIComponent(p.id)}`; });
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    listHost.replaceChildren(table);
  }

  function drawBulk(rows) {
    const ids = [...selected];
    if (!ids.length) { bulkHost.replaceChildren(); return; }
    bulkHost.replaceChildren(el('div', { class: 'ct-bulk' }, [
      el('b', { text: `${ids.length} selected` }),
      button({ kind: 'secondary', small: true, label: 'Submit for review', onClick: () => bulk('in-review', ids) }),
      button({ kind: 'danger', small: true, label: 'Retire', onClick: () => bulk('retired', ids) }),
      button({ kind: 'ghost', small: true, label: 'Clear', onClick: () => { selected.clear(); draw(); } }),
    ]));
  }

  async function bulk(status, ids) {
    const movable = ids.filter((id) => {
      const p = pieces.find((x) => x.id === id);
      if (!p) return false;
      if (status === 'in-review') return SUBMITTABLE.includes(p.status);
      return p.status !== 'retired';
    });
    if (!movable.length) { toast(status === 'in-review' ? 'Only ideas, drafts and pieces with changes requested can go to review' : 'Nothing to change', 'warn'); return; }
    if (status === 'retired' && !(await ask({ title: 'Retire the selected pieces', message: `${movable.length} ${movable.length === 1 ? 'piece leaves' : 'pieces leave'} the queues and the calendar pickers.`, confirmLabel: 'Retire', danger: true }))) return;
    let ok = 0;
    for (const id of movable) {
      try {
        const stored = await api.patch(`/pieces/${encodeURIComponent(id)}`, { status });
        const i = pieces.findIndex((x) => x.id === id);
        if (i >= 0) pieces[i] = stored;
        ok++;
      } catch (err) { toast(`${id}: ${err.message}`, 'bad'); }
    }
    selected.clear();
    toast(`${ok} ${ok === 1 ? 'piece' : 'pieces'} updated${movable.length < ids.length ? `; ${ids.length - movable.length} skipped` : ''}`, 'ok');
    draw();
  }

  // ------------------------------------------------------------ check all
  async function checkAll(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    const old = btn.lastChild.textContent;
    btn.lastChild.textContent = 'Checking';
    try {
      const r = await api.post('/content/check-all', {});
      pieces = await api.get('/pieces');
      hay.clear();
      for (const p of pieces) hay.set(p.id, haystack(p));
      toast(`Checked ${r.checked} pieces: ${r.blocked} blocked, ${r.warned} with warnings only, ${r.passed} pass.`, r.blocked ? 'warn' : 'ok', { ms: 7000 });
      draw();
    } catch (err) { toast(err.message, 'bad'); }
    finally { btn.disabled = false; btn.lastChild.textContent = old; }
  }

  // ------------------------------------------------------------ new piece
  function newDialog() {
    const type = select({ options: TYPES, value: 'broll' });
    const pillar = select({ options: PILLARS, value: 'problem' });
    const hook = input({ placeholder: 'Optional; eight words or fewer' });
    let d;
    d = dialog({
      title: 'New piece',
      body: [field({ label: 'Type', input: type }), field({ label: 'Pillar', input: pillar }), field({ label: 'Hook', input: hook })],
      actions: [
        button({ label: 'Cancel', onClick: () => d.close() }),
        button({ kind: 'primary', label: 'Open the editor', onClick: async () => {
          try {
            const created = await api.post('/pieces', {
              type: type.value, pillar: pillar.value, status: 'draft', hook: hook.value.trim(), tags: [], assets: [],
              pis: { problem: '', impact: '', solution: [], close: '' }, renditions: {}, targets: defaultTargets(type.value), changeNote: 'Created',
            });
            d.close();
            location.hash = `#/content/${encodeURIComponent(created.id)}`;
          } catch (err) { toast(err.message, 'bad'); }
        } }),
      ],
    });
  }

  // -------------------------------------------------------------- propose
  function proposeDialog() {
    const moment = textarea({ rows: 3, placeholder: 'One sentence: for example, the owner calls three people at 7 pm to ask whether the dispatch went out.' });
    const pillar = select({ options: [{ value: '', label: 'Any pillar' }, ...PILLARS.slice(0, 5)], value: '' });
    const sector = input({ placeholder: 'Optional: textiles, distribution, a professional firm' });
    const results = el('div');
    const run = button({ kind: 'primary', icon: 'sparkle', label: 'Propose three sets', onClick: async () => {
      if (!moment.value.trim()) { toast('Write the moment in one sentence first', 'warn'); return; }
      run.disabled = true;
      results.replaceChildren(el('p', { class: 'ct-ai-note', text: 'Proposing. This takes up to a minute.' }));
      try {
        const res = await api.ai('propose', { moment: moment.value.trim(), pillar: pillar.value || undefined, sector: sector.value.trim() || undefined });
        showSets(res.output.sets || []);
      } catch (err) { results.replaceChildren(); aiFailed(err); } finally { run.disabled = false; }
    } });
    const d = dialog({
      title: 'Propose from a moment', wide: true,
      body: [
        field({ label: 'The moment or topic', input: moment }),
        el('div', { class: 'form-grid' }, [field({ label: 'Pillar', input: pillar }), field({ label: 'Sector', input: sector })]),
        el('div', { class: 'row' }, run), results,
      ],
    });

    function showSets(sets) {
      if (!sets.length) { results.replaceChildren(el('p', { class: 'note', text: 'Nothing came back. Try the moment in other words.' })); return; }
      const wrap = el('div', { class: 'ct-sets' });
      sets.forEach((s, si) => {
        const radioName = `hook-${si}-${Date.now()}`;
        let chosen = 0;
        const type = select({ options: TYPES, value: 'broll' });
        const hooks = el('div', { class: 'ct-hooks' }, (s.hooks || []).map((h, hi) => {
          const r = el('input', { type: 'radio', name: radioName, checked: hi === 0 });
          r.addEventListener('change', () => { chosen = hi; });
          return el('label', {}, [r, el('span', { text: h })]);
        }));
        const go = button({ kind: 'primary', small: true, label: 'Draft this', onClick: async () => {
          go.disabled = true; go.textContent = 'Drafting';
          const hook = s.hooks?.[chosen] || '';
          const targets = defaultTargets(type.value);
          try {
            const res = await api.ai('draft', { pis: s.pis, type: type.value, targets, hook, pillar: s.pillar });
            const o = res.output || {};
            const created = await api.post('/pieces', {
              type: type.value, pillar: s.pillar || 'problem', status: 'draft', hook: o.hook || hook, pis: s.pis,
              renditions: o.renditions || {}, ...(o.script ? { script: o.script } : {}), ...(o.slides ? { slides: o.slides } : {}),
              targets, tags: [], assets: [], changeNote: 'Drafted from a proposed set',
            });
            d.close();
            location.hash = `#/content/${encodeURIComponent(created.id)}`;
          } catch (err) { aiFailed(err); go.disabled = false; go.textContent = 'Draft this'; }
        } });
        wrap.appendChild(el('div', { class: 'ct-set' }, [
          el('h3', { text: `Set ${si + 1}${s.angle ? `: ${s.angle}` : ''}` }),
          el('dl', {}, [
            el('dt', { text: 'Problem' }), el('dd', { text: s.pis?.problem || '' }),
            el('dt', { text: 'Impact' }), el('dd', { text: s.pis?.impact || '' }),
            el('dt', { text: 'Solution' }), el('dd', { text: (s.pis?.solution || []).join(' ') }),
            el('dt', { text: 'Close' }), el('dd', { text: s.pis?.close || '' }),
          ]),
          el('div', { class: 'eyebrow', text: 'Hooks' }), hooks,
          el('div', { class: 'row' }, [field({ label: 'As a', input: type }), go]),
        ]));
      });
      results.replaceChildren(wrap);
    }
  }

  draw();
}
