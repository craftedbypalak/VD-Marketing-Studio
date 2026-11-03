// Builder box: Occasions. Contract: docs/BUILDER.md.
// settings.occasions (greeting time, Status account, years before an idea repeats, idea post types)
// and the festival angle bank (`festival-angles` collection, through the generic collection routes).
// Read by server/recurring.mjs (occasionsConfig) and app/js/views/recurring.js.
import { el, card, field, input, textarea, select, button, bullets, chip, toast, confirm, dialog, empty } from '../../ui.js';
import { rowList } from '../kit.js';
import { occasionsConfig } from '../../views/recurring.js';

const SLOT_KINDS = ['reel', 'carousel', 'status', 'trial', 'li', 'li-carousel'];
const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const seriesLabel = (s) => (s ? s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'No series');

function loadAngles(ctx) {
  if (!ctx._angles) ctx._angles = ctx.api.get('/festival-angles').then((r) => (Array.isArray(r) ? r : (r?.items || [])));
  return ctx._angles;
}

export const box = {
  id: 'occasions', title: 'Occasions', icon: 'recurring', order: 70,
  summary(ctx) {
    const c = occasionsConfig(ctx.settings);
    const acc = (ctx.accounts || []).find((a) => a.id === c.statusAccount);
    const n = el('span', { text: 'Festival angles' });
    loadAngles(ctx).then((list) => { n.textContent = `${list.length} festival angles`; }).catch(() => {});
    return [
      `Greetings at ${c.greetingTime} on ${acc?.platform === 'whatsapp' && /status/i.test(acc.label) ? 'Status' : (acc?.label || c.statusAccount)}`,
      `Ideas never repeat within ${c.conceptYears} years`,
      n,
    ];
  },
  async render(container, ctx) {
    if (!document.getElementById('recurring-css')) document.head.appendChild(el('link', { id: 'recurring-css', rel: 'stylesheet', href: 'css/recurring.css' }));
    const dis = !ctx.canEdit;
    container.replaceChildren();
    const cfg = occasionsConfig(ctx.settings);
    const rerender = () => box.render(container, ctx);
    const resetKeys = async (keys, what) => {
      if (!(await confirm({ title: 'Reset to default', message: `Put ${what} back to the defaults?`, confirmLabel: 'Reset' }))) return;
      try { await ctx.saveSettings((doc) => { doc.occasions = { ...(doc.occasions || {}) }; for (const k of keys) delete doc.occasions[k]; }); rerender(); }
      catch (err) { toast(err.message, 'bad'); }
    };
    const saveKeys = async (values, btn) => {
      btn.disabled = true;
      try { await ctx.saveSettings((doc) => { doc.occasions = { ...(doc.occasions || {}), ...values }; }); rerender(); }
      catch (err) { toast(err.message, 'bad'); btn.disabled = false; }
    };
    const actions = (onSave, keys, what) => (dis ? null : el('div', { class: 'row', style: { marginTop: '10px', gap: '8px', flexWrap: 'wrap' } }, [
      button({ kind: 'primary', label: 'Save', onClick: (e) => onSave(e.currentTarget) }),
      button({ kind: 'ghost', label: 'Reset to default', onClick: () => resetKeys(keys, what) }),
    ]));

    // ---- greetings and ideas
    const time = input({ type: 'time', value: cfg.greetingTime, disabled: dis });
    const accounts = (ctx.accounts || []).filter((a) => a.platform !== 'in-person');
    const acc = select({ options: accounts.map((a) => ({ value: a.id, label: a.label })), value: cfg.statusAccount, disabled: dis });
    if (!accounts.some((a) => a.id === cfg.statusAccount)) acc.appendChild(el('option', { value: cfg.statusAccount, text: cfg.statusAccount, selected: true }));
    const years = input({ type: 'number', min: 1, max: 50, value: cfg.conceptYears, disabled: dis });
    const calendarTime = ctx.settings?.calendar?.greetingTime;
    container.append(card({
      title: 'Greetings and ideas',
      body: el('div', {}, [
        bullets([
          'Greetings go on the eve of each festival',
          'Festival ideas reuse an angle only after the years set here',
        ], { compact: true }),
        el('div', { class: 'form-grid' }, [
          field({ label: 'Greeting time', input: time, hint: ctx.settings?.occasions?.greetingTime ? '' : `Now from ${calendarTime ? 'Posting rhythm' : 'the default'}.` }),
          field({ label: 'Greeting account', input: acc }),
          field({ label: 'Years before an angle repeats', input: years }),
        ]),
        actions((btn) => {
          const y = Math.round(Number(years.value));
          if (!/^\d{2}:\d{2}$/.test(time.value)) { toast('Give a time, for example 19:00', 'warn'); return; }
          if (!Number.isFinite(y) || y < 1 || y > 50) { toast('Years: 1 to 50', 'warn'); return; }
          saveKeys({ greetingTime: time.value, statusAccount: acc.value, conceptYears: y }, btn);
        }, ['greetingTime', 'statusAccount', 'conceptYears'], 'greetings and ideas'),
      ]),
    }));

    // ---- idea post types
    const types = Object.entries(cfg.conceptTypes).map(([type, kind]) => ({ type, kind }));
    const kinds = [...new Set([...SLOT_KINDS, ...types.map((t) => t.kind)])];
    container.append(card({
      title: 'Idea post types',
      body: el('div', {}, [
        bullets(['What a festival idea can be made into', 'Each type goes on a slot of its kind'], { compact: true }),
        rowList(types, {
          canEdit: !dis, addLabel: 'Add a type', newRow: () => ({ type: '', kind: 'reel' }),
          columns: [
            { key: 'type', label: 'Post type', placeholder: 'for example broll' },
            { key: 'kind', label: 'Slot kind', type: 'select', options: kinds },
          ],
        }),
        actions((btn) => {
          const map = {};
          for (const t of types) { const k = slug(t.type); if (k) map[k] = t.kind || 'reel'; }
          if (!Object.keys(map).length) { toast('Keep at least one post type', 'warn'); return; }
          saveKeys({ conceptTypes: map }, btn);
        }, ['conceptTypes'], 'the idea post types'),
      ]),
    }));

    // ---- festival angle bank
    const bankHost = el('div');
    container.append(card({
      title: 'Festival angle bank',
      actions: dis ? null : [button({ kind: 'secondary', small: true, icon: 'plus', label: 'Add an angle', onClick: () => editAngle(null) })],
      body: el('div', {}, [
        bullets([
          'Each angle links a festival image to one solution',
          'Ideas are drawn only from unused angles',
          'Used in: the years an angle went out',
        ], { compact: true }),
        bankHost,
      ]),
    }));

    let angles = [];
    let solutions = [];
    const reload = async () => {
      ctx._angles = null;
      bankHost.replaceChildren(el('div', { class: 'loading', text: 'Loading' }));
      try {
        [angles, solutions] = await Promise.all([loadAngles(ctx), ctx.api.get('/solutions').then((r) => (Array.isArray(r) ? r : (r?.items || []))).catch(() => [])]);
      } catch (err) { bankHost.replaceChildren(el('div', { class: 'banner banner-bad', text: err.message })); return; }
      drawBank();
    };
    const drawBank = () => {
      if (!angles.length) { bankHost.replaceChildren(empty({ title: 'No angles yet', hint: 'Add one for a festival series.' })); return; }
      const bySeries = new Map();
      for (const a of angles) { const k = a.series || ''; if (!bySeries.has(k)) bySeries.set(k, []); bySeries.get(k).push(a); }
      const keys = [...bySeries.keys()].sort();
      bankHost.replaceChildren(...keys.map((k) => {
        const list = bySeries.get(k).sort((a, b) => String(a.title).localeCompare(String(b.title)));
        return el('details', { class: 'bx-rowcard', style: { display: 'block' } }, [
          el('summary', { style: { cursor: 'pointer', display: 'flex', flexWrap: 'wrap', gap: '6px 10px', alignItems: 'center', fontWeight: '600' } }, [
            el('span', { text: seriesLabel(k) }), chip({ label: `${list.length}`, tone: 'muted' }),
          ]),
          el('div', { style: { display: 'grid', gap: '8px', marginTop: '10px' } }, list.map((a) => el('div', { class: 'obx-angle' }, [
            el('div', { class: 'obx-angle-main' }, [
              el('b', { text: a.title || a.id }),
              el('div', { class: 'obx-angle-meta' }, [
                chip({ label: a.solutionName || a.solutionId || 'No solution', tone: 'navy' }),
                ...(a.usedIn || []).length ? (a.usedIn || []).map((y) => chip({ label: `Used ${y}`, tone: 'muted' })) : [chip({ label: 'Not used yet', tone: 'ok' })],
              ]),
            ]),
            el('div', { class: 'row', style: { gap: '4px' } }, [
              button({ kind: 'ghost', small: true, icon: dis ? undefined : 'edit', label: dis ? 'View' : 'Edit', onClick: () => editAngle(a) }),
              dis ? null : button({ kind: 'ghost', small: true, icon: 'trash', title: 'Remove', onClick: () => removeAngle(a) }),
            ]),
          ]))),
        ]);
      }));
    };
    const removeAngle = async (a) => {
      if (!(await confirm({ title: 'Remove this angle', message: `Remove "${a.title}" from the bank?`, confirmLabel: 'Remove', danger: true }))) return;
      try { await ctx.api.del(`/festival-angles/${encodeURIComponent(a.id)}`); toast('Removed', 'ok'); await reload(); } catch (err) { toast(err.message, 'bad'); }
    };
    const editAngle = (a) => {
      const isNew = !a;
      const seriesList = [...new Set(angles.map((x) => x.series).filter(Boolean))].sort();
      const series = input({ value: a?.series || '', list: 'obx-series', placeholder: 'for example diwali', disabled: dis });
      const title = input({ value: a?.title || '', disabled: dis });
      const image = textarea({ rows: 2, value: a?.image || '', disabled: dis });
      const scene = textarea({ rows: 3, value: a?.scene || '', disabled: dis });
      const sol = select({ options: solutions.map((s) => ({ value: s.id, label: s.publicName })), value: a?.solutionId || '', placeholder: 'Choose a solution', disabled: dis });
      if (a?.solutionId && !solutions.some((s) => s.id === a.solutionId)) sol.appendChild(el('option', { value: a.solutionId, text: a.solutionName || a.solutionId, selected: true }));
      const line = textarea({ rows: 3, value: a?.line || '', disabled: dis });
      const used = (a?.usedIn || []).length ? (a.usedIn || []).join(', ') : 'Not used yet';
      let d;
      const save = button({ kind: 'primary', label: 'Save', onClick: async () => {
        const body = {
          series: slug(series.value), title: title.value.trim(), image: image.value.trim(), scene: scene.value.trim(),
          solutionId: sol.value, solutionName: solutions.find((s) => s.id === sol.value)?.publicName || a?.solutionName || '', line: line.value.trim(),
        };
        if (!body.series || !body.title || !body.solutionId) { toast('Series, title and solution are needed', 'warn'); return; }
        save.disabled = true;
        try {
          if (isNew) {
            let id = `${body.series}-${slug(body.title).split('-').slice(0, 4).join('-')}`;
            while (angles.some((x) => x.id === id)) id += '-2';
            await ctx.api.post('/festival-angles', { id, ...body, usedIn: [] });
          } else await ctx.api.patch(`/festival-angles/${encodeURIComponent(a.id)}`, body);
          toast('Saved', 'ok'); d.close(); await reload();
        } catch (err) { toast(err.message, 'bad'); save.disabled = false; }
      } });
      d = dialog({
        title: isNew ? 'New festival angle' : (dis ? 'Festival angle' : 'Edit festival angle'), wide: true,
        body: el('div', {}, [
          el('datalist', { id: 'obx-series' }, seriesList.map((x) => el('option', { value: x }))),
          el('div', { class: 'form-grid' }, [field({ label: 'Series', input: series }), field({ label: 'Solution', input: sol })]),
          field({ label: 'Title', input: title }),
          field({ label: 'Festival image', input: image, hint: 'What the festival shows.' }),
          field({ label: "Owner's scene", input: scene, hint: 'The same problem in a business.' }),
          field({ label: 'Line', input: line, hint: 'Image, cost, then the solution.' }),
          field({ label: 'Used in', input: input({ value: used, disabled: true }) }),
        ]),
        actions: dis ? [] : [button({ kind: 'secondary', label: 'Cancel', onClick: () => d.close() }), save],
      });
    };
    await reload();
  },
};
