// Shared helpers for the card templates. [pictures]
//
// A template is a function (fields, theme, opts) -> an SVG string at full
// pixel size. Everything a template needs in common lives here:
//
//   ready()                  load and cache the fonts (as data URLs) and the official logo files
//   palette(theme)           colours for 'navy' and 'light'
//   parseRich / fit          `*starred*` words, word wrap with a canvas measurer, shrink to fit
//   textLines / eyebrow / footer / logo / imagePanel / frame   SVG parts
//   stackCard(cfg)           the standard card: eyebrow, headline, body, optional picture, footer
//
// Fonts are embedded in each exported SVG with @font-face data URLs because an
// SVG drawn onto a canvas cannot load fonts from the page. The live preview
// leaves them out (opts.embedFonts === false): the page already has them.
// Logos are inlined from app/img/vd-wordmark-*.svg exactly as published; they
// are never redrawn or recoloured.

const BASE = new URL('../../', import.meta.url);

export const TAGLINE = 'See everything. Chase nothing.';

export const COLOR = {
  navy: '#0a3050', accent: '#8ace8a', accentInk: '#1a5c1a', white: '#ffffff', surface: '#f5f7fa',
  border: '#dde6ee', textSecondary: '#4a4a4a', textMuted: '#6b6b6b', onNavyBody: '#d6e4f0',
};

export function palette(theme) {
  if (theme === 'light') {
    return {
      theme: 'light', bg: COLOR.surface, ink: COLOR.navy, star: COLOR.accentInk, eyebrow: COLOR.accentInk,
      body: COLOR.textSecondary, muted: COLOR.textMuted, rule: 'rgba(10,48,80,.18)', logo: 'colour',
      chipBg: COLOR.accent, chipInk: COLOR.navy,
    };
  }
  return {
    theme: 'navy', bg: COLOR.navy, ink: COLOR.white, star: COLOR.accent, eyebrow: COLOR.accent,
    body: COLOR.onNavyBody, muted: 'rgba(255,255,255,.78)', rule: 'rgba(138,206,138,.35)', logo: 'reverse',
    chipBg: COLOR.accent, chipInk: COLOR.navy,
  };
}

// ------------------------------------------------------------------ fonts

export const F = {
  head: { family: 'Gilmer', weight: 700, ls: -0.014, stack: "Gilmer, 'Plus Jakarta Sans', system-ui, sans-serif" },
  body: { family: 'Plus Jakarta Sans', weight: 500, ls: 0, stack: "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif" },
  tag: { family: 'Plus Jakarta Sans', weight: 600, ls: 0, stack: "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif" },
  label: { family: 'Plus Jakarta Sans', weight: 700, ls: 0.14, stack: "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif" },
  strong: { family: 'Plus Jakarta Sans', weight: 700, ls: 0, stack: "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif" },
  mono: { family: 'JetBrains Mono', weight: 700, ls: 0.02, stack: "'JetBrains Mono', ui-monospace, Menlo, monospace" },
};

const FACES = [
  { family: 'Gilmer', weight: 700, file: 'fonts/Gilmer-Bold.otf', format: 'opentype', mime: 'font/otf' },
  { family: 'Plus Jakarta Sans', weight: 500, file: 'fonts/plusjakartasans-500-latin.woff2', format: 'woff2', mime: 'font/woff2' },
  { family: 'Plus Jakarta Sans', weight: 600, file: 'fonts/plusjakartasans-600-latin.woff2', format: 'woff2', mime: 'font/woff2' },
  { family: 'Plus Jakarta Sans', weight: 700, file: 'fonts/plusjakartasans-700-latin.woff2', format: 'woff2', mime: 'font/woff2' },
  { family: 'JetBrains Mono', weight: 700, file: 'fonts/jetbrainsmono-700-latin.woff2', format: 'woff2', mime: 'font/woff2' },
];

const LOGO_FILES = {
  colour: 'img/vd-wordmark-colour.svg', reverse: 'img/vd-wordmark-reverse.svg',
  markColour: 'img/vd-mark-colour.svg', markReverse: 'img/vd-mark-reverse.svg',
};

