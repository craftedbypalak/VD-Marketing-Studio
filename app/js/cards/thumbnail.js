// YouTube thumbnail, 1280 x 720. [pictures]
// A few big words, read at the size of a stamp. The wordmark sits bottom left.
// The tagline is off by default because YouTube draws the duration over the
// bottom right corner; type a footer line to bring it back. An illustration,
// when there is one, takes the right-hand panel.

import {
  palette, fit, textLines, eyebrow, footer, frame, imagePanel, warn, F, pieceText, plain,
} from './_kit.js';

const W = 1280;
const H = 720;
const PAD = 72;

export const meta = {
  id: 'thumbnail',
  label: 'YouTube thumbnail',
  note: 'Five words or fewer read best at thumbnail size. The bottom right corner is left clear for the duration badge.',
  formats: [{ id: 'default', label: '1280 x 720', w: W, h: H }],
  defaultTheme: 'navy',
  fields: [
    { key: 'eyebrow', label: 'Eyebrow', type: 'text', hint: 'Four words or fewer.' },
    { key: 'head', label: 'Headline', type: 'textarea', rows: 3, hint: 'Put *stars* around the one word that should be lime.' },
    { key: 'footer', label: 'Footer line (optional)', type: 'text', hint: 'Left empty on purpose: YouTube covers the bottom right corner.' },
  ],
  defaults: {
    eyebrow: 'A case study',
    head: 'One screen. One *sit-down* a week.',
    footer: '',
  },
  supportsImage: true,
  fromPiece(piece) {
    const t = pieceText(piece);
    return { head: t.ytTitle || t.hook, footer: '' };
  },
};

export function size() { return { w: W, h: H }; }

export function render(fields, theme = 'navy', opts = {}) {
  const pal = palette(theme);
  const hasImage = Boolean(fields.imageData);
  const panelX = 700;
  const textW = hasImage ? panelX - PAD - 48 : W - 2 * PAD;
  let svg = '';

  svg += eyebrow(pal, { x: PAD, y: 76, text: fields.eyebrow, size: 28, maxW: textW }).svg;

  const head = fit(fields.head, F.head, {
    maxW: textW, maxH: 400, max: hasImage ? 132 : 176, min: 64, line: 1.02, maxLines: 5,
  });
  if (head.overflow) warn(opts, 'The headline is too long for a thumbnail. Shorten it.');
  if (plain(fields.head).trim().split(/\s+/).filter(Boolean).length > 8) warn(opts, 'More than eight words will be hard to read at thumbnail size.');
  const zoneTop = 150;
  const zoneBottom = 570;
  const top = zoneTop + (zoneBottom - zoneTop - head.height) / 2;
  svg += textLines({ lines: head.lines, x: PAD, y: top, size: head.size, lineH: head.lineH, f: F.head, fill: pal.ink, starFill: pal.star });

  if (hasImage) svg += imagePanel({ id: 'thumb', x: panelX, y: 72, w: W - PAD - panelX, h: 528, href: fields.imageData, pal });

  svg += footer(pal, { w: W, padX: PAD, ruleY: null, logoTop: 622, logoH: 44, tagline: fields.footer || '', size: 26, rule: false });
  return frame({ w: W, h: H, pal, body: svg, opts });
}

export default render;
