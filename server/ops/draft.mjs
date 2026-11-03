// draft: a Problem, Impact, Solution set + type + targets -> a full piece. [content]
// Input { pis, type, targets[], hook?, pillar?, existing?, notes? } ->
//   output { hook, renditions (only for the given targets), script (broll, youtube-long), slides (carousel types) }

import { registerParagraph } from './_shared.mjs';
import {
  renditionsSchema, scriptSchema, slidesSchema, renditionKeysFor, renditionBrief, typeBrief, limitsParagraph,
  cleanRenditions, cleanScript, cleanSlides, TYPE_LABEL, pieceJson,
} from './_content.mjs';

export const name = 'draft';
export const description = 'Turns a Problem, Impact, Solution set into a full piece: the form for each target account, plus the say-and-sees script for video types and the slides for carousels.';
export const inputFields = ['pis', 'type', 'targets', 'hook', 'pillar', 'existing', 'notes'];

const SCRIPT_TYPES = ['broll', 'youtube-long'];
const SLIDE_TYPES = ['carousel', 'linkedin-carousel'];

const SHOT_CODES =
  'Shot codes: A you to camera at your desk; P1 phone chat list scrolling, names masked; P2 thumb typing "Is it done?"; P3 lock screen with unread messages; ' +
  'D1 sticky notes and a diary; D2 hands writing a task in a diary; D3 desk at 7 pm; O1 office wide from behind; O2 a phone ringing on a desk; O3 over a shoulder at a masked sheet; ' +
  'S1 screen recording of a real sheet, masked; S2 the dashboard, masked; S3 a reminder the system sent, masked; S4 a blank Google Sheet; ' +
  'K1 pen sketching boxes and arrows; K2 a design notebook; K3 a task written down with a name, a date and a next step; N an animation from the kit; E the end card.';

export function buildPrompt(input = {}, ctx = {}) {
  const type = String(input.type || 'reel-animated');
  const targets = Array.isArray(input.targets) && input.targets.length ? input.targets : ['vd-ig'];
  const keys = renditionKeysFor(targets);
  const wantScript = SCRIPT_TYPES.includes(type);
  const wantSlides = SLIDE_TYPES.includes(type);
  const pis = input.pis || {};
  const system =
    registerParagraph(ctx, type) +
    `\n\nTask: draft a complete "${TYPE_LABEL[type] || type}" piece from the Problem, Impact, Solution set given. ${typeBrief(type)}\n` +
    `Write the renditions for these accounts only, and no others: ${keys.join(', ') || 'none'}.\n` +
    renditionBrief(keys, ctx.rules) + '\n' +
    (wantScript ? `Also write the script: rows of say and sees. ${SHOT_CODES}\n` : 'Do not write a script.\n') +
    (wantSlides ? 'Also write the slides: seven slides, one cover, the points, then a closing cta. Put one word or short phrase of each head in *stars*. Do not write a script.\n' : 'Do not write slides.\n') +
    'Keep the order Problem, Impact, Solution. The hook is eight words or fewer. If a hook is given, keep it unless it breaks a rule.\n' +
    limitsParagraph(ctx.rules);
  const user =
    `Type: ${type}\nTargets: ${targets.join(', ')}\n` +
    (input.pillar ? `Pillar: ${input.pillar}\n` : '') +
    (input.hook ? `Hook: ${input.hook}\n` : '') +
    `Problem: ${pis.problem || ''}\nImpact: ${pis.impact || ''}\n` +
    `Solution: ${(Array.isArray(pis.solution) ? pis.solution : [pis.solution].filter(Boolean)).join(' | ')}\nClose: ${pis.close || ''}\n` +
    (input.notes ? `Notes from the owner of the piece: ${input.notes}\n` : '') +
    (input.existing ? `\nThe piece as it stands (keep consistent with it; write only what is missing):\n${pieceJson(input.existing)}\n` : '');
  return { system, user };
}

export const schema = {
  type: 'object',
  properties: {
    hook: { type: 'string', description: 'Eight words or fewer' },
    renditions: renditionsSchema,
    script: scriptSchema,
    slides: slidesSchema,
  },
  required: ['hook', 'renditions'],
  additionalProperties: false,
};

export function postProcess(output, input = {}) {
  const type = String(input.type || 'reel-animated');
  const keys = renditionKeysFor(Array.isArray(input.targets) && input.targets.length ? input.targets : ['vd-ig']);
  const out = {
    hook: String(output.hook || input.hook || '').trim(),
    renditions: cleanRenditions(output.renditions, keys),
  };
  if (SCRIPT_TYPES.includes(type)) out.script = cleanScript(output.script) || [];
  if (SLIDE_TYPES.includes(type)) out.slides = cleanSlides(output.slides) || [];
  return out;
}
