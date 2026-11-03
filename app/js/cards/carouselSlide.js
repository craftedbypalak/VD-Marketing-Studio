// Carousel slide, 1080 x 1350, in the video kit's four slide types. [pictures]
// cover, point, list and cta follow Marketing/social-animations/engine/carousel.html:
// cover and cta on navy, point and list on the light surface, unless a theme is
// chosen. The wordmark and tagline sit in the footer; the count is top right.

import {
  palette, fit, textLines, textAt, eyebrow, footer, frame, warn, F, COLOR, TAGLINE, pieceText, round, textWidth, parseRich,
} from './_kit.js';

const W = 1080;
const H = 1350;
const PAD = 72;
const INNER = W - 2 * PAD;

export const TYPES = [
  { id: 'cover', label: 'Cover' },
  { id: 'point', label: 'Point' },
  { id: 'list', label: 'List' },
  { id: 'cta', label: 'Call to action' },
];

export const meta = {
  id: 'carouselSlide',
  label: 'Carousel slide',
  note: 'The four slide types of the carousel kit. "Kit pattern" puts the cover and call to action on navy and the rest on light.',
  formats: [{ id: 'default', label: '1080 x 1350', w: W, h: H }],
  defaultTheme: 'auto',
  themes: ['auto', 'navy', 'light'],
  fields: [
    { key: 't', label: 'Slide type', type: 'select', options: TYPES.map((t) => ({ value: t.id, label: t.label })) },
    { key: 'eyebrow', label: 'Eyebrow (cover)', type: 'text', show: (f) => f.t === 'cover' },
    { key: 'n', label: 'Number or word', type: 'text', hint: 'A number, or a word such as Before or After.', show: (f) => f.t === 'point' },
    { key: 'head', label: 'Headline', type: 'textarea', rows: 3, hint: 'Put *stars* around the one word that should be yellow.' },
    { key: 'body', label: 'Body', type: 'textarea', rows: 3, show: (f) => f.t === 'point' || f.t === 'cta' },
    { key: 'items', label: 'List items (one per line, three at most)', type: 'textarea', rows: 4, show: (f) => f.t === 'list' },
    { key: 'button', label: 'Button text', type: 'text', hint: 'Leave empty for no button.', show: (f) => f.t === 'cta' },
    { key: 'note', label: 'Line above the footer', type: 'text', show: (f) => f.t === 'cta' },
    { key: 'index', label: 'Slide number', type: 'number' },
    { key: 'total', label: 'Slides in all', type: 'number' },
    { key: 'footer', label: 'Footer line', type: 'text' },
  ],
  defaults: {
    t: 'point', eyebrow: 'For owners who do the chasing', n: '1',
    head: 'You are the *follow-up* department',
    body: 'Calls and messages all day, just to ask: is it done?',
    items: 'One list of every open task\nA reminder that goes out by itself\nA weekly sit-down, not a daily chase',
    button: 'Book a 30-minute call', note: 'Book a 30-minute call. Link in the comments.',
    index: 2, total: 7, footer: TAGLINE,
  },
  supportsImage: false,
  /** A slide of the piece (4.1 slides) as fields. `slide` is a zero-based index. */
  fromPiece(piece, { slide = 0 } = {}) {
    const slides = pieceText(piece).slides;
    const s = slides[Math.min(Math.max(slide, 0), Math.max(slides.length - 1, 0))];
    if (!s) return { head: piece?.hook || '' };
    return {
      t: s.t || 'point', eyebrow: s.eyebrow || '', n: s.n != null ? String(s.n) : '', head: s.head || '', body: s.body || '',
      items: Array.isArray(s.items) ? s.items.join('\n') : '', note: s.foot || '',
      index: slides.indexOf(s) + 1, total: slides.length,
    };
  },
};

export function size() { return { w: W, h: H }; }

/** 'auto' follows the kit: cover and cta navy, point and list light. */
export function resolveTheme(fields, theme) {
  if (theme === 'navy' || theme === 'light') return theme;
  return fields.t === 'cover' || fields.t === 'cta' ? 'navy' : 'light';
}

function numberChip(pal, str, y) {
  const isNum = /^\d+$/.test(String(str).trim());
  const label = String(str).trim();
  if (!label) return { svg: '', height: 0 };
  if (isNum) {
    const tw = textWidth(label, F.mono, 72);
    const w = Math.max(132, tw + 68);
    return {
      height: 132,
      svg: `<rect x="${PAD}" y="${round(y)}" width="${round(w)}" height="132" rx="66" fill="${COLOR.yellow}"/>` +
        textAt({ str: label, x: PAD + w / 2, y: y + 132 / 2 + 72 * 0.35, f: F.mono, size: 72, fill: COLOR.navy, anchor: 'middle' }),
    };
  }
  const up = label.toUpperCase();
  const tw = textWidth(up, { ...F.strong, ls: 0.06 }, 38);
  const w = tw + 68;
  return {
    height: 84,
    svg: `<rect x="${PAD}" y="${round(y)}" width="${round(w)}" height="84" rx="42" fill="${COLOR.yellow}"/>` +
      textAt({ str: up, x: PAD + w / 2, y: y + 42 + 38 * 0.35, f: F.strong, size: 38, fill: COLOR.navy, anchor: 'middle', ls: 38 * 0.06 }),
  };
}

