// refine: a piece + an instruction -> new text + a change note. [content]
// Input { piece, instruction, standing? } -> output { changeNote, noChange, changed, changedFields[], patch{...} }
// `patch` holds the full merged value of every text field the model changed, ready to PUT.

import { registerParagraph } from './_shared.mjs';
import {
  pisSchema, renditionsSchema, scriptSchema, slidesSchema, pieceJson, limitsParagraph, typeBrief,
  cleanPis, cleanRenditions, cleanScript, cleanSlides, TYPE_LABEL,
} from './_content.mjs';

export const name = 'refine';
export const description = 'Applies an instruction to a piece and returns the revised text with a change note. Changes as little as possible.';
export const inputFields = ['piece', 'instruction', 'standing'];

export function buildPrompt(input = {}, ctx = {}) {
  const piece = input.piece || {};
  const type = piece.type || 'reel-animated';
  const instruction = String(input.instruction || '').trim() || 'Bring the piece to the register of the brief. Change as little as possible.';
  const system =
    registerParagraph(ctx, type) +
    `\n\nTask: revise one "${TYPE_LABEL[type] || type}" piece according to the instruction. ${typeBrief(type)}\n` +
    'Change as little as possible. Keep every sentence that already follows the brief, word for word. Keep the order Problem, Impact, Solution. ' +
    'Return the full revised value of every text field you return: hook, pis, renditions, script, slides. Leave out a field you did not change. ' +
    'Return renditions only for accounts the piece already has. Keep script rows and slide types in place unless the instruction asks otherwise. ' +
    'If nothing needs to change, set noChange to true, return no fields, and write "No change recommended" followed by one short reason as the changeNote. ' +
    'Otherwise the changeNote is one or two plain sentences saying what changed and why, in the formal register.\n' +
    limitsParagraph(ctx.rules);
  const user = `Instruction:\n${instruction}\n\nThe piece:\n${pieceJson(piece)}`;
  return { system, user };
}

export const schema = {
  type: 'object',
  properties: {
    changeNote: { type: 'string', description: 'One or two sentences; starts with "No change recommended" when nothing changes' },
    noChange: { type: 'boolean' },
    hook: { type: 'string' },
    pis: pisSchema,
    renditions: renditionsSchema,
    script: scriptSchema,
    slides: slidesSchema,
  },
  required: ['changeNote', 'noChange'],
  additionalProperties: false,
};

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function postProcess(output, input = {}) {
  const piece = input.piece || {};
  const patch = {};
  const changedFields = [];
  if (!output.noChange) {
    if (typeof output.hook === 'string' && output.hook.trim() && output.hook.trim() !== (piece.hook || '')) {
      patch.hook = output.hook.trim(); changedFields.push('hook');
    }
    const pis = cleanPis(output.pis);
    if (pis) {
      const merged = { ...(piece.pis || {}), ...pis };
      if (!same(merged, piece.pis)) { patch.pis = merged; changedFields.push('pis'); }
    }
    if (output.renditions) {
      const keys = Object.keys(piece.renditions || {});
      const cleaned = cleanRenditions(output.renditions, keys.length ? keys : null);
      const merged = { ...(piece.renditions || {}) };
      for (const [k, v] of Object.entries(cleaned)) merged[k] = { ...(merged[k] || {}), ...v };
      if (!same(merged, piece.renditions)) { patch.renditions = merged; changedFields.push('renditions'); }
    }
    const script = cleanScript(output.script);
    if (script && script.length && !same(script, piece.script)) { patch.script = script; changedFields.push('script'); }
    const slides = cleanSlides(output.slides);
    if (slides && slides.length && !same(slides, piece.slides)) { patch.slides = slides; changedFields.push('slides'); }
  }
  return {
    changeNote: String(output.changeNote || '').trim() || (changedFields.length ? 'Revised' : 'No change recommended'),
    noChange: Boolean(output.noChange) || changedFields.length === 0,
    changed: changedFields.length > 0,
    changedFields,
    patch,
  };
}
