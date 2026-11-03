// Shared components (section 7). [core]
// Small functions that return DOM nodes. Nothing here talks to the server.
//
//   el(tag, attrs, children)     attrs: class, id, text, html, style{}, dataset{}, on<Event>, any attribute
//   icon(name)                   inline SVG from img/icons.svg
//   button({ kind, label, onClick, icon, type, disabled, small, block })
//   field({ label, input, hint, error })
//   input(attrs), textarea({ counter, ...attrs }), select({ options, value, onChange })
//   checkbox({ label, checked, onChange }), switchInput({ label, checked, onChange })
//   chip({ label, tone, icon }), statusPill(status)
//   card({ title, eyebrow, body, footer, actions })
//   table({ columns, rows, onRowClick, empty, rowKey })
//   dialog({ title, body, actions }) -> { close, node }
//   confirm({ title, message, confirmLabel, danger }) -> Promise<boolean>
//   toast(message, tone)
//   tabs({ items, active, onChange }) -> node with .select(id)
//   empty({ title, hint, action })
//   listRow({ title, sub, aside, href, onClick, date })
//   preview.instagram(piece) | preview.linkedin(piece) | preview.status(piece) | preview.youtube(piece)
//   fmt.date, fmt.time, fmt.dateTime, fmt.n

const SVG_NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class' || k === 'className') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) node.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required' || k === 'readOnly') node[k] = Boolean(v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  if (children === undefined || children === null || children === false) return node;
  if (Array.isArray(children)) { for (const c of children) append(node, c); return node; }
  if (children instanceof Node) node.appendChild(children);
  else node.appendChild(document.createTextNode(String(children)));
  return node;
}

export function icon(name, cls = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `img/icons.svg#i-${name}`);
  svg.appendChild(use);
  return svg;
}

// ------------------------------------------------------------- buttons

export function button({ kind = 'secondary', label, onClick, icon: iconName, type = 'button', disabled = false, small = false, block = false, title, href } = {}) {
  const cls = ['btn', `btn-${kind}`, small && 'btn-sm', block && 'btn-block'].filter(Boolean).join(' ');
  const children = [iconName && icon(iconName), label];
  if (href) return el('a', { class: cls, href, title, 'aria-disabled': disabled || undefined }, children);
  return el('button', { class: cls, type, disabled, onClick, title }, children);
}

// --------------------------------------------------------------- forms

export function field({ label, input: control, hint, error, inline = false } = {}) {
  const wrap = el('label', { class: inline ? 'field field-inline' : 'field' });
  if (label) wrap.appendChild(el('span', { class: 'field-label', text: label }));
  if (control) wrap.appendChild(control);
  if (hint) wrap.appendChild(el('span', { class: 'field-hint', text: hint }));
  if (error) wrap.appendChild(el('span', { class: 'field-error', text: error }));
  return wrap;
}

export function input(attrs = {}) {
  const { class: cls, onInput, onChange, ...rest } = attrs;
  return el('input', { type: 'text', class: ['input', cls].filter(Boolean).join(' '), onInput, onChange, ...rest });
}

export function textarea({ counter, class: cls, onInput, value = '', ...rest } = {}) {
  const ta = el('textarea', { class: ['textarea', cls].filter(Boolean).join(' '), value, ...rest });
  if (!counter) { if (onInput) ta.addEventListener('input', onInput); return ta; }
  const wrap = el('div', { class: 'textarea-wrap' });
  const count = el('span', { class: 'counter' });
  const update = () => {
    const n = ta.value.length;
    count.textContent = `${n} / ${counter}`;
    count.classList.toggle('over', n > counter);
  };
  ta.addEventListener('input', (e) => { update(); if (onInput) onInput(e); });
  update();
  wrap.append(ta, count);
  wrap.textarea = ta;
  Object.defineProperty(wrap, 'value', { get: () => ta.value, set: (v) => { ta.value = v; update(); } });
  return wrap;
}

export function select({ options = [], value, onChange, class: cls, placeholder, ...rest } = {}) {
  const s = el('select', { class: ['select', cls].filter(Boolean).join(' '), onChange, ...rest });
  if (placeholder) s.appendChild(el('option', { value: '', text: placeholder }));
  for (const o of options) {
    const opt = typeof o === 'string' ? { value: o, label: o } : o;
    s.appendChild(el('option', { value: opt.value, text: opt.label ?? opt.value, disabled: opt.disabled }));
  }
  if (value !== undefined && value !== null) s.value = String(value);
  return s;
}