// ------------------------------------------------------------------ brand
// How the brand shows on every card. The Builder sets the defaults (Brand and logo box,
// settings.brand); Visuals may override them for one card. Renders are synchronous,
// so the active brand is module state, set before a render with useBrand().
//   logo: 'full' | 'mark'   taglineLayout: 'line' | 'stacked'   tagline: text or null (the house line)
// The brand always sits at the bottom, at a fixed place and size per format (docs/BUILDER.md 3).
// A stored position: 'top' (removed on 3 November 2026) is ignored.
export const BRAND_DEFAULTS = { logo: 'full', taglineLayout: 'line', tagline: null };
const cleanBrand = (b) => {
  const out = { ...BRAND_DEFAULTS };
  if (b && b.logo === 'mark') out.logo = 'mark';
  if (b && b.taglineLayout === 'stacked') out.taglineLayout = 'stacked';
  if (b && typeof b.tagline === 'string' && b.tagline.trim()) out.tagline = b.tagline.trim();
  return out;
};
let brandBase = { ...BRAND_DEFAULTS };
let brandActive = { ...BRAND_DEFAULTS };
/** The builder's defaults (settings.brand). */
export function setBrand(b) { brandBase = cleanBrand(b); brandActive = { ...brandBase }; }
/** For the next renders: the defaults with a per-card override on top. */
export function useBrand(override) { brandActive = cleanBrand({ ...brandBase, ...(override || {}) }); return { ...brandActive }; }
export const brandNow = () => ({ ...brandActive });

// --------------------------------------------------------- card settings
// Per template: on or off, default theme, default footer line; and the fixed words
// some templates draw. The Builder sets them (Card templates box, settings.cards):
//   { off: [ids], theme: { id: 'navy'|'light'|'auto' }, footer: { id: text }, text: { swipe, ventureLine, greetingEyebrow } }
// Anything missing falls back to the hard-coded values below.
export const CARD_TEXT = { swipe: 'SWIPE', ventureLine: 'A venture by VSP', greetingEyebrow: 'Warm wishes' };
let cardSet = { off: [], theme: {}, footer: {}, text: {} };
const strMap = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim()]));
/** The builder's card settings (settings.cards). Set it wherever setBrand is set. */
export function setCards(c) {
  const src = c && typeof c === 'object' ? c : {};
  cardSet = {
    off: Array.isArray(src.off) ? src.off.filter((x) => typeof x === 'string') : [],
    theme: strMap(src.theme), footer: strMap(src.footer), text: strMap(src.text),
  };
}
export const cardsNow = () => JSON.parse(JSON.stringify(cardSet));
/** A fixed word of a template ('swipe', 'ventureLine', 'greetingEyebrow'). */
export const cardText = (key) => cardSet.text[key] || CARD_TEXT[key] || '';
export const isTemplateOn = (id) => !cardSet.off.includes(id);
/** The default theme of a template: the builder's choice if it is one the template has. */
export function themeFor(meta) {
  const t = cardSet.theme[meta.id];
  const themes = meta.themes || ['navy', 'light'];
  return t && themes.includes(t) ? t : meta.defaultTheme;
}
/** The default footer line of a template: the builder's, else the template's own default. */
export function footerFor(meta) {
  if (cardSet.footer[meta.id] != null) return cardSet.footer[meta.id];
  return meta.defaults && meta.defaults.footer != null ? meta.defaults.footer : TAGLINE;
}

let loaded = null;     // { fontCss, logos } once ready
let loading = null;

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function loadFonts() {
  const css = await Promise.all(FACES.map(async (f) => {
    const res = await fetch(new URL(f.file, BASE));
    if (!res.ok) throw new Error(`Font ${f.file} could not be loaded`);
    const b64 = toBase64(await res.arrayBuffer());
    return `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:normal;src:url(data:${f.mime};base64,${b64}) format('${f.format}')}`;
  }));
  return css.join('');
}

async function loadLogos() {
  const out = {};
  for (const [key, file] of Object.entries(LOGO_FILES)) {
    const res = await fetch(new URL(file, BASE));
    if (!res.ok) throw new Error(`Logo ${file} could not be loaded`);
    const text = await res.text();
    const m = /<svg[^>]*\sviewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>/.exec(text);
    if (!m) throw new Error(`Logo ${file} is not in the expected form`);
    const [x, y, w, h] = m[1].split(/\s+/).map(Number);
    out[key] = { viewBox: m[1], w, h, inner: m[2].trim(), ratio: w / h };
  }
  return out;
}

