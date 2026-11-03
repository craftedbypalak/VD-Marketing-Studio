// check: a piece -> the violations the word lists cannot catch, with fixes, and the manual checklist judged. [content]
// Input { piece } -> output { violations[], checklist[], summary }

import { registerParagraph } from './_shared.mjs';
import { pieceJson, TYPE_LABEL, limitsParagraph } from './_content.mjs';

export const name = 'check';
export const description = 'Reads a piece against the brief and reports what the deterministic checker cannot see: a promised result in other words, a coach\'s tone, a casual aside, a second problem in the impact line, a feature list in place of a scene.';
export const inputFields = ['piece'];

export function buildPrompt(input = {}, ctx = {}) {
  const piece = input.piece || {};
  const type = piece.type || 'reel-animated';
  const manual = (ctx.rules?.checklist || []).filter((c) => !c.auto);
  const system =
    registerParagraph(ctx, type) +
    `\n\nTask: act as the editor of the brief. Read one "${TYPE_LABEL[type] || type}" piece and report only what a list of words cannot catch. ` +
    'Look for: a promised result or saving in other words; a coach\'s or hype tone; a casual aside or slang; a middle beat that is a second problem and not an impact; ' +
    'a solution line that lists features instead of showing a scene, or that says "system" without naming the tool; an opening that starts on us; the business described as running by itself or without people; ' +
    'a claim from the blocked list in other words; a name or firm not on the allowed list. Do not repeat what plain word lists catch (emoji, exclamation marks, hashtag counts, listed phrases). ' +
    'Each violation quotes the offending text exactly, names the rule it breaks, says which field it is in, and gives a fix in the formal register. ' +
    'Severity is "block" for a broken claim rule or a retired line, otherwise "warn". Report nothing you are not sure of.\n' +
    'Then judge each checklist item below as ok or not ok with a short note.\n' +
    manual.map((c) => `- ${c.id}: ${c.text}`).join('\n') + '\n' +
    limitsParagraph(ctx.rules);
  const user = `The piece:\n${pieceJson(piece)}`;
  return { system, user };
}

export const schema = {
  type: 'object',
  properties: {
    violations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string', description: 'The rule broken, in one sentence' },
          severity: { type: 'string', enum: ['block', 'warn'] },
          field: { type: 'string', description: 'For example hook, pis.impact, renditions.li.text, slides[3].body, script[2].say' },
          text: { type: 'string', description: 'The offending text, quoted exactly' },
          fix: { type: 'string', description: 'A suggested replacement or action' },
        },
        required: ['rule', 'severity', 'field', 'text', 'fix'],
        additionalProperties: false,
      },
    },
    checklist: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          ok: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['id', 'ok', 'note'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string', description: 'One sentence verdict' },
  },
  required: ['violations', 'checklist', 'summary'],
  additionalProperties: false,
};

export function postProcess(output) {
  return {
    violations: (output.violations || []).map((v) => ({ ...v, severity: v.severity === 'block' ? 'block' : 'warn', source: 'ai' })),
    checklist: output.checklist || [],
    summary: output.summary || '',
  };
}
