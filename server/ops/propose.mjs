// propose: an owner moment or topic -> three Problem, Impact, Solution sets, three hooks each. [content]
// Input { moment, pillar?, sector?, type? } -> output { sets: [ { pis, hooks[3], pillar } ] }

import { registerParagraph } from './_shared.mjs';
import { pisSchema, cleanPis, wordCount, limitsParagraph } from './_content.mjs';

export const name = 'propose';
export const description = 'Takes an owner moment or topic and proposes three Problem, Impact, Solution sets with three hooks each.';
export const inputFields = ['moment', 'pillar', 'sector', 'type'];

export function buildPrompt(input = {}, ctx = {}) {
  const moment = String(input.moment || input.topic || '').trim();
  const pillar = input.pillar ? String(input.pillar) : '';
  const sector = input.sector ? String(input.sector) : '';
  const type = input.type ? String(input.type) : '';
  const system =
    registerParagraph(ctx, type || 'reel-animated') +
    '\n\nTask: propose three different ways to turn one owner moment into a piece of content. ' +
    'Each way is a complete set: the Problem (the owner\'s own words, a moment they will recognise), the Impact (what it costs them, ' +
    'as an impact and not a second problem), the Solution (one or two lines, each naming a tool from the Solutions list or saying plainly what it does), ' +
    'and a Close. Then give three hook options for the set, each eight words or fewer, in different shapes (a statement, a question the owner asks of themselves, a plain scene). ' +
    'The three sets must differ in angle, not only in wording. Nothing opens on us. No figure unless the owner supplied it. ' +
    'Pillars: problem (the moment itself), science (why it happens, the design view), glimpse (a real look at how it is solved), offer, founder.\n' +
    limitsParagraph(ctx.rules);
  const user =
    `Owner moment: ${moment || '(none given; choose a common moment from the owner\'s day)'}\n` +
    (pillar ? `Pillar: ${pillar}\n` : '') +
    (sector ? `Sector of the owner: ${sector}\n` : '') +
    (type ? `Intended type of piece: ${type}\n` : '') +
    'Return three sets.';
  return { system, user };
}

export const schema = {
  type: 'object',
  properties: {
    sets: {
      type: 'array',
      description: 'Exactly three sets',
      items: {
        type: 'object',
        properties: {
          angle: { type: 'string', description: 'The angle of this set in five words or fewer' },
          pillar: { type: 'string', enum: ['problem', 'science', 'glimpse', 'offer', 'founder'] },
          pis: pisSchema,
          hooks: { type: 'array', items: { type: 'string' }, description: 'Exactly three hooks, eight words or fewer each' },
        },
        required: ['angle', 'pillar', 'pis', 'hooks'],
        additionalProperties: false,
      },
    },
  },
  required: ['sets'],
  additionalProperties: false,
};

export function postProcess(output, input, ctx = {}) {
  const limit = ctx.rules?.limits?.hookWords ?? 8;
  const sets = (output.sets || []).slice(0, 3).map((s) => {
    const hooks = (s.hooks || []).map((h) => String(h).trim()).filter(Boolean).slice(0, 3);
    return {
      angle: s.angle, pillar: s.pillar, pis: cleanPis(s.pis), hooks,
      hookWarnings: hooks.map((h) => (wordCount(h) > limit ? `${wordCount(h)} words` : null)),
    };
  });
  return { sets };
}