/** Loads fonts and logos once. Await it before the first render or measure. */
export function ready() {
  if (!loading) {
    loading = (async () => {
      const [fontCss, logos] = await Promise.all([loadFonts(), loadLogos()]);
      await Promise.all([
        document.fonts.load('700 100px Gilmer'),
        document.fonts.load('500 20px "Plus Jakarta Sans"'),
        document.fonts.load('600 20px "Plus Jakarta Sans"'),
        document.fonts.load('700 20px "Plus Jakarta Sans"'),
        document.fonts.load('700 20px "JetBrains Mono"'),
      ]);
      await document.fonts.ready;
      loaded = { fontCss, logos };
      return loaded;
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

export const isReady = () => Boolean(loaded);

// --------------------------------------------------------------- measuring

const mctx = document.createElement('canvas').getContext('2d');

function setFont(f, size) {
  mctx.font = `${f.weight} ${size}px ${f.stack}`;
  if ('letterSpacing' in mctx) mctx.letterSpacing = `${(f.ls || 0) * size}px`;
}

export function textWidth(str, f, size) {
  setFont(f, size);
  return mctx.measureText(str).width;
}

const metricsCache = new Map();
/** Ascent and descent of a font in em, used to place baselines like a CSS line box. */
export function metrics(f) {
  const key = `${f.family}${f.weight}`;
  if (metricsCache.has(key)) return metricsCache.get(key);
  setFont({ ...f, ls: 0 }, 100);
  const m = mctx.measureText('Hxg');
  const asc = (m.fontBoundingBoxAscent ?? 95) / 100;
  const desc = (m.fontBoundingBoxDescent ?? 25) / 100;
  const out = { asc, desc };
  if (isReady()) metricsCache.set(key, out);
  return out;
}

// ------------------------------------------------------------- rich text

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Removes the star marks: "Run the *business*" -> "Run the business". */
export const plain = (s) => String(s ?? '').replace(/\*([^*]+)\*/g, '$1');

/**
 * Splits text into words. Each word is { runs: [ { t, star } ] }; a `*starred*`
 * run keeps any punctuation stuck to it in the same word. A newline is
 * { br: true }. Words break only at spaces, so "follow-ups" never splits.
 */
export function parseRich(text) {
  const words = [];
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  lines.forEach((line, li) => {
    let current = null;
    const flush = () => { if (current && current.runs.length) words.push(current); current = null; };
    for (const seg of line.split(/(\*[^*]+\*)/g)) {
      if (!seg) continue;
      const star = /^\*[^*]+\*$/.test(seg);
      const text = star ? seg.slice(1, -1) : seg;
      for (const piece of text.split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) flush();
        else { if (!current) current = { runs: [] }; current.runs.push({ t: piece, star }); }
      }
    }
    flush();
    if (li < lines.length - 1) words.push({ br: true });
  });
  while (words.length && words[words.length - 1].br) words.pop();
  while (words.length && words[0].br) words.shift();
  return words;
}

const wordText = (w) => w.runs.map((r) => r.t).join('');

function greedy(words, widths, space, maxW) {
  const lines = [[]];
  let lineW = 0;
  let tooWide = false;
  words.forEach((w, i) => {
    if (w.br) { lines.push([]); lineW = 0; return; }
    const cur = lines[lines.length - 1];
    const add = widths[i];
    if (add > maxW) tooWide = true;
    if (cur.length === 0) { cur.push(w); lineW = add; }
    else if (lineW + space + add <= maxW) { cur.push(w); lineW += space + add; }
    else { lines.push([w]); lineW = add; }
  });
  return { lines, tooWide };
}

/** Wraps at the widest line, then narrows the measure while the line count holds (balanced lines). */
function wrapBalanced(words, widths, space, maxW) {
  const first = greedy(words, widths, space, maxW);
  if (first.tooWide || first.lines.length < 2) return first;
  let lo = 0; let hi = maxW;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const r = greedy(words, widths, space, mid);
    if (!r.tooWide && r.lines.length === first.lines.length) hi = mid; else lo = mid;
  }
  return greedy(words, widths, space, hi + 1);
}

/**
 * Fits text into a box. Starts at `max` pixels and shrinks until no word is
 * wider than the box, the line count is within maxLines and the height within
 * maxH. Returns { size, lines, lineH, height, overflow }.
 */
export function fit(text, f, { maxW, maxH = Infinity, max, min, line = 1.1, maxLines = 99, balance = true, step = 2 }) {
  const words = parseRich(text);
  const floor = min ?? Math.round(max * 0.4);
  if (!words.length) return { size: max, lines: [], lineH: max * line, height: 0, overflow: false };
  let result = null;
  for (let size = max; size >= floor; size -= step) {
    const widths = words.map((w) => (w.br ? 0 : textWidth(wordText(w), f, size)));
    const space = textWidth(' ', f, size);
    const r = (balance ? wrapBalanced : greedy)(words, widths, space, maxW);
    const lineH = size * line;
    const height = r.lines.length * lineH;
    result = { size, lines: r.lines, lineH, height, overflow: r.tooWide || r.lines.length > maxLines || height > maxH };
    if (!result.overflow) return result;
  }
  return result;
}

/** One <text> per line with tspans per run. y is the top of the block. */
export function textLines({ lines, x, y, size, lineH, f, fill, starFill, anchor = 'start' }) {
  const { asc, desc } = metrics(f);
  const offset = (lineH - (asc + desc) * size) / 2 + asc * size;
  const ls = (f.ls || 0) * size;
  return lines.map((words, i) => {
    const parts = [];
    words.forEach((w, wi) => {
      if (wi > 0) parts.push(' ');
      for (const r of w.runs) parts.push(`<tspan fill="${r.star ? starFill : fill}">${esc(r.t)}</tspan>`);
    });
    const base = y + i * lineH + offset;
    return `<text xml:space="preserve" x="${round(x)}" y="${round(base)}" font-family="${esc(f.stack)}" font-weight="${f.weight}" font-size="${round(size)}" letter-spacing="${round(ls)}" text-anchor="${anchor}" fill="${fill}">${parts.join('')}</text>`;
  }).join('');
}

export const round = (n) => Math.round(n * 100) / 100;

/** A single line of text with a baseline at y. */
export function textAt({ str, x, y, f, size, fill, anchor = 'start', ls }) {
  const spacing = ls ?? (f.ls || 0) * size;
  return `<text xml:space="preserve" x="${round(x)}" y="${round(y)}" font-family="${esc(f.stack)}" font-weight="${f.weight}" font-size="${round(size)}" letter-spacing="${round(spacing)}" text-anchor="${anchor}" fill="${fill}">${esc(str)}</text>`;
}

// --------------------------------------------------------------- SVG parts

/** Eyebrow: a green dot with a soft ring, then the label in small caps. Returns { svg, height }. */
export function eyebrow(pal, { x, y, text, size = 26, maxW }) {
  const label = String(text ?? '').trim().toUpperCase();
  if (!label) return { svg: '', height: 0 };
  const dot = Math.round(size * 0.58);
  const ring = Math.round(size * 0.27);
  const gap = Math.round(size * 0.54);
  const lead = ring + dot + ring + gap - ring; // text starts after the ring edge plus the gap
  let s = size;
  const avail = (maxW ?? 9999) - lead - dot / 2;
  while (s > 14 && textWidth(label, F.label, s) > avail) s -= 1;
  const cy = y + size * 0.5;
  const cx = x + ring + dot / 2;
  const base = y + size * 0.5 + s * 0.35;
  const svg =
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(dot / 2 + ring)}" fill="${COLOR.accent}" fill-opacity=".28"/>` +
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(dot / 2)}" fill="${COLOR.accent}"/>` +
    textAt({ str: label, x: cx + dot / 2 + ring + gap, y: base, f: F.label, size: s, fill: pal.eyebrow });
  return { svg, height: size };
}

