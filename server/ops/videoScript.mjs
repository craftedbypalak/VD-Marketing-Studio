// videoScript: one chapter of the outline -> the spoken script for that chapter. [video]
// The route calls it once per chapter so no single call is long; `previousTail` carries the
// end of the chapter before it for continuity.
//
// Input  { title, solutionId?, subject?, notes?, outline, chapter, openingLine?, pis?, previousTail? }
// Output { chapter, text, marks: [ { written, spoken } ] }  (+ wordCount, estimatedMinutes, warnings)

import { registerParagraph } from './_shared.mjs';
import { CHAPTER_PLAN, WPM, wordCount, lintScript } from '../video.mjs';

export const name = 'videoScript';
export const description = 'Writes the spoken script of one chapter of a case study at about 140 words a minute, with the read-aloud forms of its numbers and acronyms.';
export const inputFields = ['title', 'solutionId', 'subject', 'notes', 'outline', 'chapter', 'openingLine', 'pis', 'previousTail'];

const CHAPTER_RULES = {
  1: [
    'This is the opening of the video. The first 30 seconds, about 70 words, state the problem and what it costs the owner. Start inside the scene: no greeting, no "welcome", no "in this video", no channel introduction, no preview of what follows.',
    'Tell it as one scene an owner recognises, in the owner\'s own words. A cost may be stated only if it is in the notes or marked as an example.',
    'Palak speaks to camera in this chapter; write her lines as plain script like the rest.',
  ],
  2: [
    'Tell what the same problem cost VSP, in VSP\'s own words. First person plural for the firm, first person for Palak. No client, lender or staff names or details.',
  ],
  3: [
    'Explain why this is a design problem, not a discipline problem: where the work had no home, no visible state and no feedback loop. One idea per paragraph. End by naming the system that answers it, by its public name.',
  ],
  4: [
    'Walk through the system on the masked copy, step by step, as the viewer watches the screen. Say what is on screen and what happens next: "On the left is...", "Now the person responsible...". One step per paragraph, following the order of the outline\'s onScreen list.',
    'Say once, early, that this is a masked copy: the names and numbers shown are made up.',
    'Name only the system and its parts by their public names.',
  ],
  5: [
    'Say what changed once the system ran, and the honest limit: we run the system, the team still does the work. Never say the business runs by itself or without people.',
    'Palak speaks to camera in this chapter.',
  ],
  6: [
    'Say how an owner would start with one process, in three plain steps. The call to action is the 30-minute call; say that the link is in the description. Close warmly and formally. Do not ask for a subscribe or a like.',
    'Palak speaks to camera in this chapter. Finish by pointing to the next case study in one sentence.',
  ],
};

