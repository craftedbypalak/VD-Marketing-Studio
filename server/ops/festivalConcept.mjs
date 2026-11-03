// festivalConcept [occasions]: a festival instance + the unused angles -> three concepts.
// Input { event: { id, name, shortName, date, series, whoGets, note }, angles: [ { id, title, image, scene, solutionId, solutionName, line } ], year }
// Output { concepts: [ { angleId, idea, solutionId, solutionName, scene, type, reelHook, reelCaption, statusLine, linkedinOpening, carouselCover } ] }
//
// The fun lives in the idea and the image (Ganesh and the laddus, the kite thread, the ten heads);
// the wording stays inside the brief: no emoji, no exclamation marks, Problem then Impact then
// Solution, the tool named. A greeting is not a concept: this writes the piece beside the greeting.

import { registerParagraph } from './_shared.mjs';

export const name = 'festivalConcept';
export const description = 'Proposes three festival concepts for a piece beside the greeting: each ties the festival image to one owner scene and one tool we built, with draft lines for a Reel, a Status, a LinkedIn opening and a carousel cover.';
export const inputFields = ['event', 'angles', 'year'];

const RULES = [
  'Each concept takes ONE angle from the list given (its angleId) and sells ONE tool from the Solutions list, named by its public name. Never invent a tool, never name two.',
  'The festival image is affectionate and respectful: a laddu, a kite thread, a rangoli, the ten heads, the new account book. Never a deity mocked, never a ritual made a joke of, never a scripture quoted for a sale.',
  'The owner\'s scene is their own day: dispatch, stock, quotes, payments, the 7 pm, the new joiner, the client who calls first. The reader must think "that is my day" before the tool is named.',
  'Order inside every line: the owner\'s moment, what it costs, the tool. Nothing opens on us.',
  'reelHook: eight words or fewer. reelCaption: 60 to 110 words, Problem, Impact, Solution, then one plain ask (save or send); no hashtags inside it. statusLine: one line for WhatsApp Status, one phrase in *stars*. linkedinOpening: the first two lines of a LinkedIn post, first person, under 210 characters, ending without a hashtag. carouselCover: the cover head, eight words or fewer, one phrase in *stars*.',
  'type is the kind of piece the concept suits best: reel-animated, broll, carousel or status-rule.',
  'No emoji, no exclamation marks, no ALL CAPS, no figure that is not marked as an example, no client name, no "best", no "guaranteed", no "runs by itself". Formal and warm.',
  'The three concepts differ in angle, scene and tool. Return exactly three.',
];

export function buildPrompt(input = {}, ctx = {}) {
  const ev = input.event || {};
  const angles = Array.isArray(input.angles) ? input.angles : [];
  const system = [
    registerParagraph(ctx, 'reel-animated'),
    'This operation writes festival concepts: a piece beside the greeting that is different every year and tied to what we sell.\n' + RULES.map((l) => `- ${l}`).join('\n'),
  ].join('\n\n');
  const user = [
    `Festival: ${ev.shortName || ev.name || ''}${ev.name && ev.name !== ev.shortName ? ` (${ev.name})` : ''}`,
    `Date: ${ev.date || ''}${input.year ? ` (year ${input.year})` : ''}`,
    ev.whoGets ? `Community: ${ev.whoGets}` : '',
    ev.note ? `Calendar note: ${ev.note}` : '',
    '',
    'Angles not yet used in the last four years (choose from these only, one per concept):',
    ...angles.map((a) => `- ${a.id}: ${a.title}. Image: ${a.image} Scene: ${a.scene} Tool: ${a.solutionName} (${a.solutionId}). Line to build on: ${a.line}`),
    '',
    'Return three concepts.',
  ].filter((l) => l !== '').join('\n');
  return { system, user };
}

export const schema = {
  type: 'object',
  properties: {
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          angleId: { type: 'string' },
          idea: { type: 'string', description: 'The idea in one line' },
          solutionId: { type: 'string' },
          solutionName: { type: 'string' },
          scene: { type: 'string', description: 'The owner\'s scene in one or two sentences' },
          type: { type: 'string', enum: ['reel-animated', 'broll', 'carousel', 'status-rule'] },
          reelHook: { type: 'string' },
          reelCaption: { type: 'string' },
          statusLine: { type: 'string' },
          linkedinOpening: { type: 'string' },
          carouselCover: { type: 'string' },
        },
        required: ['angleId', 'idea', 'solutionId', 'solutionName', 'scene', 'type', 'reelHook', 'reelCaption', 'statusLine', 'linkedinOpening', 'carouselCover'],
        additionalProperties: false,
      },
    },
  },
  required: ['concepts'],
  additionalProperties: false,
};

const clean = (s) => String(s ?? '').replace(/\p{Extended_Pictographic}/gu, '').replace(/!/g, '.').replace(/[ \t]+\n/g, '\n').trim();

export function postProcess(output, input = {}, ctx = {}) {
  const angles = new Map((input.angles || []).map((a) => [a.id, a]));
  const solutions = new Map((ctx.solutions || []).map((s) => [s.id, s]));
  const concepts = (output.concepts || []).slice(0, 3).map((c) => {
    const angle = angles.get(c.angleId) || null;
    const solutionId = solutions.has(c.solutionId) ? c.solutionId : (angle?.solutionId || c.solutionId);
    return {
      angleId: angle ? angle.id : c.angleId,
      idea: clean(c.idea), scene: clean(c.scene),
      solutionId, solutionName: solutions.get(solutionId)?.publicName || clean(c.solutionName),
      type: ['reel-animated', 'broll', 'carousel', 'status-rule'].includes(c.type) ? c.type : 'broll',
      reelHook: clean(c.reelHook), reelCaption: clean(c.reelCaption), statusLine: clean(c.statusLine),
      linkedinOpening: clean(c.linkedinOpening), carouselCover: clean(c.carouselCover),
    };
  });
  return { concepts };
}
