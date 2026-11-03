// Quote card, 1080 x 1350. [pictures]
// One sentence, large, with who said it. Used for an owner's own words (with
// permission) or a line from the brief. The quotation mark is drawn as a shape
// in the accent colour; the words are Gilmer.

import {
  COLOR, palette, fit, textLines, textAt, eyebrow, footer, frame, warn, F, TAGLINE, pieceText, round, textWidth, footerFor,
} from './_kit.js';

const W = 1080;
const H = 1350;
const PAD = 72;

export const meta = {
  id: 'quote',
  label: 'Quote',
  note: 'An owner\'s words or a line from the brief, with who said it.',
  formats: [{ id: 'default', label: '1080 x 1350', w: W, h: H }],
  defaultTheme: 'navy',
  fields: [
    { key: 'eyebrow', label: 'Eyebrow', type: 'text' },
    { key: 'head', label: 'Quote', type: 'textarea', rows: 4, hint: 'Put *stars* around the one word that should be green. Quotation marks are drawn for you.' },
    { key: 'name', label: 'Said by', type: 'text', hint: 'Only with permission; otherwise write a role, such as "An owner in Indore".' },
    { key: 'role', label: 'Role or place (optional)', type: 'text' },
    { key: 'footer', label: 'Footer line', type: 'text' },
  ],
  defaults: {
    eyebrow: 'In an owner\'s words',
    head: 'I do not need another report. I need to know it is *done*.',
    name: 'An owner in Indore',
    role: 'Manufacturing, 40 people',
    footer: TAGLINE,
  },
  supportsImage: false,
  fromPiece(piece) {
    const t = pieceText(piece);
    return { head: t.close || t.hook, name: '', role: '' };
  },
};

export function size() { return { w: W, h: H }; }

// Two filled quotation marks as paths (a circle head and a tapering tail each).
function quoteMark(x, y, s, fill) {
  const one = (ox) => `<g transform="translate(${round(ox)} ${round(y)}) scale(${s})"><path d="M0 40C0 17 14 2 38 0l4 9C28 13 22 20 22 30c12 0 20 8 20 20 0 13-9 22-22 22C7 72 0 60 0 40Z" fill="${fill}"/></g>`;
  return one(x) + one(x + 58 * s);
}

export function render(fields, theme = 'navy', opts = {}) {
  const pal = palette(theme);
  const innerW = W - 2 * PAD;
  let svg = '';

  svg += eyebrow(pal, { x: PAD, y: 88, text: fields.eyebrow, size: 26, maxW: innerW }).svg;

  const mark = pal.theme === 'light' ? pal.star : pal.eyebrow;
  svg += quoteMark(PAD, 196, 1.75, mark);

  const q = fit(fields.head, F.head, { maxW: innerW, maxH: 560, max: 96, min: 54, line: 1.12, maxLines: 8 });
  if (q.overflow) warn(opts, 'The quote is too long for this template. Shorten it.');
  const qTop = 360;
  svg += textLines({ lines: q.lines, x: PAD, y: qTop, size: q.size, lineH: q.lineH, f: F.head, fill: pal.ink, starFill: pal.star });

  // Attribution: a short accent bar, then the name and the role.
  const aTop = Math.max(qTop + q.height + 56, 900);
  if (fields.name || fields.role) {
    svg += `<rect x="${PAD}" y="${round(aTop)}" width="64" height="6" rx="3" fill="${pal.theme === 'light' ? pal.star : COLOR.accent}"/>`;
    let y = aTop + 62;
    if (fields.name) {
      let s = 38;
      while (s > 22 && textWidth(fields.name, F.strong, s) > innerW) s -= 1;
      svg += textAt({ str: fields.name, x: PAD, y, f: F.strong, size: s, fill: pal.ink });
      y += 48;
    }
    if (fields.role) {
      let s = 32;
      while (s > 20 && textWidth(fields.role, F.body, s) > innerW) s -= 1;
      svg += textAt({ str: fields.role, x: PAD, y, f: F.body, size: s, fill: pal.body });
    }
  }
  if (aTop > 1120) warn(opts, 'The quote runs into the footer. Shorten it.');

  svg += footer(pal, { w: W, h: H, padX: PAD, ruleY: 1210, logoTop: 1240, logoH: 52, tagline: fields.footer ?? footerFor(meta) });
  return frame({ w: W, h: H, pal, body: svg, opts });
}

export default render;