export function checkbox({ label, checked = false, onChange, ...rest } = {}) {
  const box = el('input', { type: 'checkbox', checked, onChange, ...rest });
  return el('label', { class: 'check' }, [box, el('span', { text: label })]);
}

export function switchInput({ label, checked = false, onChange, ...rest } = {}) {
  const box = el('input', { type: 'checkbox', checked, onChange, ...rest });
  return el('label', { class: 'switch' }, [box, el('span', { class: 'switch-track' }), label && el('span', { text: label })]);
}

// --------------------------------------------------------------- chips

export function chip({ label, tone = 'default', icon: iconName } = {}) {
  return el('span', { class: `chip${tone && tone !== 'default' ? ` chip-${tone}` : ''}` }, [iconName && icon(iconName), label]);
}

const STATUS_TONE = {
  idea: 'muted', draft: 'neutral', 'in-review': 'warn', 'director-review': 'navy', 'changes-requested': 'bad', approved: 'ok',
  scheduled: 'navy', posted: 'ok', measured: 'ok', retired: 'muted',
  open: 'neutral', filled: 'ok', dark: 'bad', 'greeting-only': 'warn', derived: 'muted', optional: 'muted',
  outline: 'neutral', script: 'neutral', scenes: 'neutral', footage: 'warn', voice: 'warn', 'own-clips': 'warn', edit: 'warn', done: 'ok',
  active: 'ok', paused: 'warn', dropped: 'muted', planned: 'neutral', sent: 'ok', replied: 'ok', 'no-reply': 'warn', met: 'ok', 'call-booked': 'ok', declined: 'bad',
};
const STATUS_LABEL = {
  'in-review': 'In review', 'director-review': 'With the director', 'changes-requested': 'Changes requested', 'greeting-only': 'Greeting only', 'own-clips': 'Own clips',
  'no-reply': 'No reply', 'call-booked': 'Call booked',
};

export function statusPill(status) {
  const s = String(status || 'draft');
  const label = STATUS_LABEL[s] || (s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' '));
  return el('span', { class: `pill pill-${STATUS_TONE[s] || 'neutral'}`, text: label });
}

// --------------------------------------------------------------- cards

export function card({ title, eyebrow, body, footer, actions, flat = false, class: cls } = {}) {
  const c = el('section', { class: ['card', flat && 'card-flat', cls].filter(Boolean).join(' ') });
  if (title || actions || eyebrow) {
    const head = el('div', { class: 'card-head' });
    const t = el('div');
    if (eyebrow) t.appendChild(el('span', { class: 'eyebrow', text: eyebrow }));
    if (title) t.appendChild(typeof title === 'string' ? el('h2', { text: title }) : title);
    head.appendChild(t);
    if (actions) head.appendChild(el('div', { class: 'row' }, actions));
    c.appendChild(head);
  }
  if (body !== undefined) c.appendChild(el('div', { class: 'card-body' }, body));
  if (footer) c.appendChild(el('div', { class: 'card-foot' }, footer));
  return c;
}

// -------------------------------------------------------------- tables

export function table({ columns = [], rows = [], onRowClick, empty: emptyText = 'Nothing here yet', rowKey = 'id' } = {}) {
  const t = el('table', { class: 'table' });
  const thead = el('thead', {}, el('tr', {}, columns.map((c) => el('th', { text: c.label ?? c.key, style: c.width ? { width: c.width } : undefined }))));
  const tbody = el('tbody');
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: columns.length, class: 'table-empty', text: emptyText })));
  }
  for (const row of rows) {
    const tr = el('tr', { class: onRowClick ? 'clickable' : undefined, dataset: { key: row?.[rowKey] ?? '' } });
    for (const c of columns) {
      const value = typeof c.render === 'function' ? c.render(row) : row?.[c.key];
      const td = el('td', { class: [c.mono && 'mono', c.num && 'num', c.class].filter(Boolean).join(' ') || undefined });
      append(td, value === undefined || value === null ? '' : value);
      tr.appendChild(td);
    }
    if (onRowClick) tr.addEventListener('click', (e) => { if (!e.target.closest('button, a, input, select, textarea')) onRowClick(row, e); });
    tbody.appendChild(tr);
  }
  t.append(thead, tbody);
  return el('div', { class: 'table-wrap' }, t);
}

