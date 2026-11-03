// Builder kit: what every tool box gets. Contract: docs/BUILDER.md.
//
//   ctx = await makeCtx()
//   ctx.settings, ctx.rules, ctx.accounts      fresh copies, loaded once per Builder visit
//   ctx.canEdit                                director (or owner working as director)
//   await ctx.saveSettings((doc) => { doc.video = {...} })   fetch fresh, apply, PUT, refresh ctx.settings
//   await ctx.saveRules((doc) => { doc.limits.hookWords = 9 })
//   ctx.api, ctx.toast
//
//   stringList(arr, { label, placeholder, canEdit, onChange })   add / remove plain lines
//   rowList(arr, { columns: [{ key, label, type: 'text'|'number'|'select'|'check'|'time', options, width }],
//                  newRow: () => ({}), canEdit, onChange, addLabel })   add / remove rows

import { api } from '../api.js';
import { roleOf } from '../roles.js';
import { el, button, input, select, checkbox, toast } from '../ui.js';

export async function makeCtx() {
  const [settings, rules, accounts] = await Promise.all([
    api.settings(),
    api.get('/rules/rules').catch(() => ({})),
    api.get('/accounts').catch(() => []),
  ]);
  const me = (api.user.get() || '').toLowerCase();
  let canEdit = false;
  try {
    const who = await api.get('/me');
    canEdit = who?.role === 'director' || Boolean(who?.owner);
  } catch {
    canEdit = roleOf((settings.users || []).find((u) => String(u.email).toLowerCase() === me)) === 'director';
  }
  const ctx = {
    settings, rules, accounts: Array.isArray(accounts) ? accounts : (accounts?.items || []), canEdit, api, toast,
    async saveSettings(apply) {
      const fresh = await api.settings();
      apply(fresh);
      ctx.settings = await api.put('/settings/settings', fresh);
      toast('Saved', 'ok');
      return ctx.settings;
    },
    async saveRules(apply) {
      const fresh = await api.get('/rules/rules');
      apply(fresh);
      ctx.rules = await api.put('/rules/rules', fresh);
      toast('Saved', 'ok');
      return ctx.rules;
    },
  };
  return ctx;
}

export function stringList(arr, { label, placeholder = '', canEdit = true, onChange = () => {} } = {}) {
  const wrap = el('div', { class: 'bx-list' });
  const draw = () => {
    wrap.replaceChildren(
      label ? el('div', { class: 'bx-list-label', text: `${label} (${arr.length})` }) : null,
      ...arr.map((v, i) => el('div', { class: 'bx-row' }, [
        input({ value: v, placeholder, disabled: !canEdit, onInput: (e) => { arr[i] = e.target.value; onChange(); } }),
        canEdit && button({ kind: 'ghost', small: true, icon: 'trash', title: 'Remove', onClick: () => { arr.splice(i, 1); draw(); onChange(); } }),
      ])),
      canEdit && button({ kind: 'secondary', small: true, icon: 'plus', label: 'Add', onClick: () => { arr.push(''); draw(); onChange(); wrap.querySelector('.bx-row:last-of-type input')?.focus(); } }),
    );
  };
  draw();
  return wrap;
}

export function rowList(arr, { columns = [], newRow = () => ({}), canEdit = true, onChange = () => {}, addLabel = 'Add' } = {}) {
  const wrap = el('div', { class: 'bx-rows' });
  const cell = (row, c) => {
    const set = (v) => { row[c.key] = v; onChange(); };
    const disabled = !canEdit;
    if (c.type === 'check') return checkbox({ label: c.label, checked: Boolean(row[c.key]), disabled, onChange: (e) => set(e.target.checked) });
    if (c.type === 'select') return select({ options: c.options, value: row[c.key] ?? '', disabled, onChange: (e) => set(e.target.value) });
    if (c.type === 'number') return input({ type: 'number', value: row[c.key] ?? '', disabled, onInput: (e) => set(e.target.value === '' ? null : Number(e.target.value)) });
    return input({ type: c.type === 'time' ? 'time' : 'text', value: row[c.key] ?? '', placeholder: c.placeholder || '', disabled, onInput: (e) => set(e.target.value) });
  };
  const draw = () => {
    wrap.replaceChildren(
      ...arr.map((row, i) => el('div', { class: 'bx-rowcard' }, [
        el('div', { class: 'bx-rowgrid' }, columns.map((c) => el('label', { class: 'bx-cell', style: c.width ? { flexBasis: c.width } : undefined }, [
          c.type === 'check' ? null : el('span', { class: 'bx-cell-label', text: c.label }), cell(row, c),
        ]))),
        canEdit && button({ kind: 'ghost', small: true, icon: 'trash', title: 'Remove', onClick: () => { arr.splice(i, 1); draw(); onChange(); } }),
      ])),
      canEdit && button({ kind: 'secondary', small: true, icon: 'plus', label: addLabel, onClick: () => { arr.push(newRow()); draw(); onChange(); } }),
    );
  };
  draw();
  return wrap;
}
