// Festival greeting card. [pictures]
// The branded greeting for an occasion: "Happy *Diwali*", the wish in one or two
// lines, and the logo. Status (1080 x 1920, safe zones kept clear) or a square
// post (1080 x 1080). Built from the occasion by greetingFields() below.

import { stackCard, TAGLINE } from './_kit.js';

const FORMATS = {
  status: { id: 'status', label: 'Status 1080 x 1920', w: 1080, h: 1920 },
  square: { id: 'square', label: 'Post 1080 x 1080', w: 1080, h: 1080 },
};

const SIGNATURE = /\s*Palak Gupta,?\s*Venture Drafters\.?\s*$/i;

/** The headline for an occasion, in its customary form; the starred words show in green. */
export function headlineFor(name) {
  const n = String(name || '').trim();
  if (/^Eid/i.test(n)) return `*${n.replace(/\s*Mubarak$/i, '')}* Mubarak`;
  if (/^Ramadan/i.test(n)) return 'Ramadan *Kareem*';
  if (/^(Republic Day|Independence Day)/i.test(n)) return `Happy *${n}*`;
  if (/Jayanti|Foundation Day|Purnima|Puja|Chaturthi|Navratri|Dussehra|Diwali|Holi|Dhanteras|Christmas|New Year|Sankranti|Lohri|Onam|Padwa|Bandhan|Janmashtami|Navami|Tritiya|Panchami|Shivaratri|Easter|Gurpurab/i.test(n)) return `Happy *${n}*`;
  return `*${n}*`;
}

/** Fields for an occasion: { name, greetingText }. */
export function greetingFields(ev, format = 'status') {
  const name = ev.shortName || ev.name || '';
  return {
    eyebrow: 'Warm wishes',
    head: headlineFor(name),
    body: String(ev.greetingText || '').replace(SIGNATURE, '').trim(),
    footer: TAGLINE,
    format,
  };
}

export const meta = {
  id: 'festivalGreeting',
  label: 'Festival greeting',
  note: 'The greeting for a festival or national day. Status or a square post.',
  formats: [FORMATS.status, FORMATS.square],
  defaultTheme: 'navy',
  fields: [
    { key: 'eyebrow', label: 'Eyebrow', type: 'text' },
    { key: 'head', label: 'Headline', type: 'text', hint: 'Put *stars* around the festival name to show it in green.' },
    { key: 'body', label: 'Wish', type: 'textarea', rows: 3 },
    { key: 'footer', label: 'Footer line', type: 'text' },
  ],
  defaults: greetingFields({ shortName: 'Diwali', greetingText: 'Wishing you and your family a joyous and prosperous Diwali and a successful new year of business.' }),
  supportsImage: false,
  fromPiece(piece) {
    const text = piece?.renditions?.waStatus?.text || piece?.renditions?.li?.text || '';
    return greetingFields({ shortName: piece?.hook || '', greetingText: text });
  },
};

export function size(fields = {}) {
  const f = FORMATS[fields.format] || FORMATS.status;
  return { w: f.w, h: f.h };
}

export function render(fields, theme = 'navy', opts = {}) {
  const { w, h } = size(fields);
  if (h === 1920) {
    return stackCard({
      w, h, theme, fields, opts, padX: 72, align: 'center',
      eyebrow: { y: 310, size: 28 },
      zone: { top: 420, bottom: 1420 },
      head: { max: 150, min: 80, line: 1.05, maxLines: 4 },
      body: { max: 46, min: 32, line: 1.4, maxLines: 5, maxH: 300 },
      gap: 56, image: null,
      footer: { ruleY: 1468, logoTop: 1500, logoH: 56, size: 28 },
    });
  }
  return stackCard({
    w, h, theme, fields, opts, padX: 80, align: 'center',
    eyebrow: { y: 120, size: 26 },
    zone: { top: 190, bottom: 860 },
    head: { max: 128, min: 70, line: 1.05, maxLines: 3 },
    body: { max: 40, min: 28, line: 1.4, maxLines: 4, maxH: 220 },
    gap: 44, image: null,
    footer: { ruleY: 910, logoTop: 942, logoH: 52, size: 26 },
  });
}

export default render;