const logoKey = (pal) => (brandActive.logo === 'mark' ? (pal.logo === 'colour' ? 'markColour' : 'markReverse') : pal.logo);

/** The official logo (word logo or VD mark, per the brand), inlined from the published SVG. */
export function logo(pal, { x, y, h }) {
  if (!loaded) return '';
  const l = loaded.logos[logoKey(pal)];
  const w = h * l.ratio;
  return `<svg x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" viewBox="${l.viewBox}" role="img" aria-label="Venture Drafters">${l.inner}</svg>`;
}

export function logoWidth(pal, h) {
  const l = loaded?.logos[logoKey(pal)];
  return l ? h * l.ratio : h * (brandActive.logo === 'mark' ? 1.06 : 8.08);
}

/**
 * Footer: the brand block, always at the bottom. A rule, the logo on the left and the
 * tagline on the right. The logo's x, bottom edge and height are fixed per format
 * (logoTop + logoH is the bottom edge): they never change with the text, the theme or
 * the tagline layout. The VD mark has one fixed, larger size per format (logoH x 1.9)
 * on the same bottom edge; the rule moves up to clear it.
 * "Below logo" (stacked) draws the tagline under the logo, in the bottom margin down
 * to `limit` (default: the canvas edge less a small margin; the Status cards pass the
 * safe zone's bottom line). It shrinks to a floor; if it still does not fit, it falls
 * back to one line beside the logo.
 */
