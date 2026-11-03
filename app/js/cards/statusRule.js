// Status rule card, 1080 x 1920. [pictures]
// One line on navy, the way a WhatsApp Status is read. Text stays inside the
// safe zone: 65 px at the sides, 250 px clear at the top and 340 px at the
// bottom (the Reel and Status buttons), so nothing sits under the app's own
// controls.

import { stackCard, pieceText, TAGLINE, footerFor } from './_kit.js';

const W = 1080;
const H = 1920;
const SAFE = { side: 65, top: 250, bottom: 340 };
// The logo sits on the safe zone's bottom line, at a fixed size; the text zone ends above the rule.
const LOGO_H = 56;
const LOGO_TOP = H - SAFE.bottom - LOGO_H;   // 1524: bottom edge 1580
const RULE_Y = LOGO_TOP - 32;

export const meta = {
  id: 'statusRule',
  label: 'Status rule',
  note: 'WhatsApp Status. Text clear of 250 px at the top and 340 px at the bottom. Logo on the safe zone line.',
  formats: [{ id: 'default', label: '1080 x 1920', w: W, h: H }],
  defaultTheme: 'navy',
  fields: [
    { key: 'eyebrow', label: 'Eyebrow', type: 'text', hint: 'A few words, shown in small capitals.' },
    { key: 'head', label: 'Headline', type: 'textarea', rows: 3, hint: 'Put *stars* around the one word that should be green.' },
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
    w: W, h: H, theme, fields: { ...fields, footer: fields.footer ?? footerFor(meta) }, opts,
    padX: SAFE.side,
    eyebrow: { y: SAFE.top + 56, size: 28 },
    zone: { top: SAFE.top + 160, bottom: RULE_Y - 38 },
    align: 'center',
    head: { max: 156, min: 76, line: 1.05, maxLines: 7 },
    body: { max: 50, min: 34, line: 1.4, maxLines: 5, maxH: 330 },
    gap: 56,
    image: null,
    footer: { ruleY: RULE_Y, logoTop: LOGO_TOP, logoH: LOGO_H, size: 30, limit: H - SAFE.bottom },
  });
}

export default render;
