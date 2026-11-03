// LinkedIn image post, 1200 x 1500. [pictures]
// A 4:5 image for a LinkedIn feed post: a headline, a short body, and an
// optional illustration. Larger margins than the Instagram cards, because
// LinkedIn crops the feed image a little on desktop.

import { stackCard, pieceText, TAGLINE, footerFor } from './_kit.js';

const W = 1200;
const H = 1500;

export const meta = {
  id: 'linkedinImage',
  label: 'LinkedIn image',
  note: '4:5 for a LinkedIn post. One idea, one headline.',
  formats: [{ id: 'default', label: '1200 x 1500', w: W, h: H }],
  defaultTheme: 'light',
  fields: [
    { key: 'eyebrow', label: 'Eyebrow', type: 'text' },
    { key: 'head', label: 'Headline', type: 'textarea', rows: 3, hint: 'Put *stars* around the one word that should be highlighted.' },
    { key: 'body', label: 'Body', type: 'textarea', rows: 3 },
    { key: 'footer', label: 'Footer line', type: 'text' },
  ],
  defaults: {
    eyebrow: 'A five-minute sum',
    head: 'What is your *hour* worth?',
    body: 'Take home, divided by the hours you work. Then count the hours you spend chasing. These are example numbers.',
    footer: TAGLINE,
  },
  supportsImage: true,
  fromPiece(piece) {
    const t = pieceText(piece);
    return { head: t.hook || t.close, body: t.impact || t.problem };
  },
};

export function size() { return { w: W, h: H }; }

export function render(input, theme = 'light', opts = {}) {
  const fields = { ...input, footer: input.footer ?? footerFor(meta) };
  return stackCard({
    w: W, h: H, theme, fields, opts,
    padX: 88,
    eyebrow: { y: 100, size: 28 },
    zone: { top: 200, bottom: 1290 },
    align: 'center',
    head: { max: 132, min: 64, line: 1.04, maxLines: 6 },
    body: { max: 50, min: 34, line: 1.4, maxLines: 5, maxH: 330 },
    gap: 48,
    image: { minH: 320 },
    footer: { ruleY: 1336, logoTop: 1372, logoH: 56, size: 30 },
  });
}

export default render;