// -------------------------------------------------------------- dialog

export function dialog({ title, body, actions = [], onClose, wide = false } = {}) {
  const host = document.getElementById('dialog-host') || document.body;
  const back = el('div', { class: 'dialog-back', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
  const box = el('div', { class: 'dialog', style: wide ? { width: 'min(900px, 100%)' } : undefined });
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  box.appendChild(el('div', { class: 'dialog-head' }, [
    el('h2', { text: title || '' }),
    el('button', { class: 'dialog-close', type: 'button', 'aria-label': 'Close', onClick: close }, icon('close')),
  ]));
  box.appendChild(el('div', { class: 'dialog-body' }, body));
  if (actions.length) box.appendChild(el('div', { class: 'dialog-foot' }, actions));
  back.appendChild(box);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  host.appendChild(back);
  const first = box.querySelector('input, textarea, select, button.btn-primary, button');
  if (first) first.focus();
  return { close, node: back };
}

export function confirm({ title = 'Please confirm', message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    let d;
    d = dialog({
      title,
      body: el('p', { text: message || '' }),
      actions: [
        button({ kind: 'secondary', label: cancelLabel, onClick: () => { resolve(false); d.close(); } }),
        button({ kind: danger ? 'danger' : 'primary', label: confirmLabel, onClick: () => { resolve(true); d.close(); } }),
      ],
      onClose: () => resolve(false),
    });
  });
}

// --------------------------------------------------------------- toast

export function toast(message, tone = 'info', { ms = 3200 } = {}) {
  const host = document.getElementById('toasts') || document.body;
  const iconName = { ok: 'check', warn: 'warn', bad: 'warn', info: 'sparkle' }[tone] || 'sparkle';
  const t = el('div', { class: `toast toast-${tone}`, role: 'status' }, [icon(iconName), el('span', { text: message })]);
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; setTimeout(() => t.remove(), 260); }, ms);
  return t;
}

// ---------------------------------------------------------------- tabs

export function tabs({ items = [], active, onChange } = {}) {
  const bar = el('div', { class: 'tabs', role: 'tablist' });
  const buttons = new Map();
  const selectTab = (id, fire = true) => {
    for (const [k, b] of buttons) b.classList.toggle('active', k === id);
    bar.dataset.active = id;
    if (fire && onChange) onChange(id);
  };
  for (const it of items) {
    const b = el('button', { class: 'tab', type: 'button', role: 'tab', text: it.label, onClick: () => selectTab(it.id) });
    buttons.set(it.id, b);
    bar.appendChild(b);
  }
  selectTab(active ?? items[0]?.id, false);
  bar.select = selectTab;
  return bar;
}

// --------------------------------------------------------------- empty

export function empty({ title = 'Nothing here yet', hint, action } = {}) {
  return el('div', { class: 'empty' }, [el('h3', { text: title }), hint && el('p', { text: hint }), action]);
}

export function listRow({ title, sub, aside, href, onClick, date } = {}) {
  const tag = href ? 'a' : 'div';
  const row = el(tag, { class: 'list-row', href, onClick });
  if (date) row.appendChild(el('span', { class: 'list-date', text: date }));
  row.appendChild(el('div', { class: 'list-main' }, [
    el('div', { class: 'list-title', text: title || '' }),
    sub && el('div', { class: 'list-sub', text: sub }),
  ]));
  if (aside) row.appendChild(el('div', { class: 'list-aside' }, aside));
  return row;
}

// ------------------------------------------------------------- formats

export const fmt = {
  date(ymd) {
    if (!ymd) return '';
    const d = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(d.getTime())) return String(ymd);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  },
  weekday(ymd) {
    const d = new Date(`${ymd}T00:00:00`);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { weekday: 'short' });
  },
  time(hhmm) { return hhmm || ''; },
  dateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  },
  n(v) { return v === undefined || v === null ? '' : new Intl.NumberFormat('en-IN').format(v); },
};

// ------------------------------------------------------------ previews
// Each takes a piece (4.1) and renders it as the account would show it.

