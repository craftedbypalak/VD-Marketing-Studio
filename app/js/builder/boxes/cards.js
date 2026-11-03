// Builder box: Card templates (settings.cards). Contract: docs/BUILDER.md section 2.
// Per template: on or off, default theme, default footer line; and the fixed words some
// templates draw ("SWIPE", "A venture by VSP", "Warm wishes"). Stored as
//   settings.cards = { off: [ids], theme: { id: 'navy'|'light'|'auto' }, footer: { id: text },
//                      text: { swipe, ventureLine, greetingEyebrow } }
// Anything empty falls back to the template's own value (Reset clears it).
// Off templates leave Visuals' template picker.

import { el, card, button, input, select, checkbox, bullets, toast } from '../../ui.js';
import { TEMPLATES, ready } from '../../cards/index.js';
import { setBrand, setCards, CARD_TEXT, TAGLINE } from '../../cards/_kit.js';
import { thumb } from './brand.js';

const THEME_LABEL = { navy: 'Navy', light: 'Light', auto: 'Kit pattern' };

/** The words each template draws, by key into settings.cards.text. */
const WORDS = {
  carouselSlide: [['swipe', 'Swipe cue (cover)', { t: 'cover' }], ['ventureLine', 'Venture line (call to action)', { t: 'cta' }]],
  festivalGreeting: [['greetingEyebrow', 'Eyebrow']],
};

/** The stored card settings, cleaned. */
export function cardsOf(settings) {
  const c = settings?.cards || {};
  const map = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => typeof v === 'string' && v.trim()));
  return {
    off: Array.isArray(c.off) ? c.off.filter((id) => TEMPLATES.some((t) => t.meta.id === id)) : [],
    theme: map(c.theme), footer: map(c.footer), text: map(c.text),
  };
}

const templateFooter = (t) => (t.meta.defaults && t.meta.defaults.footer != null ? t.meta.defaults.footer : TAGLINE);

