// Builder (#/builder): where the builder sets the tool up for a company before
// the team uses it. Today: the brand on every visual (settings.brand) and the
// list of tools. The tools moving over from Google Sheets (testimonial,
// memento, sticker builders) land here as they are built. [core]
//
// Only the director (or an owner, who works as the director) saves; others read.

import { api } from '../api.js';
import { roleOf } from '../roles.js';
import { el, card, field, input, button, toast } from '../ui.js';
import { ready, setBrand, useBrand, BRAND_DEFAULTS, TAGLINE } from '../cards/_kit.js';
import * as greeting from '../cards/festivalGreeting.js';
import * as statusRule from '../cards/statusRule.js';

export const route = '#/builder';
export const title = 'Builder';

const TOOLS = [
  { name: 'Visual cards', about: 'Status rules, quotes, hooks, thumbnails, carousel slides, LinkedIn images, festival greetings.', href: '#/visuals' },
  { name: 'Occasions', about: 'Festivals and dates, greetings, festival ideas, announcements.', href: '#/occasions' },
  { name: 'Video', about: 'Episodes and Shorts, from outline to the edit hand-off.', href: '#/video' },
];
const COMING = ['Testimonial builder', 'Memento builder', 'Sticker builder'];

function ensureCss() {
  if (document.getElementById('cards-css')) return;
  document.head.appendChild(el('link', { id: 'cards-css', rel: 'stylesheet', href: 'css/cards.css' }));
}

export async function render(container) {
  ensureCss();
  let settings = {};
  try { settings = await api.settings(); } catch (err) { container.appendChild(el('div', { class: 'banner banner-bad', text: err.message })); return; }
  const me = (api.user.get() || '').toLowerCase();
  let canEdit = false;
  try {
    const who = await api.get('/me');
    canEdit = who?.role === 'director' || Boolean(who?.owner);
  } catch {
    canEdit = roleOf((settings.users || []).find((u) => String(u.email).toLowerCase() === me)) === 'director';
  }

  const brand = { ...BRAND_DEFAULTS, tagline: TAGLINE, ...(settings.brand || {}) };
  await ready().catch(() => {});

  const preview = el('div', { class: 'bd-preview' });
  function drawPreview() {
    setBrand(brand);
    useBrand();
    const cards = [
      greeting.render(greeting.greetingFields({ shortName: 'Diwali', greetingText: 'Wishing you a joyous and prosperous Diwali.' }, 'square'), 'navy', { embedFonts: false, warnings: [] }),
      statusRule.render({ ...statusRule.meta.defaults }, 'light', { embedFonts: false, warnings: [] }),
    ];
    preview.replaceChildren(...cards.map((svg) => { const d = el('div', { class: 'bd-card' }); d.innerHTML = svg; return d; }));
  }

  const seg = (key, label, opts) => field({
    label,
    input: el('div', { class: 'cards-seg', role: 'group', 'aria-label': label }, opts.map(([v, t]) => el('button', {
      type: 'button', class: brand[key] === v ? 'active' : '', text: t, disabled: !canEdit,
      onClick: (e) => { brand[key] = v; [...e.currentTarget.parentNode.children].forEach((b) => b.classList.toggle('active', b === e.currentTarget)); drawPreview(); },
    }))),
  });
  const tagline = input({ value: brand.tagline || '', disabled: !canEdit, onInput: (e) => { brand.tagline = e.target.value; drawPreview(); } });

  const brandCard = card({
    title: 'Brand on visuals',
    eyebrow: 'Default for every card',
    body: el('div', { class: 'bd-brand' }, [
      el('div', { class: 'bd-controls' }, [
        seg('position', 'Position', [['bottom', 'Bottom'], ['top', 'Top']]),
        seg('logo', 'Logo', [['full', 'Full logo'], ['mark', 'VD mark']]),
        seg('taglineLayout', 'Tagline', [['line', 'One line'], ['stacked', 'Below logo']]),
        field({ label: 'Tagline text', input: tagline }),
        el('p', { class: 'note', text: 'Anyone can still change these for one card in Visuals.' }),
      ]),
      preview,
    ]),
    footer: canEdit ? [button({ kind: 'primary', label: 'Save', onClick: async () => {
      try {
        const fresh = await api.settings();
        settings = await api.put('/settings/settings', { ...fresh, brand: { position: brand.position, logo: brand.logo, taglineLayout: brand.taglineLayout, tagline: brand.tagline || '' } });
        toast('Brand saved', 'ok');
      } catch (err) { toast(err.message, 'bad'); }
    } })] : undefined,
  });

  const toolsCard = card({
    title: 'Tools',
    body: el('div', {}, [
      el('ul', { class: 'bd-tools' }, TOOLS.map((t) => el('li', {}, [el('a', { href: t.href, text: t.name }), el('span', { class: 'note', text: t.about })]))),
      el('p', { class: 'eyebrow', style: { marginTop: '14px' }, text: 'Moving over from Google Sheets' }),
      el('ul', { class: 'bd-tools' }, COMING.map((n) => el('li', {}, [el('span', { text: n }), el('span', { class: 'chip chip-muted', text: 'Coming' })]))),
    ]),
  });

  container.append(
    el('p', { class: 'note', style: { margin: '0 0 14px' }, text: canEdit ? 'Set the tool up for this company. The team uses what you set here.' : 'Set up by the director. Read-only for you.' }),
    brandCard, toolsCard,
  );
  drawPreview();
}
