// reviewPass: the batch helper over the library. [content]
//
// The batch itself is POST /api/content/review-pass (server/rules.mjs): it queues
// `refine` over every piece with status in-review and only one version, with the
// standing instruction below, and writes each result as a new version.
// This operation runs the same standing instruction over a single piece, so a
// piece can be put through the pass from the editor: POST /api/ai/reviewPass { piece }.

import * as refine from './refine.mjs';

export const name = 'reviewPass';
export const description = 'Runs the standing review instruction (register, Problem Impact Solution order, name the tool, retired lines) over one piece. The batch over the library is POST /api/content/review-pass.';
export const inputFields = ['piece'];

/** The standing instruction, built from rules.frame (section 5.2 of the phase 1 design). */
export function standingInstruction(rules = {}) {
  return [
    'Standing review instruction.',
    rules.frame ? `The storyline of the brief: ${rules.frame}` : '',
    'Bring the piece to the register of the brief and to the order Problem, Impact, Solution. If the middle beat is a second problem, rewrite it as an impact.',
    'Where a solution line says "system" or "software" without a tool, name the tool from the Solutions list that fits, by its public name, or say plainly what it does.',
    'Remove the retired lines "the work assigns itself" and "we bring the brains", and replace them with the current lines from the brief.',
    'Never claim the business runs by itself, on autopilot, or without people. We run the system; the team still does the work.',
    'Keep the hook at eight words or fewer where this can be done without changing its meaning.',
    'The caption or post carries all three beats in order; a LinkedIn post ends with one question; a Status rule marks one phrase in *stars*; Instagram hashtags are lower case, five at most; a square-bracket placeholder is filled with a true detail from the piece or removed, never with an invented figure.',
    'Say "my family\'s firm" openly; name Voltas, Panasonic, GPC and Georgia Tech only as places the founder worked or studied; the founder is a designer, never a consultant, a systems expert or an automation expert.',
    'Change as little as possible. If the piece already follows the brief, change nothing and write "No change recommended" with a short reason.',
  ].filter(Boolean).join('\n');
}

export function buildPrompt(input = {}, ctx = {}) {
  return refine.buildPrompt({ ...input, instruction: input.instruction || standingInstruction(ctx.rules) }, ctx);
}

export const schema = refine.schema;

export function postProcess(output, input = {}) {
  return refine.postProcess(output, input);
}
