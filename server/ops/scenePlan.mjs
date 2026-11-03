// scenePlan: one part of the script -> scenes. [video]
// The model never rewrites the script. It is given numbered sentences and returns, for each
// scene, the first and last sentence it covers plus the picture notes. The words of every
// scene are then taken from the script itself, so the scenes joined equal the script exactly,
// which is what the brand-video pipeline checks.
//
// Input  { part, chapter, chapterTitle, sentences: [..], toCamera?, allowFace, faceUsed, first }
// Output { scenes: [ { from, to, kind, sees, query } ] }  -> postProcess adds say, seconds, warnings

import { registerParagraph } from './_shared.mjs';
import { SCENE_KINDS, MAX_FACE_PER_CHAPTER, WPM, wordCount, sceneSeconds } from '../video.mjs';

export const name = 'scenePlan';
export const description = 'Splits a part of the script into scenes (broll, screen, face, card) with what the viewer sees and stock search words. The words come from the script, never from the model.';
export const inputFields = ['part', 'chapter', 'chapterTitle', 'sentences', 'toCamera', 'allowFace', 'faceUsed', 'first'];

export function buildPrompt(input, ctx) {
  const sentences = input?.sentences || [];
  const chapter = parseInt(input?.chapter, 10) || 1;
  const allowFace = Boolean(input?.allowFace);
  const faceLeft = Math.max(0, MAX_FACE_PER_CHAPTER - (parseInt(input?.faceUsed, 10) || 0));
  const system = [
    registerParagraph(ctx, 'broll'),
    [
      'Task: plan the scenes for one part of a 30 to 45 minute brand video. A scene is a run of consecutive sentences that share one picture. You do not write, change or shorten any script words; you only say which sentences each scene covers and what the viewer sees.',
      '',
      'Scene kinds:',
      '- broll: footage behind the words. Real people and real places first: hands, faces, a person at work, a phone call, papers on a desk. Indian settings. Never a logo, a screen of numbers or an empty skyline.',
      '- screen: a recording of the system on the masked copy, or a designed system screen with demo data. Use it where the sentence is about the system. In the build chapter most scenes are screen.',
      '- face: Palak to camera. The only scenes she records herself. Short and few.',
      '- card: a designed card for a number, a definition or a turn of argument. Its text is taken from the script words only.',
      '',
      'Rules:',
      '- "from" and "to" are 1-based sentence numbers, inclusive. Scenes run in order, start at sentence 1, end at the last sentence, and leave no gap and no overlap.',
      `- A scene covers one to four sentences, about 4 to 15 seconds at ${WPM} words a minute. Never put a whole paragraph in one scene unless it is two sentences.`,
      allowFace
        ? `- Face scenes are allowed in this chapter (${chapter}): at most ${faceLeft} more in this part, because a chapter keeps to ${MAX_FACE_PER_CHAPTER}. Use them only where Palak speaks as herself: the problem, what changed, the close.`
        : `- No face scenes in this chapter (${chapter}). Face scenes belong only to chapters 1, 5 and 6; here use broll, screen or card.`,
      input?.first ? '- This is the opening of the video. The first scene must show the problem as a real person at work, kind broll, so the viewer sees the problem inside the first seconds. No title card first.' : '',
      '- "sees" is one sentence saying exactly what the viewer sees. For broll: the shot. For screen: which screen of the masked copy and what is highlighted. For face: the framing. For card: the card, quoting script words only.',
      '- "query" is for broll only: one or two plain English words to search a free stock library, such as "factory", "phone call", "owner office", "documents". People first. Empty string for every other kind.',
      '- Never invent a figure, a client name or a new fact in "sees".',
    ].filter(Boolean).join('\n'),
  ].join('\n\n');

  const numbered = sentences.map((s, i) => `${i + 1}. ${s}  [${wordCount(s)} words]`).join('\n');
  const lines = [
    `Chapter ${chapter}: ${input?.chapterTitle || ''}. Part ${input?.part ?? 1}.`,
  ];
  if ((input?.toCamera || []).length) lines.push(`Questions Palak answers to camera in this chapter:\n${input.toCamera.map((q) => `- ${q}`).join('\n')}`);
  lines.push(`The sentences (${sentences.length}):\n${numbered}`);
  lines.push(`Return the scenes covering sentences 1 to ${sentences.length}.`);
  return { system, user: lines.join('\n\n') };
}