export function footer(pal, { w, h, padX, ruleY, logoTop, logoH, tagline = TAGLINE, size = 28, rule = true, sub, limit }) {
  const geo = logoBox(pal, { padX, logoTop, logoH });
  const b = brandActive;
  const text = b.tagline != null && tagline === TAGLINE ? b.tagline : tagline;
  let out = '';
  if (rule && ruleY != null) out += `<rect x="${padX}" y="${round(ruleY - (geo.h - logoH))}" width="${w - 2 * padX}" height="2" fill="${pal.rule}"/>`;
  out += logo(pal, { x: geo.x, y: geo.y, h: geo.h });

  let below = false;
  if (text && b.taglineLayout === 'stacked' && h) {
    const edge = limit ?? h - Math.max(16, Math.round(h * 0.016));
    const gap = 10;
    let s = Math.round(size * 0.8);
    const fits = (n) => textWidth(text, F.tag, n) <= w - 2 * padX && geo.bottom + gap + n * 1.05 <= edge;
    while (s > 16 && !fits(s)) s -= 1;
    if (fits(s)) {
      below = true;
      out += textAt({ str: text, x: padX, y: geo.bottom + gap + s * 0.8, f: F.tag, size: s, fill: pal.muted });
    }
  }
  if (text && !below) {
    let s = size;
    const room = w - 2 * padX - geo.w - 40;
    while (s > 16 && textWidth(text, F.tag, s) > room) s -= 1;
    const cy = geo.y + geo.h / 2;
    out += textAt({ str: text, x: w - padX, y: sub ? cy - 2 : cy + s * 0.35, f: F.tag, size: s, fill: pal.muted, anchor: 'end' });
  }
  if (sub) out += textAt({ str: sub.toUpperCase(), x: w - padX, y: geo.y + geo.h / 2 + 32, f: F.label, size: 18, fill: pal.muted, anchor: 'end' });
  return out;
}

/** Where the logo sits: { x, y, w, h, bottom }. Depends only on the format and the logo choice. */
export function logoBox(pal, { padX, logoTop, logoH }) {
  const mark = brandActive.logo === 'mark';
  const h = mark ? Math.round(logoH * 1.9) : logoH;
  const bottom = logoTop + logoH;
  return { x: padX - (mark ? 0 : 6), y: bottom - h, w: logoWidth(pal, h), h, bottom };
}

/** A rounded picture panel from a data URL, cropped to fill. */
export function imagePanel({ id, x, y, w, h, r = 28, href, pal }) {
  const clip = `clip-${id}`;
  return `<defs><clipPath id="${clip}"><rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${r}"/></clipPath></defs>` +
    `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${r}" fill="${pal.theme === 'light' ? '#ffffff' : COLOR.navy}"/>` +
    `<image href="${href}" x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>` +
    `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${r}" fill="none" stroke="${pal.theme === 'light' ? COLOR.border : 'rgba(255,255,255,.14)'}" stroke-width="2"/>`;
}