const MARK = 'img/vd-mark-reverse.svg';
const r = (piece, key) => piece?.renditions?.[key] || null;
const firstAsset = (piece, kinds) => (piece?.assets || []).find((a) => kinds.includes(a.kind) && a.path) || null;
const fallbackText = (piece) => {
  const p = piece?.pis || {};
  const sol = Array.isArray(p.solution) ? p.solution.join(' ') : (p.solution || '');
  return [piece?.hook, p.problem, p.impact, sol, p.close].filter(Boolean).join('\n\n');
};
function mediaBox(piece, ratio, text) {
  const asset = firstAsset(piece, ['cover', 'image', 'photo', 'video']);
  const box = el('div', { class: `preview-media ${ratio}` });
  if (asset) {
    if (asset.kind === 'video') box.appendChild(el('video', { src: asset.path, muted: true, playsinline: true, preload: 'metadata' }));
    else box.appendChild(el('img', { src: asset.path, alt: asset.label || '' }));
  } else {
    box.appendChild(el('span', { text: text || piece?.hook || 'Hook' }));
    if (['broll', 'reel-animated', 'episode', 'youtube-short', 'youtube-long'].includes(piece?.type)) {
      box.appendChild(el('span', { class: 'preview-note', text: 'Video not filmed yet; the script is below.' }));
    }
  }
  box.appendChild(el('img', { class: 'mark', src: MARK, alt: '' }));
  return box;
}
function avatar() { return el('div', { class: 'preview-avatar' }, el('img', { src: MARK, alt: '' })); }
function head(name, sub) {
  return el('div', { class: 'preview-head' }, [avatar(), el('div', {}, [el('div', { class: 'preview-name', text: name }), sub && el('div', { class: 'preview-sub', text: sub })])]);
}
function hashtagsBlock(tags) {
  const list = (tags || []).map((t) => String(t).trim()).filter(Boolean).map((t) => (t.startsWith('#') ? t : `#${t}`));
  return list.length ? el('span', { class: 'preview-hashtags', text: list.join(' ') }) : null;
}

