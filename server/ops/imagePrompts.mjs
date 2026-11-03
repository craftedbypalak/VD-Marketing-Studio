// imagePrompts [pictures]: a piece -> one illustration prompt and card texts.
// Input { piece, kind? }: kind is 'cover' | 'thumbnail' | 'illustration' (default 'cover').
// Output { scene, altText, cards: [ { template, eyebrow, head, body } ], prefix, prompt }.
// The house-style prefix comes from settings.illustrationPrefix and is joined
// to the scene in postProcess, so the model only ever describes the subject.

import { registerParagraph } from './_shared.mjs';

export const name = 'imagePrompts';
export const description = 'Writes the prompt for one flat illustration and the texts for the brand cards of a piece.';
export const inputFields = ['piece', 'kind'];

export const DEFAULT_PREFIX =
  'Flat vector illustration, navy #0a3050 with a small green #8ace8a accent on white or navy, soft corners, no gradients, no text, ' +
  'no faces drawn as real people, never a screen, sheet or phone drawn as a real product screenshot';

export const CARD_TEMPLATES = ['statusRule', 'quote', 'hook', 'thumbnail', 'carouselSlide', 'linkedinImage'];

export const prefixFor = (settings) => String(settings?.illustrationPrefix || '').trim() || DEFAULT_PREFIX;

/** The full prompt sent to a provider: the locked house style, then the subject. */
export function composePrompt(prefix, scene) {
  const head = String(prefix || '').trim().replace(/[.\s]+$/, '');
  const body = String(scene || '').trim();
  if (!body) return head + '.';
  if (body.toLowerCase().startsWith(head.toLowerCase())) return body;
  return `${head}. ${body}`;
}

function pieceBrief(piece = {}) {
  const pis = piece.pis || {};
  const lines = [];
  const add = (label, value) => { if (value && String(value).trim()) lines.push(`${label}: ${Array.isArray(value) ? value.join(' / ') : value}`); };
  add('Type', piece.type);
  add('Pillar', piece.pillar);
  add('Hook', piece.hook);
  add('Problem', pis.problem);
  add('Impact', pis.impact);
  add('Solution', pis.solution);
  add('Close', pis.close);
  if (Array.isArray(piece.slides) && piece.slides.length) {
    add('Slides', piece.slides.map((s, i) => `${i + 1}. ${[s.eyebrow, s.head, s.body].filter(Boolean).join(' - ')}`).join('\n'));
  }
  add('YouTube title', piece.renditions?.yt?.title);
  return lines.join('\n');
}

export function buildPrompt(input, ctx) {
  const kind = ['cover', 'thumbnail', 'illustration'].includes(input?.kind) ? input.kind : 'cover';
  const piece = input?.piece || {};
  const system =
    registerParagraph(ctx, piece.type) +
    '\n\nYou prepare the pictures for one post. Return two things.\n\n' +
    '1. "scene": the subject of ONE flat illustration for the ' + kind + ', in two sentences at most and under 60 words. ' +
    'Describe what is drawn and how it is arranged, using plain objects an owner knows (a desk, a tray of papers, a clock, a row of doors, a calendar, a key). ' +
    'One idea only: the problem in the piece, or the relief after it. Do not describe the style, the colours or the medium: Studio adds the house style itself. ' +
    'No text, letters, numbers or logos in the picture. No people drawn as real individuals. Never a screen, a sheet or a phone drawn as a real product screenshot. No emoji.\n' +
    '2. "altText": one plain sentence describing the picture for someone who cannot see it.\n' +
    '3. "cards": the text for the brand cards, one entry per template in this list: ' + CARD_TEMPLATES.join(', ') + '. ' +
    'Only include "quote" if the piece contains an owner\'s own words in quotation marks; otherwise leave it out. ' +
    'For each card: "eyebrow" (four words or fewer, may be empty), "head" (eight words or fewer for statusRule, hook and thumbnail; five or fewer for thumbnail; ' +
    'put asterisks around exactly one word to highlight it, for example: Run the business. Not the *follow-ups*.), "body" (one short line, may be empty). ' +
    'Take the wording from the piece; do not invent facts or figures. For a statusRule prefer the close line. For a thumbnail prefer the YouTube title. ' +
    'No exclamation marks, no emoji, sentence case.';
  const user = `The piece:\n${pieceBrief(piece) || '(no text yet)'}`;
  return { system, user };
}

export const schema = {
  type: 'object',
  properties: {
    scene: { type: 'string', description: 'The subject of one flat illustration, under 60 words, no style words' },
    altText: { type: 'string', description: 'One plain sentence describing the picture' },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          template: { type: 'string', enum: CARD_TEMPLATES },
          eyebrow: { type: 'string' },
          head: { type: 'string', description: 'One *starred* word marks the green highlight' },
          body: { type: 'string' },
        },
        required: ['template', 'eyebrow', 'head', 'body'],
        additionalProperties: false,
      },
    },
  },
  required: ['scene', 'altText', 'cards'],
  additionalProperties: false,
};

const clean = (s) => String(s ?? '')
  .replace(/!/g, '.')
  .replace(/\p{Extended_Pictographic}/gu, '')
  .replace(/\s+\n/g, '\n')
  .trim();

export function postProcess(output, input, ctx) {
  const prefix = prefixFor(ctx?.settings);
  const scene = clean(output.scene);
  return {
    ...output,
    scene,
    altText: clean(output.altText),
    cards: (output.cards || []).map((c) => ({ ...c, eyebrow: clean(c.eyebrow), head: clean(c.head), body: clean(c.body) })),
    prefix,
    prompt: composePrompt(prefix, scene),
  };
}