export const schema = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'integer', description: 'First sentence of the scene, 1-based' },
          to: { type: 'integer', description: 'Last sentence of the scene, inclusive' },
          kind: { type: 'string', enum: SCENE_KINDS },
          sees: { type: 'string' },
          query: { type: 'string' },
        },
        required: ['from', 'to', 'kind', 'sees', 'query'],
        additionalProperties: false,
      },
    },
  },
  required: ['scenes'],
  additionalProperties: false,
};

/** Repairs coverage, takes the words from the script, and enforces where face scenes may be. */
export function postProcess(output, input) {
  const sentences = input?.sentences || [];
  const N = sentences.length;
  const chapter = parseInt(input?.chapter, 10) || 1;
  const warnings = [];
  const raw = (output.scenes || [])
    .map((s) => ({ ...s, from: parseInt(s.from, 10), to: parseInt(s.to, 10) }))
    .filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to))
    .sort((a, b) => a.from - b.from);

  // coverage: no gap, no overlap, starts at 1, ends at N
  const fixed = [];
  let next = 1;
  for (const s of raw) {
    let from = Math.max(s.from, 1); let to = Math.min(Math.max(s.to, from), N);
    if (to < next) { warnings.push(`A scene covering sentences ${s.from} to ${s.to} overlapped an earlier one and was dropped.`); continue; }
    if (from > next) {
      // a gap: extend the previous scene over it, or start this one earlier
      if (fixed.length) { fixed[fixed.length - 1].to = from - 1; } else { from = next; }
      warnings.push(`Sentences ${next} to ${from - 1} were not covered; the neighbouring scene was extended.`);
    }
    if (from < next) from = next;
    fixed.push({ ...s, from, to });
    next = to + 1;
    if (next > N) break;
  }
  if (next <= N) {
    if (fixed.length) { fixed[fixed.length - 1].to = N; } else fixed.push({ from: 1, to: N, kind: 'broll', sees: '', query: '' });
    warnings.push(`Sentences ${next} to ${N} were not covered; the last scene was extended.`);
  }

  const allowFace = Boolean(input?.allowFace);
  let faceLeft = Math.max(0, MAX_FACE_PER_CHAPTER - (parseInt(input?.faceUsed, 10) || 0));
  const scenes = fixed.map((s, i) => {
    const say = sentences.slice(s.from - 1, s.to).join(' ');
    let kind = SCENE_KINDS.includes(s.kind) ? s.kind : 'broll';
    let sees = String(s.sees || '').trim();
    if (kind === 'face') {
      if (!allowFace) { warnings.push(`Scene ${i + 1} was a face scene in chapter ${chapter}; changed to ${chapter === 4 ? 'screen' : 'broll'}.`); kind = chapter === 4 ? 'screen' : 'broll'; sees = ''; }
      else if (faceLeft <= 0) { warnings.push(`Scene ${i + 1} was a face scene beyond ${MAX_FACE_PER_CHAPTER} in chapter ${chapter}; changed to broll.`); kind = 'broll'; sees = ''; }
      else faceLeft -= 1;
    }
    if (input?.first && i === 0 && kind !== 'broll') { warnings.push('The opening scene was changed to broll so the problem is seen first.'); kind = 'broll'; sees = ''; }
    if (!sees) sees = kind === 'screen' ? 'The system on the masked copy, matching the words.' : kind === 'card' ? 'A designed card using the words of the script.' : 'A real person at work that matches the words.';
    const query = kind === 'broll' ? String(s.query || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ') : '';
    if (kind === 'broll' && !query) warnings.push(`Scene ${i + 1} is b-roll without stock search words.`);
    return { from: s.from, to: s.to, say, kind, sees, query, seconds: sceneSeconds(say), words: wordCount(say) };
  });

  // the invariant the pipeline needs
  const joined = scenes.map((s) => s.say).join(' ').replace(/\s+/g, ' ');
  if (joined !== sentences.join(' ').replace(/\s+/g, ' ')) warnings.push('The scene words do not match the script exactly; plan this part again.');
  return { ...output, scenes, warnings };
}