export const preview = {
  /** Instagram feed card: caption in full, hashtags as the last block. */
  instagram(piece = {}) {
    const ig = r(piece, 'ig');
    const box = el('div', { class: 'preview preview-ig' });
    box.appendChild(head('venturedrafters', 'Indore'));
    box.appendChild(mediaBox(piece, 'r45'));
    const caption = ig?.caption ?? fallbackText(piece);
    const body = el('div', { class: 'preview-body' });
    body.appendChild(el('b', { text: 'venturedrafters ' }));
    body.appendChild(document.createTextNode(caption || ''));
    const tags = hashtagsBlock(ig?.hashtags);
    if (tags) body.appendChild(tags);
    box.appendChild(body);
    if (!ig?.caption) box.appendChild(el('div', { class: 'preview-warn', text: 'No Instagram caption yet; showing the piece text.' }));
    if (ig?.firstComment) box.appendChild(el('div', { class: 'preview-meta', text: `First comment: ${ig.firstComment}` }));
    const count = (ig?.hashtags || []).length;
    box.appendChild(el('div', { class: 'preview-meta' }, [el('span', { class: 'mono', text: `${(caption || '').length}` }), ` characters, `, el('span', { class: 'mono', text: `${count}` }), ` hashtags`]));
    return box;
  },

  /** LinkedIn post from Palak's profile: cut at 210 characters with a see-more marker. */
  linkedin(piece = {}, { cut = 210 } = {}) {
    const li = r(piece, 'li');
    const text = li?.text ?? fallbackText(piece);
    const box = el('div', { class: 'preview preview-li' });
    box.appendChild(head('Palak Gupta', 'Founder, Venture Drafters'));
    const body = el('div', { class: 'preview-body' });
    if (text.length > cut) {
      body.appendChild(document.createTextNode(text.slice(0, cut)));
      const more = el('span', { class: 'preview-more' }, [el('span', { class: 'preview-cut', text: '… see more' })]);
      more.addEventListener('click', () => box.classList.add('open'));
      body.appendChild(more);
      body.appendChild(el('span', { class: 'preview-rest', text: text.slice(cut) }));
    } else body.appendChild(document.createTextNode(text));
    box.appendChild(body);
    const photo = firstAsset(piece, ['photo', 'image', 'cover', 'pdf', 'slides']);
    box.appendChild(el('div', { class: 'preview-photo' }, photo && /\.(png|jpe?g|webp|gif|svg)$/i.test(photo.path)
      ? el('img', { src: photo.path, alt: photo.label || '' })
      : el('span', { text: photo ? (photo.label || photo.kind) : 'One real photo goes here' })));
    if (!li?.text) box.appendChild(el('div', { class: 'preview-warn', text: 'No LinkedIn text yet; showing the piece text.' }));
    if (li?.firstComment) box.appendChild(el('div', { class: 'preview-meta', text: `First comment: ${li.firstComment}` }));
    const firstLine = text.split('\n')[0] || '';
    box.appendChild(el('div', { class: 'preview-meta' }, [el('span', { class: 'mono', text: `${text.length}` }), ' characters; the first ', el('span', { class: 'mono', text: String(cut) }), ' carry the hook', firstLine.length > cut ? '; the first line runs past the cut' : '']));
    return box;
  },

  /** WhatsApp Status card: one line on navy, words in *stars* in yellow. */
  status(piece = {}) {
    const st = r(piece, 'waStatus');
    const text = st?.text ?? (piece.hook || '');
    const box = el('div', { class: 'preview preview-status' });
    const screen = el('div', { class: 'preview-status-screen' });
    screen.appendChild(el('div', { class: 'preview-status-bar' }));
    screen.appendChild(el('div', { class: 'preview-sub', text: 'Palak Gupta · Status', style: { color: 'rgba(255,255,255,.75)', marginBottom: '8px' } }));
    const t = el('div', { class: 'preview-status-text' });
    // *starred* words are the kit's yellow highlight rule.
    const parts = String(text).split(/(\*[^*]+\*)/g);
    for (const p of parts) {
      if (/^\*[^*]+\*$/.test(p)) t.appendChild(el('em', { text: p.slice(1, -1) }));
      else t.appendChild(document.createTextNode(p));
    }
    screen.appendChild(t);
    screen.appendChild(el('div', { class: 'preview-status-foot' }, [el('img', { src: MARK, alt: '' }), el('span', { text: 'See everything. Chase nothing.' })]));
    box.appendChild(screen);
    if (!st?.text) box.appendChild(el('div', { class: 'preview-warn', text: 'No Status text yet; showing the hook.' }));
    const lines = String(text).trim().split('\n').filter(Boolean).length;
    box.appendChild(el('div', { class: 'preview-meta' }, [el('span', { class: 'mono', text: `${String(text).length}` }), ' characters, ', el('span', { class: 'mono', text: `${lines}` }), lines === 1 ? ' line' : ' lines']));
    return box;
  },

  /** YouTube: thumbnail, title, channel, description cut with show more, tags. */
  youtube(piece = {}, { cut = 160 } = {}) {
    const yt = r(piece, 'yt');
    const title = yt?.title ?? piece.hook ?? '';
    const desc = yt?.description ?? fallbackText(piece);
    const box = el('div', { class: 'preview preview-yt' });
    box.appendChild(mediaBox(piece, 'r169', title));
    box.appendChild(el('div', { class: 'preview-yt-title', text: title }));
    box.appendChild(el('div', { class: 'preview-sub', text: 'Venture Drafters', style: { padding: '0 12px' } }));
    const d = el('div', { class: 'preview-yt-desc' });
    if (desc.length > cut) {
      d.appendChild(document.createTextNode(desc.slice(0, cut)));
      const more = el('span', { class: 'preview-more', text: ' …Show more' });
      const rest = el('span', { text: desc.slice(cut), style: { display: 'none' } });
      more.addEventListener('click', () => { rest.style.display = 'inline'; more.remove(); });
      d.append(more, rest);
    } else d.textContent = desc;
    box.appendChild(d);
    if (yt?.tags?.length) box.appendChild(el('div', { class: 'preview-yt-tags chips' }, yt.tags.map((t) => chip({ label: t, tone: 'muted' }))));
    if (!yt?.title) box.appendChild(el('div', { class: 'preview-warn', text: 'No YouTube title yet; showing the hook.' }));
    box.appendChild(el('div', { class: 'preview-meta' }, [el('span', { class: 'mono', text: `${title.length}` }), ' characters in the title (100 at most)']));
    return box;
  },
};

export const ui = { el, append, icon, button, field, input, textarea, select, checkbox, switchInput, chip, statusPill, card, table, dialog, confirm, toast, tabs, empty, listRow, fmt, preview };
export default ui;
