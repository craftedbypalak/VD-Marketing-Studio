// Visuals (named Pictures until 30 October 2026): the brand card maker and the illustration panel. [pictures]
//
// Cards are SVG strings built by app/js/cards/*.js. The preview is the SVG
// itself; "Export PNG" draws the same SVG (with the fonts embedded) onto a
// canvas at full size and posts the PNG to /api/images/card. Illustrations go
// through /api/images/illustration, which needs an image provider and a key.
//
// Open with #/visuals?piece=<id> to fill from a piece ("Use piece text"); #/pictures redirects here.

import { api } from '../api.js';
import { el, card, field, input, textarea, select, button, toast, chip, confirm, fmt, bullets } from '../ui.js';
import { byId, ready, brandIssues, activeTemplates, defaultsFor, isTemplateOn } from '../cards/index.js';
import { setBrand, useBrand, setCards, themeFor } from '../cards/_kit.js';
import { svgToPng } from '../cards/png.js';

export const route = '#/visuals';
export const title = 'Visuals';

const DEFAULT_PREFIX =
  'Flat vector illustration, navy #0a3050 with a small green #8ace8a accent on white or navy, soft corners, no gradients, no text, ' +
  'no faces drawn as real people, never a screen, sheet or phone drawn as a real product screenshot';

const LOGIN_HINT = 'Run claude and /login in a terminal, then try again.';

const THEME_LABEL = { navy: 'Navy', light: 'Light', auto: 'Kit pattern' };

