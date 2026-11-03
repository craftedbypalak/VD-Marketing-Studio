// Status rule card, 1080 x 1920. [pictures]
// One line on navy, the way a WhatsApp Status is read. Text stays inside the
// safe zone: 65 px at the sides, 250 px clear at the top and 340 px at the
// bottom (the Reel and Status buttons), so nothing sits under the app's own
// controls.

import { stackCard, pieceText, TAGLINE } from './_kit.js';

const W = 1080;
const H = 1920;
const SAFE = { side: 65, top: 250, bottom: 340 };

export const meta = {
  id: 'statusRule',
  label: 'Status rule',
  note: 'WhatsApp Status. Text kept clear of 250 px at the top and 340 px at the bottom.',
  formats: [{ id: 'default', label: '1080 x 1920', w: W, h: H }],
  defaultTheme: 'navy',
  fields: [
    { key: 'eyebrow', label: 'Eyebrow', type: 'text', hint: 'A few words, shown in small capitals.' },
    { key: 'head', label: 'Headline', type: 'textarea', rows: 3, hint: 'Put *stars* around the one word that should be lime.' },
    { key: 'body', label: 'Body (optional)', type: 'textarea', rows: 2 },
    { key: 'footer', label: 'Footer line', type: 'text', hint: 'Shown on the right, beside the logo.' },
  ],
  defaults: {
    eyebrow: 'A rule for the week',
    head: 'Run the business. Not the *follow-ups*.',
    body: '',
    footer: TAGLINE,
  },
  supportsImage: false,
  fromPiece(piece) {
    const t = pieceText(piece);
    return {
      head: t.close || t.status || t.hook,
      body: '',
    };
  },
};

export function size() { return { w: W, h: H }; }

export function render(fields, theme = 'navy', opts = {}) {
  return stackCard({
    w: W, h: H, theme, fields, opts,
    padX: SAFE.side,
    eyebrow: { y: SAFE.top + 56, size: 28 },
    zone: { top: SAFE.top + 160, bottom: H - SAFE.bottom - 150 },
    align: 'center',
    head: { max: 156, min: 76, line: 1.05, maxLines: 7 },
    body: { max: 50, min: 34, line: 1.4, maxLines: 5, maxH: 330 },
    gap: 56,
    image: null,
    footer: { ruleY: H - SAFE.bottom - 112, logoTop: H - SAFE.bottom - 80, logoH: 56, size: 30 },
  });
}

export default render;
