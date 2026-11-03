// Builder (#/builder, #/builder/:box): set the tool up for a company before the team
// uses it. Only editable things live here, as a grid of tool boxes; each box opens its
// own editor at #/builder/<id>. Boxes: app/js/builder/boxes/*.js. Contract: docs/BUILDER.md.
//
// Only the director (or an owner, who works as the director) saves; others read.
// The director may hide boxes they do not use (settings.builder.hidden).

import { el, card, button, icon, bullets, toast, checkbox, dialog } from '../ui.js';
import { BOXES } from '../builder/index.js';
import { makeCtx } from '../builder/kit.js';

export const route = ['#/builder', '#/builder/:box'];
export const title = (params) => (params && params.box ? (BOXES.find((b) => b.id === params.box)?.title || 'Builder') : 'Builder');

function ensureCss() {
  if (!document.getElementById('cards-css')) document.head.appendChild(el('link', { id: 'cards-css', rel: 'stylesheet', href: 'css/cards.css' }));
  if (!document.getElementById('builder-css')) document.head.appendChild(el('link', { id: 'builder-css', rel: 'stylesheet', href: 'css/builder.css' }));
}

export async function render(container, params = {}) {
  ensureCss();
  let ctx;
  try { ctx = await makeCtx(); } catch (err) { container.appendChild(el('div', { class: 'banner banner-bad', text: err.message })); return; }

  if (params.box) {
    const box = BOXES.find((b) => b.id === params.box);
    if (!box) { location.hash = '#/builder'; return; }
    const body = el('div', { class: 'bx-body' });
    container.append(
      el('div', { class: 'bx-head' }, [
        button({ kind: 'ghost', small: true, icon: 'back', label: 'All tools', href: '#/builder' }),
        !ctx.canEdit && el('span', { class: 'chip chip-muted', text: 'Read-only' }),
      ]),
      body,
    );
    try { await box.render(body, ctx); } catch (err) { body.appendChild(el('div', { class: 'banner banner-bad', text: err.message })); }
    return;
  }

  const hidden = new Set(ctx.settings?.builder?.hidden || []);
  const grid = el('div', { class: 'bx-grid' });
  for (const box of BOXES.filter((b) => !hidden.has(b.id))) {
    let lines = [];
    try { lines = (box.summary(ctx) || []).slice(0, 4); } catch { lines = []; }
    grid.appendChild(el('a', { class: 'bx-tile', href: `#/builder/${box.id}` }, [
      el('div', { class: 'bx-tile-h' }, [icon(box.icon), el('span', { text: box.title })]),
      bullets(lines, { compact: true }),
      el('span', { class: 'bx-tile-go', text: ctx.canEdit ? 'Edit' : 'View' }),
    ]));
  }

  const manage = ctx.canEdit && button({ kind: 'secondary', small: true, label: 'Show or hide tools', onClick: () => {
    const next = new Set(hidden);
    let d;
    d = dialog({
      title: 'Tools on this page',
      body: el('div', {}, BOXES.map((b) => checkbox({ label: b.title, checked: !hidden.has(b.id), onChange: (e) => { if (e.target.checked) next.delete(b.id); else next.add(b.id); } }))),
      actions: [button({ kind: 'primary', label: 'Save', onClick: async () => {
        try { await ctx.saveSettings((doc) => { doc.builder = { ...(doc.builder || {}), hidden: [...next] }; }); d.close(); render(container.replaceChildren() || container, params); } catch (err) { toast(err.message, 'bad'); }
      } })],
    });
  } });

  container.append(
    el('div', { class: 'bx-intro' }, [
      bullets(ctx.canEdit
        ? ['Set Studio up for this company', 'Open a tool to change it', 'The team works with what you save']
        : ['Set up by the director', 'Read-only for you'], { compact: true }),
      manage,
    ]),
    grid,
  );
}