export function buildPrompt(input, ctx) {
  const n = parseInt(input?.chapter, 10) || 1;
  const outline = input?.outline || [];
  const ch = outline.find((c) => c.n === n) || {};
  const plan = CHAPTER_PLAN[n - 1] || {};
  const solution = (ctx.solutions || []).find((s) => s.id === input?.solutionId) || null;
  const minutes = Number(ch.minutes) || plan.min || 3;
  const target = Math.round(minutes * WPM);
  const system = [
    registerParagraph(ctx, 'youtube-long'),
    [
      `Task: write the spoken script of chapter ${n} of a YouTube case study. Palak Gupta, the founder, reads it as a voiceover. Write what she says, nothing else.`,
      '',
      'Spoken register:',
      '- Formal and warm, first person, to one managing director. Short sentences, one idea each. Plain words. No stage directions, no headings, no bullet lists, no questions to the audience as filler.',
      '- Paragraphs of two to six sentences, separated by one blank line. Each paragraph is one idea.',
      '- Only full stops and question marks end a sentence. No exclamation marks, no ellipses, no semicolons, no dashes, no emoji, no hashtags. Never an abbreviation that ends in a full stop (write "for example", not "e.g."; write "Rs 20,000", not "Rs. 20,000").',
      `- Length: about ${target} words (${minutes} minutes at ${WPM} words a minute), within 8 per cent.`,
      '- Figures are written the usual way: "Rs 20,000", "12%", "3 hours", "GST". Every figure, amount, percent, year, date and acronym is also returned in "marks" with how it is said aloud, for example written "Rs 20,000" spoken "twenty thousand rupees", written "GST" spoken "G-S-T". Indian units: thousand, lakh, crore. Never "million".',
      '- A figure may appear only if it is in the notes or the Solutions register, or it is plainly marked as an example inside the same sentence or the one before ("for example", "say"). Never present an invented figure as fact.',
      '- Never name a client, lender or member of staff. Use only the public names of systems.',
      '- Never promise a result. Never say the business runs by itself or without people.',
      '',
      `This chapter: ${n}. ${ch.title || plan.title}. ${plan.brief || ''}`,
      ...(CHAPTER_RULES[n] || []).map((r) => `- ${r}`),
    ].join('\n'),
  ].join('\n\n');

  const lines = [];
  lines.push(`Video title: ${input?.title || ''}`);
  if (solution) lines.push(`System: ${solution.publicName}. ${solution.oneLine || ''}`);
  else if (input?.subject) lines.push(`Subject: ${input.subject}`);
  lines.push(`Palak's notes:\n${String(input?.notes || '').trim() || '(none)'}`);
  if (input?.pis) lines.push(`The case in one line each:\nProblem: ${input.pis.problem}\nImpact: ${input.pis.impact}\nSolution: ${(input.pis.solution || []).join(' ')}\nClose: ${input.pis.close}`);
  lines.push('The outline:\n' + outline.map((c) => `${c.n}. ${c.title} (${c.minutes} min)${c.purpose ? ` - ${c.purpose}` : ''}`).join('\n'));
  lines.push(`Chapter ${n} on screen:\n${(ch.onScreen || []).map((x) => `- ${x}`).join('\n') || '(nothing listed)'}`);
  if ((ch.toCamera || []).length) lines.push(`Palak answers these to camera in this chapter, so write her answers into the script:\n${ch.toCamera.map((x) => `- ${x}`).join('\n')}`);
  if (n === 1 && input?.openingLine) lines.push(`The planned opening, to build on or improve:\n${input.openingLine}`);
  if (input?.previousTail) lines.push(`The last words of the previous chapter, for continuity. Do not repeat them and do not greet again:\n${input.previousTail}`);
  lines.push(`Write chapter ${n} now: about ${target} words.`);
  return { system, user: lines.join('\n\n') };
}

export const schema = {
  type: 'object',
  properties: {
    chapter: { type: 'integer' },
    text: { type: 'string', description: 'The spoken script of the chapter, paragraphs separated by a blank line' },
    marks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { written: { type: 'string' }, spoken: { type: 'string' } },
        required: ['written', 'spoken'],
        additionalProperties: false,
      },
    },
  },
  required: ['chapter', 'text', 'marks'],
  additionalProperties: false,
};

export function postProcess(output, input, ctx) {
  const n = parseInt(input?.chapter, 10) || output.chapter || 1;
  const ch = (input?.outline || []).find((c) => c.n === n) || {};
  const text = String(output.text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const words = wordCount(text);
  const target = Math.round((Number(ch.minutes) || CHAPTER_PLAN[n - 1]?.min || 3) * WPM);
  const warnings = lintScript(text, { chapter: n, rules: ctx?.rules });
  const off = target ? (words - target) / target : 0;
  if (Math.abs(off) > 0.15) warnings.push(`The chapter has ${words} words against a target of ${target} (${off > 0 ? '+' : ''}${Math.round(off * 100)}%).`);
  const marks = (output.marks || []).filter((m) => m && m.written && m.spoken && m.written !== m.spoken)
    .filter((m, i, a) => a.findIndex((x) => x.written === m.written) === i);
  return { ...output, chapter: n, text, marks, wordCount: words, targetWords: target, estimatedMinutes: Math.round((words / WPM) * 10) / 10, warnings };
}
