// Hook card, 1080 x 1080 and 1080 x 1350. [pictures]
// The first line of a post, large. The square carries the headline only (as
// the video kit does); the portrait adds a short body line and can carry an
// illustration.

import { stackCard, pieceText, TAGLINE } from './_kit.js';

const SIZES = { square: { w: 1080, h: 1080 }, portrait: { w: 1080, h: 1350 } };

export const meta = {
  id: 'hook',
  label: 'Hook',
  note: 'Square for the feed and LinkedIn; portrait for Instagram 4:5. The body line shows on the portrait only.',
  formats: [
    { id: 'square', label: 'Square 1080 x 1080', ...SIZES.square },
    { id: 'portrait', label: 'Portrait 1080 x 1350', ...SIZES.portrait },
  ],
  defaultTheme: 'navy',
  fields: [
    { key: 'eyebrow', label: 'Eyebrow', type: 'text' },
    { key: 'head', label: 'Headline', type: 'textarea', rows: 3, hint: 'Eight words or fewer. Put *stars* around the one word that should be lime.' },
    { key: 'body', label: 'Body (portrait only)', type: 'textarea', rows: 2 },
    { key: 'footer', label: 'Footer line', type: 'text' },
  ],
  defaults: {
    eyebrow: 'For owners who do the chasing',
    head: 'You are the *follow-up* department',
    body: 'Calls and messages all day, just to ask: is it done?',
    footer: TAGLINE,
  },
  supportsImage: true,
  fromPiece(piece) {
    const t = pieceText(piece);
    return { head: t.hook || t.close, body: t.problem };
  },
};

export function size(fields) { return SIZES[fields?.format] || SIZES.square; }

export function render(fields, theme = 'navy', opts = {}) {
  const { w, h } = size(fields);
  if (h === 1080) {
    return stackCard({
      w, h, theme, fields: { ...fields, imageData: null, body: '' }, opts,
      padX: 72,
      eyebrow: { y: 76, size: 26 },
      zone: { top: 150, bottom: 900 },
      align: 'center',
      head: { max: 136, min: 64, line: 1.04, maxLines: 6 },
      body: null, gap: 40, image: null,
      footer: { ruleY: 936, logoTop: 964, logoH: 52, size: 28 },
    });
  }
  return stackCard({
    w, h, theme, fields, opts,
    padX: 72,
    eyebrow: { y: 76, size: 26 },
    zone: { top: 160, bottom: 1170 },
    align: 'center',
    head: { max: 128, min: 62, line: 1.04, maxLines: 6 },
    body: { max: 46, min: 32, line: 1.4, maxLines: 4, maxH: 260 },
    gap: 44,
    image: { minH: 300 },
    footer: { ruleY: 1210, logoTop: 1238, logoH: 52, size: 28 },
  });
}

export default render;
