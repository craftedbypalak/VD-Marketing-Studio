// Builder box: Brand and logo (settings.brand). Contract: docs/BUILDER.md sections 2 and 3.
// Holds: logo (full or VD mark), tagline text, tagline layout (one line or below the logo).
// The logo is always at the bottom, at a fixed place and size per format; the preview
// draws every template in both themes so the director sees it everywhere.
// Brand colours and fonts are fixed in app/js/cards/_kit.js and app/css/tokens.css, so
// they are not here.

import { el, card, button, input, bullets, toast } from '../../ui.js';
import { TEMPLATES, ready, defaultsFor } from '../../cards/index.js';
import { setBrand, useBrand, setCards, TAGLINE } from '../../cards/_kit.js';

const LOGO_LABEL = { full: 'full', mark: 'VD mark' };
const LAYOUT_LABEL = { line: 'one line', stacked: 'below logo' };

/** The stored brand, cleaned: what the cards read. */
export function brandOf(settings) {
  const b = settings?.brand || {};
  return {
    logo: b.logo === 'mark' ? 'mark' : 'full',
    taglineLayout: b.taglineLayout === 'stacked' ? 'stacked' : 'line',
    tagline: typeof b.tagline === 'string' && b.tagline.trim() ? b.tagline.trim() : '',
  };
}

/** A segmented choice: [[value, label], ...]. */
export function seg(label, options, value, onPick, disabled) {
  return el('div', { class: 'field' }, [
    el('span', { class: 'field-label', text: label }),
    el('div', { class: 'cards-seg', role: 'group', 'aria-label': label }, options.map(([v, t]) => el('button', {
      type: 'button', class: v === value ? 'active' : '', text: t, disabled, 'aria-pressed': v === value ? 'true' : 'false',
      onClick: () => onPick(v),
    }))),
  ]);
}

/** One small live preview of a template: an SVG at its own aspect ratio. */
export function thumb(t, { format, theme, fields: extra = {}, label } = {}) {
  const fmt = format || t.meta.formats[0];
  const fields = { ...defaultsFor(t), ...extra, format: fmt.id, imageData: '' };
  const box = el('div', { class: 'cards-bx-thumb', style: { aspectRatio: `${fmt.w} / ${fmt.h}` } });
  try { box.innerHTML = t.render(fields, theme, { embedFonts: false, warnings: [] }); } catch (err) { box.textContent = err.message; }
  return el('figure', { class: 'cards-bx-fig' }, [box, el('figcaption', { text: label || t.meta.label })]);
}

const THEMES_OF = (t) => (t.meta.id === 'carouselSlide' ? [['navy', { t: 'cover' }], ['light', { t: 'point' }]] : [['navy', {}], ['light', {}]]);

export const box = {
  id: 'brand', title: 'Brand and logo', icon: 'sparkle', order: 10,
  summary(ctx) {
    const b = brandOf(ctx.settings);
    return [
      `Logo: ${LOGO_LABEL[b.logo]}, fixed at the bottom`,
      `Tagline: ${b.tagline || TAGLINE}`,
      `Tagline layout: ${LAYOUT_LABEL[b.taglineLayout]}`,
    ];
  },
  async render(container, ctx) {
    const loading = el('div', { class: 'muted', text: 'Loading fonts and logos' });
    container.append(loading);
    try { await ready(); } catch (err) { loading.replaceWith(el('div', { class: 'banner banner-bad', text: `Fonts or logos did not load: ${err.message}` })); return; }
    loading.remove();

    const ro = !ctx.canEdit;
    let draft = brandOf(ctx.settings);
    let saved = JSON.stringify(draft);

    const logoRow = el('div');
    const layoutRow = el('div');
    const tagInput = input({ value: draft.tagline, placeholder: TAGLINE, disabled: ro, maxlength: 60, onInput: (e) => { draft.tagline = e.target.value; changed(); } });
    const resetBtn = !ro && button({ kind: 'ghost', small: true, label: 'Reset', title: 'Back to the house tagline', onClick: () => { draft.tagline = ''; tagInput.value = ''; changed(); } });
    const saveBtn = !ro && button({ kind: 'primary', label: 'Save', onClick: () => save() });
    const grid = el('div', { class: 'cards-bx-grid' });

    function drawChoices() {
      logoRow.replaceChildren(seg('Logo', [['full', 'Full logo'], ['mark', 'VD mark']], draft.logo, (v) => { draft.logo = v; drawChoices(); changed(); }, ro));
      layoutRow.replaceChildren(seg('Tagline layout', [['line', 'One line'], ['stacked', 'Below logo']], draft.taglineLayout, (v) => { draft.taglineLayout = v; drawChoices(); changed(); }, ro));
    }

    let timer;
    function drawPreview() {
      setCards(ctx.settings.cards);
      setBrand({ logo: draft.logo, taglineLayout: draft.taglineLayout, tagline: draft.tagline || null });
      useBrand();
      const figs = [];
      for (const t of TEMPLATES) {
        for (const f of t.meta.formats) {
          for (const [theme, extra] of THEMES_OF(t)) {
            const size = t.meta.formats.length > 1 ? ` ${f.w}x${f.h}` : '';
            figs.push(thumb(t, { format: f, theme, fields: extra, label: `${t.meta.label}${size}, ${theme}` }));
          }
        }
      }
      grid.replaceChildren(...figs);
      setBrand(ctx.settings.brand);   // leave the saved brand active for other pages
    }
    function changed() {
      if (saveBtn) saveBtn.disabled = JSON.stringify(draft) === saved;
      clearTimeout(timer);
      timer = setTimeout(drawPreview, 120);
    }

    async function save() {
      saveBtn.disabled = true;
      try {
        await ctx.saveSettings((doc) => {
          const b = { ...(doc.brand || {}) };
          delete b.position;   // the brand is always at the bottom
          b.logo = draft.logo;
          b.taglineLayout = draft.taglineLayout;
          b.tagline = draft.tagline.trim() || null;
          doc.brand = b;
        });
        draft = brandOf(ctx.settings);
        saved = JSON.stringify(draft);
        tagInput.value = draft.tagline;
        changed();
      } catch (err) { toast(err.message, 'bad'); saveBtn.disabled = false; }
    }

    drawChoices();
    container.append(
      card({
        title: 'Logo and tagline',
        actions: saveBtn ? [saveBtn] : undefined,
        body: [
          bullets(['Logo sits at the bottom of every card', 'Same place and size, however short the text', 'Official logo files, never redrawn'], { compact: true }),
          el('div', { class: 'cards-bx-controls' }, [
            logoRow,
            el('div', { class: 'field' }, [
              el('span', { class: 'field-label', text: 'Tagline' }),
              el('div', { class: 'bx-row' }, [tagInput, resetBtn]),
              el('span', { class: 'field-hint', text: 'Empty: the house tagline' }),
            ]),
            layoutRow,
          ]),
          el('div', { class: 'field-hint', text: 'Below logo falls back to one line where the margin is too small' }),
        ],
      }),
      card({ title: 'Every template', body: grid }),
    );
    if (saveBtn) saveBtn.disabled = true;
    drawPreview();
  },
};