function check(x, y, s) {
  const k = s / 58;
  return `<g transform="translate(${round(x)} ${round(y)}) scale(${round(k)})"><circle cx="29" cy="29" r="29" fill="${COLOR.yellow}"/>` +
    `<path d="M16 30 l9 9 l17 -19" fill="none" stroke="${COLOR.navy}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

export function render(fields, theme = 'auto', opts = {}) {
  const type = TYPES.some((t) => t.id === fields.t) ? fields.t : 'point';
  const pal = palette(resolveTheme({ ...fields, t: type }, theme));
  const bodyTop = 150;
  const bodyBottom = 1150;
  let svg = '';

  const total = Number(fields.total) || 0;
  const index = Number(fields.index) || 0;
  if (index && total) svg += textAt({ str: `${index} / ${total}`, x: W - PAD, y: 98, f: F.mono, size: 24, fill: pal.muted, anchor: 'end', ls: 1 });

  // Lays out a stack of blocks, centred in the body zone. Each block is { h, draw(y) }.
  const stack = (blocks, gap, top = bodyTop, bottom = bodyBottom) => {
    const total = blocks.reduce((s, b) => s + b.h, 0) + gap * (blocks.length - 1);
    let y = top + Math.max(0, (bottom - top - total) / 2);
    if (total > bottom - top) warn(opts, 'There is too much text for this slide. Shorten it.');
    for (const b of blocks) { svg += b.draw(y); y += b.h + gap; }
  };
  const headBlock = (max, line, maxH, min = 56) => {
    const f = fit(fields.head, F.head, { maxW: INNER, maxH, max, min, line, maxLines: 8 });
    if (f.overflow) warn(opts, 'The headline is too long for this slide. Shorten it.');
    return { h: f.height, draw: (y) => textLines({ lines: f.lines, x: PAD, y, size: f.size, lineH: f.lineH, f: F.head, fill: pal.ink, starFill: pal.star }) };
  };
  const bodyBlock = (maxH) => {
    if (!fields.body) return null;
    const f = fit(fields.body, F.body, { maxW: INNER, maxH, max: 46, min: 30, line: 1.4, maxLines: 6, balance: true });
    if (f.overflow) warn(opts, 'The body text is too long for this slide. Shorten it.');
    return { h: f.height, draw: (y) => textLines({ lines: f.lines, x: PAD, y, size: f.size, lineH: f.lineH, f: F.body, fill: pal.body, starFill: pal.star }) };
  };

  let footerOpts = { w: W, padX: PAD, ruleY: 1210, logoTop: 1246, logoH: 52, tagline: fields.footer ?? TAGLINE };

  if (type === 'cover') {
    const ey = fields.eyebrow ? { h: 26, draw: (y) => eyebrow(pal, { x: PAD, y, text: fields.eyebrow, size: 26, maxW: INNER }).svg } : null;
    stack([ey, headBlock(132, 1.02, 700, 64)].filter(Boolean), 44, bodyTop, 1090);
    // Swipe cue.
    const cue = pal.eyebrow;
    svg += textAt({ str: 'SWIPE', x: PAD, y: 1148, f: F.label, size: 26, fill: cue, ls: 26 * 0.1 });
    svg += `<path d="M${PAD + 118} 1138h40M${PAD + 148} 1129l10 9-10 9" fill="none" stroke="${cue}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (type === 'point') {
    const chip = fields.n ? numberChip(pal, fields.n, 0) : null;
    stack([
      chip && { h: chip.height, draw: (y) => numberChip(pal, fields.n, y).svg },
      headBlock(100, 1.04, 420, 56),
      bodyBlock(300),
    ].filter(Boolean), 44);
  } else if (type === 'list') {
    const items = String(fields.items || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 4);
    if (String(fields.items || '').split('\n').filter((s) => s.trim()).length > 3) warn(opts, 'The kit shows three list items at most.');
    const textX = PAD + 34 + 54 + 26;
    const textW = W - PAD - 34 - textX;
    const laid = items.map((t) => {
      const f = fit(t, { ...F.tag }, { maxW: textW, maxH: 140, max: 40, min: 28, line: 1.3, maxLines: 3, balance: false });
      return { f, h: Math.max(114, f.height + 56) };
    });
    const blocks = [headBlock(92, 1.04, 330, 52)];
    laid.forEach((it) => blocks.push({
      h: it.h,
      draw: (y) => `<rect x="${PAD}" y="${round(y)}" width="${INNER}" height="${round(it.h)}" rx="24" fill="#ffffff" stroke="${COLOR.border}" stroke-width="2"/>` +
        check(PAD + 34, y + it.h / 2 - 27, 54) +
        textLines({ lines: it.f.lines, x: textX, y: y + (it.h - it.f.height) / 2, size: it.f.size, lineH: it.f.lineH, f: F.tag, fill: COLOR.navy, starFill: COLOR.yellowInk }),
    }));
    stack(blocks, 24);
  } else {
    // cta
    const blocks = [headBlock(104, 1.04, 430, 56), bodyBlock(240)].filter(Boolean);
    const label = String(fields.button || '').trim();
    if (label) {
      const tw = textWidth(label, F.strong, 40);
      const bw = tw + 92;
      blocks.push({ h: 100, draw: (y) => `<rect x="${PAD}" y="${round(y)}" width="${round(bw)}" height="100" rx="16" fill="${COLOR.yellow}"/>` +
        textAt({ str: label, x: PAD + bw / 2, y: y + 50 + 40 * 0.35, f: F.strong, size: 40, fill: COLOR.navy, anchor: 'middle' }) });
    }
    stack(blocks, 40, bodyTop, fields.note ? 1060 : 1150);
    if (fields.note) {
      let s = 28;
      while (s > 18 && textWidth(fields.note, F.tag, s) > INNER) s -= 1;
      svg += textAt({ str: fields.note, x: PAD, y: 1126, f: F.tag, size: s, fill: pal.muted });
    }
    footerOpts = { ...footerOpts, sub: 'A venture by VSP' };
  }

  svg += footer(pal, footerOpts);
  return frame({ w: W, h: H, pal, body: svg, opts });
}

export default render;
