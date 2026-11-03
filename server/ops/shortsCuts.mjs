// shortsCuts: the outline and script -> two to four YouTube Shorts, each a complete
// problem, impact, solution in under 45 seconds, with a re-hooked first line, a title under
// 70 characters and from/to timecodes by chapter. [video]
//
// Input  { title, outline, script, count?, chapterStarts?: { n: seconds }, solutionId? }
// Output { shorts: [ { title, hook, chapter, from, to, pis, lines: [ { say, sees } ], description, tags } ] }
//        postProcess adds per-line seconds, seconds, startAt, endAt and warnings.

import { registerParagraph } from './_shared.mjs';
import { WPM, wordCount, parseClock, fmtClock, clamp, parseScript } from '../video.mjs';

export const name = 'shortsCuts';
export const description = 'Chooses two to four moments of a case study and writes each as a stand-alone YouTube Short under 45 seconds: problem, impact, solution, re-hooked first line, title, chapter timecodes.';
export const inputFields = ['title', 'outline', 'script', 'count', 'chapterStarts', 'solutionId'];

export function buildPrompt(input, ctx) {
  const count = clamp(parseInt(input?.count, 10) || 3, 2, 4);
  const system = [
    registerParagraph(ctx, 'youtube-short'),
    [
      `Task: choose ${count} moments from a 30 to 45 minute case study and write each as a YouTube Short. A Short is cut from the long video but must stand alone: a viewer who has never seen the long video understands it.`,
      '',
      'Rules:',
      '- Each Short is a complete problem, impact, solution in the house order. It never opens on us and never on a feature.',
      `- Length: 20 to 45 seconds spoken, which is 50 to 100 words at ${WPM} words a minute. Count the words of all "say" lines together and keep to that.`,
      '- Re-hook: the first spoken line is new, written for a viewer who is scrolling. It is not the long video\'s own first line and not a copy of the sentence it was cut from. It names the owner\'s problem in the owner\'s own words.',
      '- "hook" is eight words or fewer: the on-screen hook of the Short.',
      '- "title" is under 70 characters, sentence case, task-first, no exclamation mark, no emoji.',
      '- The last "say" line points to the full walkthrough in plain words, inside the final five seconds, for example "The full walkthrough is linked on this Short." It adds no new claim.',
      '- "chapter" is the chapter the moment comes from (1 to 6); "from" and "to" are minute:second marks counted from the start of that chapter, marking the stretch of the long video the Short is taken from.',
      '- Choose moments from different chapters where the content allows, and at least one from the build chapter if it holds a clean problem-impact-solution.',
      '- "lines": each is one spoken line with "sees", one sentence on what the viewer sees: the owner at work, the system on the masked copy, or a card with script words only.',
      '- "description" is two short sentences and the pointer to the long video. "tags": three plain search phrases, no hashtags.',
      '- Figures only from the script; mark any example as an example. Never name a client, lender or staff. Never say the business runs by itself or without people.',
    ].join('\n'),
  ].join('\n\n');

  const starts = input?.chapterStarts || {};
  const outline = (input?.outline || []).map((c) => `${c.n}. ${c.title} (${c.minutes} min, starts at ${fmtClock(starts[c.n] ?? 0)})`).join('\n');
  const chapters = parseScript(input?.script || '').map((c) => `### Chapter ${c.n}. ${c.title}\n${c.text}`).join('\n\n');
  const candidates = (input?.outline || []).flatMap((c) => (c.shorts || []).map((s) => `- Chapter ${c.n}, ${s.from} to ${s.to}: ${s.hook}`)).join('\n');
  const user = [
    `Video: ${input?.title || ''}`,
    `Outline:\n${outline}`,
    candidates ? `Candidates from the outline, to start from or replace:\n${candidates}` : '',
    `The script:\n${chapters}`,
    `Return ${count} Shorts.`,
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

const strings = { type: 'array', items: { type: 'string' } };

export const schema = {
  type: 'object',
  properties: {
    shorts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          hook: { type: 'string' },
          chapter: { type: 'integer' },
          from: { type: 'string', description: 'm:ss from the start of the chapter' },
          to: { type: 'string', description: 'm:ss from the start of the chapter' },
          pis: {
            type: 'object',
            properties: { problem: { type: 'string' }, impact: { type: 'string' }, solution: strings, close: { type: 'string' } },
            required: ['problem', 'impact', 'solution', 'close'],
            additionalProperties: false,
          },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: { say: { type: 'string' }, sees: { type: 'string' } },
              required: ['say', 'sees'],
              additionalProperties: false,
            },
          },
          description: { type: 'string' },
          tags: strings,
        },
        required: ['title', 'hook', 'chapter', 'from', 'to', 'pis', 'lines', 'description', 'tags'],
        additionalProperties: false,
      },
    },
  },
  required: ['shorts'],
  additionalProperties: false,
};