export const box = {
  id: 'cards', title: 'Card templates', icon: 'pictures', order: 20,
  summary(ctx) {
    const c = cardsOf(ctx.settings);
    const on = TEMPLATES.length - c.off.length;
    const off = TEMPLATES.filter((t) => c.off.includes(t.meta.id)).map((t) => t.meta.label);
    const lines = [`${on} of ${TEMPLATES.length} templates on`];
    if (off.length) lines.push(`Off: ${off.join(', ')}`);
    const own = TEMPLATES.filter((t) => c.theme[t.meta.id] || c.footer[t.meta.id]).map((t) => t.meta.label);
    lines.push(own.length ? `Own defaults: ${own.join(', ')}` : 'Themes and footers: as designed');
    lines.push(`Words: ${Object.keys(CARD_TEXT).map((k) => c.text[k] || CARD_TEXT[k]).join(', ')}`);
    return lines;
  },
  async render(container, ctx) {
    const loading = el('div', { class: 'muted', text: 'Loading fonts and logos' });
    container.append(loading);
    try { await ready(); } catch (err) { loading.replaceWith(el('div', { class: 'banner banner-bad', text: `Fonts or logos did not load: ${err.message}` })); return; }
    loading.remove();

    const ro = !ctx.canEdit;
    let draft = cardsOf(ctx.settings);
    let saved = JSON.stringify(draft);
    const saveBtn = !ro && button({ kind: 'primary', label: 'Save', onClick: () => save() });
    const saveBtn2 = !ro && button({ kind: 'primary', label: 'Save', onClick: () => save() });
    const setSave = (disabled) => { if (saveBtn) { saveBtn.disabled = disabled; saveBtn2.disabled = disabled; } };
    const previews = new Map();   // template id -> preview holder

    const isDirty = () => JSON.stringify(draft) !== saved;
    function changed(id) {
      setSave(!isDirty());
      clearTimeout(changed.t);
      changed.t = setTimeout(() => (id ? drawPreview(id) : TEMPLATES.forEach((t) => drawPreview(t.meta.id))), 120);
    }

    function drawPreview(id) {
      const holder = previews.get(id);
      if (!holder) return;
      const t = TEMPLATES.find((x) => x.meta.id === id);
      setBrand(ctx.settings.brand);
      setCards(draft);
      const theme = draft.theme[id] || t.meta.defaultTheme;
      const figs = (WORDS[id] && id === 'carouselSlide')
        ? WORDS[id].map(([, label, extra]) => thumb(t, { theme, fields: extra, label: label.replace(/^.*\((.*)\)$/, '$1') }))
        : [thumb(t, { theme, label: THEME_LABEL[theme] || theme })];
      holder.replaceChildren(...figs);
      setCards(ctx.settings.cards);   // leave the saved settings active for other pages
    }

    /** A text input that falls back to `fallback` when empty, with Reset. */
    function textWithReset(obj, key, fallback, id) {
      const inp = input({ value: obj[key] || '', placeholder: fallback || 'None', disabled: ro, maxlength: 80, onInput: (e) => {
        if (e.target.value.trim()) obj[key] = e.target.value; else delete obj[key];
        changed(id);
      } });
      return el('div', { class: 'bx-row' }, [inp, !ro && button({ kind: 'ghost', small: true, label: 'Reset', title: 'Back to the default', onClick: () => { delete obj[key]; inp.value = ''; changed(id); } })]);
    }

    function templateCard(t) {
      const id = t.meta.id;
      const holder = el('div', { class: 'cards-bx-one' });
      previews.set(id, holder);
      const themes = t.meta.themes || ['navy', 'light'];
      const onBox = checkbox({ label: 'On', checked: !draft.off.includes(id), disabled: ro, onChange: (e) => {
        draft.off = e.target.checked ? draft.off.filter((x) => x !== id) : [...draft.off, id];
        c.classList.toggle('cards-bx-off', !e.target.checked);
        changed(id);
      } });
      const themeSel = select({
        options: themes.map((v) => ({ value: v, label: `${THEME_LABEL[v] || v}${v === t.meta.defaultTheme ? ' (as designed)' : ''}` })),
        value: draft.theme[id] || t.meta.defaultTheme, disabled: ro,
        onChange: (e) => { if (e.target.value === t.meta.defaultTheme) delete draft.theme[id]; else draft.theme[id] = e.target.value; changed(id); },
      });
      const fields = [
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Default theme' }), themeSel]),
      ];
      if (t.meta.defaults && 'footer' in t.meta.defaults) {
        const base = templateFooter(t);
        fields.push(el('div', { class: 'field' }, [
          el('span', { class: 'field-label', text: 'Default footer line' }),
          textWithReset(draft.footer, id, base || 'None', id),
          el('span', { class: 'field-hint', text: base === TAGLINE ? 'Empty: the tagline from Brand and logo' : 'Empty: no footer line' }),
        ]));
      }
      for (const [key, label] of WORDS[id] || []) {
        fields.push(el('div', { class: 'field' }, [el('span', { class: 'field-label', text: label }), textWithReset(draft.text, key, CARD_TEXT[key], id)]));
      }
      const sizes = t.meta.formats.map((f) => `${f.w} x ${f.h}`).join(', ');
      const c = card({
        title: t.meta.label, eyebrow: sizes, class: `cards-bx-card${draft.off.includes(id) ? ' cards-bx-off' : ''}`,
        actions: [onBox],
        body: el('div', { class: 'cards-bx-tpl' }, [el('div', { class: 'cards-bx-fields' }, fields), holder]),
      });
      return c;
    }

    async function save() {
      setSave(true);
      try {
        await ctx.saveSettings((doc) => {
          const out = { off: [...draft.off], theme: { ...draft.theme }, footer: {}, text: {} };
          for (const [k, v] of Object.entries(draft.footer)) if (v.trim()) out.footer[k] = v.trim();
          for (const [k, v] of Object.entries(draft.text)) if (v.trim()) out.text[k] = v.trim();
          doc.cards = out;
        });
        // Keep the same draft objects (the inputs hold them); only trim what was saved.
        for (const o of [draft.footer, draft.text]) for (const k of Object.keys(o)) o[k] = o[k].trim();
        saved = JSON.stringify(draft);
        setCards(ctx.settings.cards);
        setSave(true);
      } catch (err) { toast(err.message, 'bad'); setSave(false); }
    }

    if (draft.off.length === TEMPLATES.length) draft.off = [];
    container.append(
      card({
        title: 'Templates',
        actions: saveBtn ? [saveBtn] : undefined,
        body: bullets([
          'Off: gone from the Visuals template picker',
          'Theme and footer line: the start for a new card',
          'Reset: back to the template as designed',
        ], { compact: true }),
      }),
      ...TEMPLATES.map(templateCard),
      saveBtn2 ? el('div', { class: 'cards-bx-save' }, [saveBtn2]) : null,
    );
    if (saveBtn) { saveBtn.disabled = true; saveBtn2.disabled = true; }
    TEMPLATES.forEach((t) => drawPreview(t.meta.id));
  },
};