function injectStyles() {
  if (document.getElementById('cards-css')) return;
  const link = el('link', { id: 'cards-css', rel: 'stylesheet', href: new URL('../../css/cards.css', import.meta.url).href });
  document.head.appendChild(link);
}

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/** A picture on the server as a data URL, scaled down so the SVG stays light. */
async function toDataUrl(path, maxEdge = 1400) {
  const res = await fetch(path);
  if (!res.ok) throw new Error('The picture could not be loaded');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

const pieceLabel = (p) => `${p.hook || p.id}  (${p.type || 'piece'})`;

/** The template that fits a piece type, so arriving from a piece opens on the right card. */
const TEMPLATE_BY_TYPE = {
  broll: 'hook', 'reel-animated': 'hook', episode: 'hook', 'youtube-short': 'hook', 'image-post': 'hook',
  carousel: 'carouselSlide', 'linkedin-carousel': 'carouselSlide', 'status-rule': 'statusRule', greeting: 'festivalGreeting',
  'youtube-long': 'thumbnail', 'youtube-short': 'thumbnail', 'linkedin-text': 'linkedinImage', 'field-story': 'linkedinImage', announcement: 'linkedinImage',
};

export async function render(container, params) {
  injectStyles();
  const status = el('div', { class: 'muted', text: 'Loading fonts and logos' });
  container.appendChild(status);

  let settings = {};
  let pieces = [];
  try {
    await ready();
  } catch (err) {
    status.replaceWith(el('div', { class: 'banner banner-bad', text: `The card maker could not load its fonts or logos: ${err.message}` }));
    return;
  }
  try { settings = await api.settings(); } catch { settings = {}; }
  try { pieces = await api.get('/pieces'); } catch { pieces = []; }
  status.remove();

  const prefix = (settings.illustrationPrefix || '').trim() || DEFAULT_PREFIX;
  const provider = settings.imageProvider || 'none';
  setBrand(settings.brand);
  setCards(settings.cards);

  // ------------------------------------------------------------- state
  const first = activeTemplates()[0];
  const state = {
    template: first.meta.id,
    theme: themeFor(first.meta),
    themeTouched: false,
    format: first.meta.formats[0].id,
    fields: defaultsFor(first),
    pieceId: params.query?.piece || '',
    slide: 0,
    imagePath: '',
    imageData: '',
    busy: false,
  };
  if (state.pieceId && !pieces.some((p) => p.id === state.pieceId)) {
    try { const p = await api.get(`/pieces/${encodeURIComponent(state.pieceId)}`); if (p) pieces.push(p); } catch { state.pieceId = ''; }
  }
  const tplOf = () => byId(state.template);
  const pieceOf = () => pieces.find((p) => p.id === state.pieceId) || null;
  const effectiveFields = () => {
    const t = tplOf();
    return { ...state.fields, format: state.format, imageData: t.meta.supportsImage ? state.imageData : '' };
  };

  // ------------------------------------------------------------ preview
  const frame = el('div', { class: 'cards-frame' });
  const meta = el('div', { class: 'cards-meta' });
  const warnBox = el('div', { class: 'cards-warnings' });
  const noteBox = el('div', { class: 'small muted cards-note' });

  function drawPreview() {
    const t = tplOf();
    const fields = effectiveFields();
    const warnings = [];
    let svg;
    try {
      svg = t.render(fields, state.theme, { embedFonts: false, warnings });
    } catch (err) {
      console.error(err);
      frame.replaceChildren(el('div', { class: 'banner banner-bad', text: `This card could not be drawn: ${err.message}` }));
      return;
    }
    const { w, h } = t.size(fields);
    frame.style.setProperty('--ar', String(w / h));
    frame.innerHTML = svg;
    meta.replaceChildren(
      el('span', { class: 'mono', text: `${w} x ${h} px` }),
    );
    const notes = String(t.meta.note || '').split(/(?<=\.)\s+/).map((n) => n.replace(/\.$/, '')).filter(Boolean);
    const issues = [...warnings, ...brandIssues(state.fields)];
    warnBox.replaceChildren(...issues.map((m) => el('div', { class: 'banner banner-warn', text: m })));
    if (t.meta.supportsImage && !state.imageData) notes.push('Can carry an illustration: generate one below or use a saved one');
    noteBox.replaceChildren(notes.length ? bullets(notes, { compact: true }) : '');
  }
  const schedule = debounce(drawPreview, 70);

  // ----------------------------------------------------------- controls
  const controls = el('div');
  const piecesRow = el('div');
  const templatesRow = el('div', { class: 'cards-templates' });
  const themeRow = el('div');
  const brandRow = el('div', { class: 'cards-brand' });
  const formatRow = el('div');
  const fieldsBox = el('div');
  const imageRow = el('div');

  function set(key, value) { state.fields[key] = value; schedule(); }

  function buildTemplates() {
    templatesRow.replaceChildren(...activeTemplates().map((t) => {
      const sizes = t.meta.formats.map((f) => f.label.replace(/^[A-Za-z]+ (?=\d)/, '')).join(' or ');
      return el('button', {
        type: 'button', class: `cards-template${t.meta.id === state.template ? ' active' : ''}`,
        onClick: () => switchTemplate(t.meta.id),
      }, [el('b', { text: t.meta.label }), el('span', { text: sizes })]);
    }));
  }

  function buildTheme() {
    const t = tplOf();
    const themes = t.meta.themes || ['navy', 'light'];
    const seg = el('div', { class: 'cards-seg', role: 'group', 'aria-label': 'Theme' }, themes.map((id) =>
      el('button', {
        type: 'button', class: id === state.theme ? 'active' : '', text: THEME_LABEL[id] || id,
        onClick: () => { state.theme = id; state.themeTouched = true; buildTheme(); drawPreview(); },
      })));
    themeRow.replaceChildren(field({ label: 'Theme', input: seg, hint: 'Navy takes the reverse logo, light the colour logo.' }));
  }

  // Brand on this card: the Builder's defaults (Brand and logo box), changeable per card.
  // The logo is always at the bottom, at a fixed place and size.
  const brand = { ...useBrand() };
  function buildBrand() {
    const seg = (key, label, opts) => field({ label, input: el('div', { class: 'cards-seg', role: 'group', 'aria-label': label }, opts.map(([v, t]) =>
      el('button', { type: 'button', class: brand[key] === v ? 'active' : '', text: t, onClick: () => { brand[key] = v; useBrand(brand); buildBrand(); drawPreview(); } }))) });
    brandRow.replaceChildren(
      seg('logo', 'Logo', [['full', 'Full logo'], ['mark', 'VD mark']]),
      seg('taglineLayout', 'Tagline', [['line', 'One line'], ['stacked', 'Below logo']]),
    );
  }

  function buildFormat() {
    const t = tplOf();
    if (t.meta.formats.length < 2) { formatRow.replaceChildren(); return; }
    const sel = select({
      options: t.meta.formats.map((f) => ({ value: f.id, label: f.label })), value: state.format,
      onChange: (e) => { state.format = e.target.value; drawPreview(); },
    });
    formatRow.replaceChildren(field({ label: 'Size', input: sel }));
  }

  function fieldControl(def) {
    const value = state.fields[def.key] ?? '';
    let ctl;
    if (def.type === 'textarea') {
      ctl = textarea({ value, rows: def.rows || 3, onInput: (e) => set(def.key, e.target.value) });
    } else if (def.type === 'select') {
      ctl = select({
        options: def.options, value,
        onChange: (e) => { set(def.key, e.target.value); buildFields(); },
      });
    } else if (def.type === 'number') {
      ctl = input({ type: 'number', min: 1, value, class: 'mono', onInput: (e) => set(def.key, e.target.value === '' ? '' : Number(e.target.value)) });
    } else {
      ctl = input({ value, onInput: (e) => set(def.key, e.target.value) });
    }
    return field({ label: def.label, input: ctl, hint: def.hint });
  }

  function buildFields() {
    const t = tplOf();
    const defs = t.meta.fields.filter((d) => !d.show || d.show(state.fields));
    fieldsBox.replaceChildren(...defs.map(fieldControl));
  }

  function buildImageRow() {
    const t = tplOf();
    if (!t.meta.supportsImage) { imageRow.replaceChildren(); return; }
    const body = state.imagePath
      ? el('div', { class: 'row' }, [
        chip({ label: state.imagePath.split('/').pop(), tone: 'accent' }),
        button({ kind: 'ghost', small: true, label: 'Remove', onClick: () => { state.imagePath = ''; state.imageData = ''; buildImageRow(); drawPreview(); } }),
      ])
      : el('span', { class: 'small muted', text: 'None yet. Use one from Illustration or Saved below.' });
    imageRow.replaceChildren(field({ label: 'Illustration', input: body, hint: t.meta.id === 'hook' ? 'Shown on the portrait size only.' : undefined }));
  }

  function buildPieces() {
    const sel = select({
      options: pieces.map((p) => ({ value: p.id, label: pieceLabel(p) })), value: state.pieceId, placeholder: 'No piece (a free card)',
      onChange: (e) => {
        state.pieceId = e.target.value;
        state.slide = 0;
        history.replaceState(null, '', state.pieceId ? `#/visuals?piece=${encodeURIComponent(state.pieceId)}` : '#/visuals');
        buildPieces(); loadGallery(); updateIllustrationButtons();
      },
    });
    const p = pieceOf();
    const children = [field({ label: 'Piece', input: sel })];
    const row = el('div', { class: 'row', style: { marginBottom: '14px' } });
    row.appendChild(button({ kind: 'secondary', small: true, label: 'Use piece text', icon: 'content', disabled: !p, title: p ? '' : 'Choose a piece first', onClick: () => useText() }));
    if (p && state.template === 'carouselSlide' && (p.slides || []).length) {
      const slideSel = select({
        options: p.slides.map((s, i) => ({ value: String(i), label: `Slide ${i + 1}: ${s.t || 'point'}` })), value: String(state.slide),
        onChange: (e) => { state.slide = Number(e.target.value); useText(); },
      });
      row.appendChild(slideSel);
      row.appendChild(button({ kind: 'secondary', small: true, label: `Export all ${p.slides.length}`, onClick: () => exportAllSlides() }));
    }
    children.push(row);
    piecesRow.replaceChildren(...children);
  }

  function useText() {
    const p = pieceOf();
    if (!p) { toast('Choose a piece first', 'warn'); return; }
    const t = tplOf();
    const patch = t.meta.fromPiece(p, { slide: state.slide });
    for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== null) state.fields[k] = v;
    buildFields();
    drawPreview();
    toast('Filled from the piece', 'ok');
  }

  function switchTemplate(id) {
    const old = tplOf();
    const next = byId(id);
    if (!next || id === state.template) return;
    // Text carries over; a field still on the old template's default takes the new default.
    const oldDefaults = defaultsFor(old);
    for (const [k, v] of Object.entries(defaultsFor(next))) {
      const cur = state.fields[k];
      if (cur === undefined || cur === '' || cur === oldDefaults[k]) state.fields[k] = v;
    }
    state.template = id;
    const themes = next.meta.themes || ['navy', 'light'];
    if (!themes.includes(state.theme) || !state.themeTouched) state.theme = themeFor(next.meta);
    if (!next.meta.formats.some((f) => f.id === state.format)) state.format = next.meta.formats[0].id;
    // With a piece chosen, the new template fills from the piece rather than showing its default text.
    const p = pieceOf();
    if (p && typeof next.meta.fromPiece === 'function') {
      state.slide = 0;
      const patch = next.meta.fromPiece(p, { slide: 0 });
      for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== null && v !== '') state.fields[k] = v;
    }
    buildAll();
    drawPreview();
  }

  function buildAll() {
    buildTemplates(); buildTheme(); buildBrand(); buildFormat(); buildFields(); buildImageRow(); buildPieces();
  }

  // ------------------------------------------------------------- export
  async function postCard(fields, theme, t, { quiet = false } = {}) {
    const { w, h } = t.size(fields);
    const svg = t.render(fields, theme, { warnings: [] });
    const png = await svgToPng(svg, w, h);
    const fd = new FormData();
    const stem = `${t.meta.id}-${w}x${h}`;
    fd.append('file', png, `${stem}.png`);
    if (state.pieceId) fd.append('pieceId', state.pieceId);
    fd.append('template', t.meta.id);
    fd.append('w', String(w));
    fd.append('h', String(h));
    fd.append('theme', theme);
    fd.append('format', fields.format || '');
    const { imageData, ...rest } = fields;
    fd.append('fields', JSON.stringify({ ...rest, illustration: state.imagePath || undefined }));
    const record = await api.post('/images/card', fd);
    if (!quiet) toast(`Saved ${w} x ${h} PNG to ${record.path}`, 'ok');
    return { record, png };
  }

  async function exportPng({ download = false } = {}) {
    if (state.busy) return;
    state.busy = true;
    exportBtn.disabled = true;
    try {
      const { record, png } = await postCard(effectiveFields(), state.theme, tplOf());
      if (download) {
        const a = el('a', { href: URL.createObjectURL(png), download: record.path.split('/').pop() });
        document.body.appendChild(a); a.click(); a.remove();
      }
      loadGallery();
    } catch (err) {
      toast(`The PNG could not be saved: ${err.message}`, 'bad');
    } finally { state.busy = false; exportBtn.disabled = false; }
  }

  async function exportAllSlides() {
    const p = pieceOf();
    const t = tplOf();
    if (!p || !(p.slides || []).length || state.busy) return;
    state.busy = true;
    const keep = { ...state.fields };
    try {
      for (let i = 0; i < p.slides.length; i++) {
        const patch = t.meta.fromPiece(p, { slide: i });
        const fields = { ...state.fields, ...patch, format: state.format, imageData: '' };
        toast(`Exporting slide ${i + 1} of ${p.slides.length}`, 'info', { ms: 1200 });
        await postCard(fields, state.theme, t, { quiet: true });
      }
      toast(`Saved ${p.slides.length} slides`, 'ok');
      loadGallery();
    } catch (err) {
      toast(`A slide could not be saved: ${err.message}`, 'bad');
    } finally { state.fields = keep; state.busy = false; }
  }

  const exportBtn = button({ kind: 'primary', label: 'Export PNG', icon: 'pictures', onClick: () => exportPng() });
  const downloadBtn = button({ kind: 'secondary', label: 'Export and download', onClick: () => exportPng({ download: true }) });

  // ------------------------------------------------------- illustration
  const promptTa = textarea({ rows: 5, placeholder: 'What is drawn and how it is arranged. House style is added.' });
  const aspectSel = select({ options: [{ value: '1:1', label: 'Square 1:1' }, { value: '16:9', label: 'Landscape 16:9 (thumbnail)' }, { value: '4:5', label: 'Portrait 4:5' }], value: '1:1' });
  const result = el('div', { class: 'cards-illu-result', text: 'The picture appears here.' });
  const illuNote = el('div');
  const suggestBox = el('div', { class: 'cards-suggest' });
  const promptView = el('div');
  const fullPrompt = () => `${prefix.replace(/[.\s]+$/, '')}. ${promptTa.value.trim()}`.trim();

  const suggestBtn = button({ kind: 'secondary', small: true, label: 'Suggest from the piece', icon: 'sparkle', onClick: () => suggest() });
  const previewPromptBtn = button({ kind: 'ghost', small: true, label: 'Show the AI prompt', onClick: () => showAiPrompt() });
  const copyBtn = button({ kind: 'ghost', small: true, label: 'Copy full prompt', onClick: async () => {
    try { await navigator.clipboard.writeText(fullPrompt()); toast('Prompt copied', 'ok'); } catch { toast('The prompt could not be copied; select it by hand', 'warn'); }
  } });
  const generateBtn = button({ kind: 'primary', label: 'Generate', icon: 'sparkle', onClick: () => generate() });

  function updateIllustrationButtons() {
    const has = Boolean(pieceOf());
    suggestBtn.disabled = !has;
    previewPromptBtn.disabled = !has;
    suggestBtn.title = has ? '' : 'Choose a piece first';
  }

  function aiFailure(err) {
    const claudeProblem = err.status === 502 || err.status === 504 || /claude/i.test(err.message || '');
    if (claudeProblem) {
      toast(`The AI could not run. ${LOGIN_HINT}`, 'bad', { ms: 6000 });
      illuNote.replaceChildren(el('div', { class: 'banner banner-warn' }, bullets([`The AI could not write the prompt: ${err.message}`, LOGIN_HINT, 'Or type a prompt by hand'], { compact: true })));
    } else {
      toast(err.message, 'bad');
    }
  }

  async function suggest() {
    const p = pieceOf();
    if (!p) return;
    suggestBtn.disabled = true;
    illuNote.replaceChildren();
    try {
      const r = await api.post('/images/prompts', { pieceId: p.id, kind: 'cover' });
      const out = r.output || {};
      promptTa.value = out.scene || '';
      suggestBox.replaceChildren(...(out.cards || []).filter((c) => !byId(c.template) || isTemplateOn(c.template)).map((c) => {
        const t = byId(c.template);
        return el('div', { class: 'cards-suggest-row' }, [
          el('div', {}, [el('b', { text: t ? t.meta.label : c.template }), el('span', { text: [c.eyebrow, c.head, c.body].filter(Boolean).join(' | ') })]),
          button({ kind: 'secondary', small: true, label: 'Use', onClick: () => {
            if (t) { if (state.template !== t.meta.id) switchTemplate(t.meta.id); }
            state.fields.eyebrow = c.eyebrow; state.fields.head = c.head; if (c.body) state.fields.body = c.body;
            buildFields(); drawPreview();
          } }),
        ]);
      }));
      toast('Prompt and card texts suggested', 'ok');
    } catch (err) { aiFailure(err); } finally { updateIllustrationButtons(); }
  }

  async function showAiPrompt() {
    const p = pieceOf();
    if (!p) return;
    try {
      const r = await api.post('/images/prompts', { pieceId: p.id, dryRun: true });
      promptView.replaceChildren(
        el('div', { class: 'small muted', text: 'What the AI is asked. Nothing was sent.' }),
        el('pre', { class: 'cards-pre', text: `SYSTEM\n${r.system}\n\nUSER\n${r.user}` }),
      );
    } catch (err) { toast(err.message, 'bad'); }
  }

  async function generate() {
    const scene = promptTa.value.trim();
    if (!scene) { toast('Write a prompt first, or suggest one from the piece', 'warn'); return; }
    generateBtn.disabled = true;
    illuNote.replaceChildren();
    result.replaceChildren(document.createTextNode('Generating'));
    try {
      const rec = await api.post('/images/illustration', { pieceId: state.pieceId || undefined, prompt: scene, aspect: aspectSel.value });
      showIllustration(rec);
      toast('Illustration saved', 'ok');
      loadGallery();
    } catch (err) {
      result.replaceChildren(document.createTextNode('No picture was made.'));
      const prompt = err.detail?.prompt || fullPrompt();
      const bits = [el('div', { class: 'banner banner-warn' }, [el('div', {}, [el('b', { text: err.message }), err.detail?.reason ? el('div', { text: err.detail.reason }) : null])])];
      bits.push(el('div', { class: 'small muted', text: 'The full prompt, for an image tool of your own' }));
      bits.push(el('pre', { class: 'cards-pre', text: prompt }));
      illuNote.replaceChildren(...bits);
    } finally { generateBtn.disabled = false; }
  }

  function showIllustration(rec) {
    result.replaceChildren(
      el('div', {}, [
        el('img', { src: rec.path, alt: 'Generated illustration' }),
        el('div', { class: 'row', style: { justifyContent: 'center', marginTop: '10px' } }, [
          chip({ label: `${rec.provider} · ${rec.w || '?'} x ${rec.h || '?'}`, tone: 'muted' }),
          button({ kind: 'secondary', small: true, label: 'Use in the card', onClick: () => useIllustration(rec.path) }),
        ]),
      ]),
    );
  }

  async function useIllustration(path) {
    try {
      state.imageData = await toDataUrl(path);
      state.imagePath = path;
      buildImageRow();
      const t = tplOf();
      if (!t.meta.supportsImage) switchTemplate('thumbnail'); else drawPreview();
      toast('Illustration placed in the card', 'ok');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { toast(err.message, 'bad'); }
  }

  const illustration = card({
    title: 'Illustration',
    eyebrow: 'Covers and thumbnails only',
    class: 'cards-illustration',
    body: [
      el('div', { class: 'cards-illu-grid' }, [
        el('div', {}, [
          el('div', { class: 'field' }, [
            el('span', { class: 'field-label', text: 'House style (locked)' }),
            el('div', { class: 'cards-lock' }, [
              el('textarea', { class: 'textarea', readOnly: true, rows: 3, 'aria-readonly': 'true', value: prefix }),
              el('span', { class: 'cards-lock-tag', text: 'Locked' }),
            ]),
            el('span', { class: 'field-hint', text: 'Set in Builder, AI. Added to every prompt.' }),
          ]),
          field({ label: 'Subject', input: promptTa, hint: 'No text, no real faces, no real product screens.' }),
          field({ label: 'Shape', input: aspectSel }),
          el('div', { class: 'row' }, [suggestBtn, previewPromptBtn, copyBtn, generateBtn]),
          illuNote,
          promptView,
          suggestBox,
        ]),
        el('div', {}, [
          result,
          el('div', { class: 'small muted', style: { marginTop: '10px' } }, bullets(provider === 'none'
            ? ['No image provider set', 'Generate gives you the prompt to copy', 'Choose Gemini or OpenAI in Builder, AI']
            : [`Provider: ${provider}`, `Key: ${provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'} on the server`], { compact: true })),
        ]),
      ]),
    ],
  });

  // ------------------------------------------------------------- gallery
  const galleryBox = el('div');
  async function loadGallery() {
    let rows = [];
    try {
      rows = state.pieceId
        ? await api.get(`/pieces/${encodeURIComponent(state.pieceId)}/images`)
        : await api.get('/images', { _sort: '-updatedAt', _limit: 12 });
    } catch (err) { galleryBox.replaceChildren(el('div', { class: 'banner banner-warn', text: `Saved pictures could not be loaded: ${err.message}` })); return; }
    galleryBox.replaceChildren(rows.length
      ? el('div', { class: 'cards-gallery' }, rows.map(thumb))
      : el('p', { class: 'muted', text: state.pieceId ? 'Nothing saved for this piece yet' : 'Nothing saved yet' }));
  }

  function thumb(im) {
    const label = im.kind === 'illustration' ? 'Illustration' : (byId(im.template)?.meta.label || im.kind);
    const actions = [];
    if (im.kind === 'illustration') actions.push(button({ kind: 'secondary', small: true, label: 'Use', onClick: () => useIllustration(im.path) }));
    actions.push(button({ kind: 'ghost', small: true, label: 'Delete', onClick: async () => {
      const ok = await confirm({ title: 'Delete this picture', message: 'The file and its record go for good.', confirmLabel: 'Delete', danger: true });
      if (!ok) return;
      try { await api.del(`/images/${encodeURIComponent(im.id)}`); loadGallery(); } catch (err) { toast(err.message, 'bad'); }
    } }));
    return el('div', { class: 'cards-thumb' }, [
      el('a', { href: im.path, target: '_blank', rel: 'noopener', 'aria-label': `Open ${label}` }, el('img', { src: im.path, alt: label, loading: 'lazy' })),
      el('div', { class: 'cards-thumb-meta' }, [
        el('b', { text: label }),
        el('span', { class: 'mono', text: `${im.w || '?'} x ${im.h || '?'}` }),
        im.updatedAt ? el('span', { text: fmt.dateTime(im.updatedAt) }) : null,
        im.approved ? chip({ label: 'Approved with the piece', tone: 'ok' }) : null,
        el('div', { class: 'row' }, actions),
      ]),
    ]);
  }

  // --------------------------------------------------------------- layout
  controls.append(piecesRow, el('div', { class: 'field-label', style: { marginBottom: '6px' }, text: 'Template' }), templatesRow, themeRow, brandRow, formatRow, fieldsBox, imageRow);
  const left = card({ title: 'Card', class: 'cards-controls', body: controls });
  const stage = el('div', { class: 'cards-stage' }, card({
    title: 'Preview',
    body: [
      el('div', { class: 'cards-frame-wrap' }, frame),
      meta, noteBox, warnBox,
      el('div', { class: 'cards-actions' }, [exportBtn, downloadBtn]),
    ],
  }));

  container.append(
    el('div', { class: 'cards-layout' }, [left, stage]),
    illustration,
    card({ title: state.pieceId ? 'Saved for this piece' : 'Recently saved', body: galleryBox }),
  );

  buildAll();
  drawPreview();
  updateIllustrationButtons();
  loadGallery();
  if (state.pieceId && pieceOf()) {
    // Arriving from a piece: open on the template that fits its type and fill the card from its text.
    const p = pieceOf();
    const fit = TEMPLATE_BY_TYPE[p.type];
    if (fit && fit !== state.template && byId(fit) && isTemplateOn(fit)) switchTemplate(fit);
    const patch = tplOf().meta.fromPiece(p, { slide: 0 });
    for (const [k, v] of Object.entries(patch)) if (v) state.fields[k] = v;
    buildFields();
    drawPreview();
  }

  // Fonts can finish loading after the first measure; draw once more when they do.
  document.fonts.ready.then(() => drawPreview());
}