export function postProcess(output, input) {
  const warnings = [];
  const starts = input?.chapterStarts || {};
  const count = clamp(parseInt(input?.count, 10) || 3, 2, 4);
  let shorts = (output.shorts || []).map((s, i) => {
    const lines = (s.lines || []).map((l) => ({ say: String(l.say || '').trim(), sees: String(l.sees || '').trim() })).filter((l) => l.say);
    const withSeconds = lines.map((l) => ({ ...l, seconds: Math.round((wordCount(l.say) / WPM) * 60 * 10) / 10 }));
    const seconds = Math.round(withSeconds.reduce((a, l) => a + l.seconds, 0));
    const chapter = clamp(parseInt(s.chapter, 10) || 1, 1, 6);
    let a = parseClock(s.from); let b = parseClock(s.to);
    if (a === null || b === null || b <= a) { warnings.push(`Short ${i + 1} has unusable timecodes (${s.from} to ${s.to}).`); a = 0; b = Math.max(seconds, 30); }
    const title = String(s.title || '').trim();
    const hook = String(s.hook || '').trim();
    if (title.length >= 70) warnings.push(`Short ${i + 1}: the title is ${title.length} characters; keep it under 70.`);
    if (/!/.test(title) || /!/.test(lines.map((l) => l.say).join(' '))) warnings.push(`Short ${i + 1} contains an exclamation mark.`);
    if (wordCount(hook) > 8) warnings.push(`Short ${i + 1}: the hook is over eight words.`);
    if (seconds > 45) warnings.push(`Short ${i + 1} runs about ${seconds} seconds; Shorts should stay under 45.`);
    if (seconds < 20) warnings.push(`Short ${i + 1} runs about ${seconds} seconds; Shorts work best at 20 to 45.`);
    if (!s.pis?.problem || !s.pis?.impact || !(s.pis?.solution || []).length) warnings.push(`Short ${i + 1} is missing a part of problem, impact, solution.`);
    const base = Number(starts[chapter]) || 0;
    return {
      title, hook: hook.split(/\s+/).slice(0, 8).join(' '), chapter, from: fmtClock(a), to: fmtClock(b),
      startAt: base + a, endAt: base + b, seconds,
      pis: { problem: String(s.pis?.problem || '').trim(), impact: String(s.pis?.impact || '').trim(), solution: (s.pis?.solution || []).map((x) => String(x).trim()).filter(Boolean), close: String(s.pis?.close || '').trim() },
      lines: withSeconds, description: String(s.description || '').trim(),
      tags: (s.tags || []).map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean),
    };
  });
  if (shorts.length > 4) { warnings.push(`${shorts.length} Shorts came back; the first four are kept.`); shorts = shorts.slice(0, 4); }
  if (shorts.length < 2) warnings.push('Fewer than two Shorts came back; the format asks for two to four.');
  if (shorts.length !== count) warnings.push(`${count} were asked for and ${shorts.length} came back.`);
  return { ...output, shorts, warnings };
}