/** The SVG document: fixed pixel size, embedded fonts, flat background. */
export function frame({ w, h, pal, body, opts }) {
  const fonts = opts && opts.embedFonts === false ? '' : (loaded?.fontCss || '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${esc(F.body.stack)}">` +
    (fonts ? `<style>${fonts}</style>` : '') +
    `<rect width="${w}" height="${h}" fill="${pal.bg}"/>${body}</svg>`;
}

export const warn = (opts, message) => { if (opts && Array.isArray(opts.warnings) && !opts.warnings.includes(message)) opts.warnings.push(message); };

// ------------------------------------------------------------ stack card

/**
 * The standard card: eyebrow, headline, optional body, optional picture panel,
 * footer. Used by the Status rule, hook and LinkedIn templates, which differ
 * only in size, safe zones and type scale.
 *
 * cfg: { w, h, theme, fields, opts, padX, eyebrow: { y, size },
 *        zone: { top, bottom }, align: 'center' | 'top',
 *        head: { max, min, line, maxLines }, body: { max, min, line, maxLines, maxH } | null, gap,
 *        image: { minH, maxH } | null,
 *        footer: { ruleY, logoTop, logoH, size, limit } }
 */
export function stackCard(cfg) {
  const { w, h, fields, opts } = cfg;
  const pal = palette(cfg.theme);
  const padX = cfg.padX;
  const innerW = w - 2 * padX;
  let svg = '';

  if (fields.eyebrow) svg += eyebrow(pal, { x: padX, y: cfg.eyebrow.y, text: fields.eyebrow, size: cfg.eyebrow.size, maxW: innerW }).svg;

  // The text zone ends above the footer rule (which moves up for the taller VD mark).
  const markLift = brandActive.logo === 'mark' ? Math.round(cfg.footer.logoH * 1.9) - cfg.footer.logoH : 0;
  const zone = { top: cfg.zone.top, bottom: Math.min(cfg.zone.bottom, cfg.footer.ruleY != null ? cfg.footer.ruleY - markLift - 36 : cfg.zone.bottom) };
  const zoneH = zone.bottom - zone.top;
  const wantImage = Boolean(cfg.image && fields.imageData);
  const bodyMax = cfg.body && fields.body ? cfg.body.maxH ?? zoneH * 0.35 : 0;
  const head = fit(fields.head, F.head, {
    maxW: innerW, maxH: cfg.head.maxH ?? zoneH - (bodyMax ? bodyMax + cfg.gap : 0) - (wantImage ? cfg.image.minH + cfg.gap : 0),
    max: cfg.head.max, min: cfg.head.min, line: cfg.head.line, maxLines: cfg.head.maxLines,
  });
  if (head.overflow) warn(opts, 'The headline is too long for this template. Shorten it.');
  const body = cfg.body && fields.body
    ? fit(fields.body, F.body, { maxW: innerW, maxH: cfg.body.maxH ?? zoneH * 0.35, max: cfg.body.max, min: cfg.body.min, line: cfg.body.line, maxLines: cfg.body.maxLines, balance: true })
    : null;
  if (body && body.overflow) warn(opts, 'The body text is too long for this template. Shorten it.');

  let textH = head.height + (body ? cfg.gap + body.height : 0);
  let imageH = 0;
  if (wantImage) {
    const room = zoneH - textH - cfg.gap;
    if (room >= cfg.image.minH) imageH = Math.min(room, cfg.image.maxH ?? room);
    else warn(opts, 'There is no room for the illustration with this much text.');
  }
  const total = textH + (imageH ? cfg.gap + imageH : 0);
  const top = cfg.align === 'center' && !imageH ? zone.top + (zoneH - total) / 2 : zone.top;

  svg += textLines({ lines: head.lines, x: padX, y: top, size: head.size, lineH: head.lineH, f: F.head, fill: pal.ink, starFill: pal.star });
  let y = top + head.height;
  if (body) {
    y += cfg.gap;
    svg += textLines({ lines: body.lines, x: padX, y, size: body.size, lineH: body.lineH, f: F.body, fill: pal.body, starFill: pal.star });
    y += body.height;
  }
  if (imageH) svg += imagePanel({ id: 'pic', x: padX, y: y + cfg.gap, w: innerW, h: imageH, href: fields.imageData, pal });

  svg += footer(pal, { w, h, padX, ruleY: cfg.footer.ruleY, logoTop: cfg.footer.logoTop, logoH: cfg.footer.logoH, tagline: fields.footer ?? TAGLINE, size: cfg.footer.size ?? 28, limit: cfg.footer.limit });
  return frame({ w, h, pal, body: svg, opts });
}

// --------------------------------------------------------- piece helpers

/** The pieces of a piece the templates draw on. */
export function pieceText(piece) {
  const pis = piece?.pis || {};
  const solution = Array.isArray(pis.solution) ? pis.solution.join(' ') : (pis.solution || '');
  return {
    hook: piece?.hook || '',
    close: pis.close || '',
    problem: pis.problem || '',
    impact: pis.impact || '',
    solution,
    status: piece?.renditions?.waStatus?.text || '',
    ytTitle: piece?.renditions?.yt?.title || '',
    slides: Array.isArray(piece?.slides) ? piece.slides : [],
  };
}

/** Texts the brand rules forbid, for the view's warnings. */
export function brandIssues(fields) {
  const issues = [];
  const all = [fields.eyebrow, fields.head, fields.body, fields.footer, fields.name, fields.role, fields.note, fields.button, fields.items].filter(Boolean).join('\n');
  if (/!/.test(all)) issues.push('Exclamation marks are not used.');
  if (/\p{Extended_Pictographic}/u.test(all)) issues.push('Emoji are not used.');
  return issues;
}
