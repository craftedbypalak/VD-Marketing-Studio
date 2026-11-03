// caseStudyOutline: a solution (or a subject) and Palak's notes -> the six-chapter
// outline of a 30 to 45 minute YouTube case study (phase 1 design 5.8). [video]
//
// Input  { solutionId?, subject?, notes?, targetMinutes? }
// Output { title, hook, openingLine, descriptionIntro, pis, tags, outline: [ { n, title, minutes,
//          purpose, onScreen, toCamera, shorts: [ { hook, from, to } ] } ] }  (+ warnings added by postProcess)

import { registerParagraph } from './_shared.mjs';
import { CHAPTER_PLAN, defaultMinutes, FACE_CHAPTERS, parseClock, fmtClock, wordCount, clamp } from '../video.mjs';

export const name = 'caseStudyOutline';
export const description = 'Plans a 30 to 45 minute YouTube case study of one system in six chapters: minutes, on-screen items, questions to answer to camera and Shorts candidates.';
export const inputFields = ['solutionId', 'subject', 'notes', 'targetMinutes'];

function chapterBlock() {
  return CHAPTER_PLAN.map((c) =>
    `${c.n}. ${c.title}. ${c.min} to ${c.max} minutes. ${c.brief}${c.face ? ' One of the three face moments.' : ''}`).join('\n');
}

export function buildPrompt(input, ctx) {
  const solution = (ctx.solutions || []).find((s) => s.id === input?.solutionId) || null;
  const target = clamp(parseInt(input?.targetMinutes, 10) || 38, 30, 45);
  const mins = defaultMinutes(target);
  const system = [
    registerParagraph(ctx, 'youtube-long'),
    [
      'Task: plan one YouTube case study for Venture Drafters. One video tells one system. It runs 30 to 45 minutes. The founder, Palak Gupta, presents it as a scripted voiceover over footage and the system on screen, with her own face on camera at three moments only. No client can be named: the case study is the system, how it was designed and what it changed.',
      '',
      'The structure is fixed: six chapters, in this order, each told in the order Problem, Impact, Solution.',
      chapterBlock(),
      '',
      'Rules:',
      `- Minutes per chapter are whole numbers inside the ranges above and add up to a number from 30 to 45. Aim for ${target}; a split such as ${mins.join(', ')} works.`,
      '- "title" is task-first: it names what the owner is trying to do, in plain English, under 70 characters, sentence case, no exclamation mark, no teaser colon. It may read like the search an owner would type.',
      '- "hook" is eight words or fewer, for the library piece.',
      '- Chapter 1 opens on the problem and its cost inside the first 30 seconds. No greeting, no channel introduction, no preview of the video. "openingLine" is those first words, 60 to 80 of them, spoken by Palak.',
      '- "descriptionIntro" is at most 150 characters and names the system and the outcome for the owner.',
      '- "pis" is the whole case study in the house order: the problem, its impact, the solution as one or two lines that name the system by its public name, and a close.',
      '- Face moments: "toCamera" holds one to three questions Palak answers to camera in chapters 1, 5 and 6 only. In chapters 2, 3 and 4 it is an empty list: the build stays on screen.',
      '- "onScreen" lists what the viewer sees in that chapter, one short phrase each. In chapter 4 give one entry per step of the build and name the screen of the masked copy to show (for example "the reminder list, masked copy"). Never a real client, lender or staff name.',
      '- "purpose" is one sentence on what the chapter does for the viewer.',
      '- "shorts": choose exactly three moments across the whole outline. Each is a complete problem, impact, solution that can stand alone in 20 to 45 seconds. Put it in the chapter it comes from. "hook" is a re-hooked first line of eight words or fewer, never the video\'s own opening line. "from" and "to" are minute:second marks counted from the start of that chapter, 20 to 45 seconds apart. A chapter without a Short returns an empty list.',
      '- Figures come only from the notes or the Solutions register. Anything else that the viewer needs is written as "[ask Palak: ...]" in "onScreen" or "purpose"; never invent a number.',
      '- Never promise a result. Never say the business runs by itself or without people. Say what we run and what the team still does.',
      '- "tags": four to eight plain search phrases an owner would use, no hashtags.',
    ].join('\n'),
  ].join('\n\n');

  const lines = [];
  if (solution) {
    lines.push(`System: ${solution.publicName}`);
    lines.push(`What it does: ${solution.oneLine || ''}`);
    if (solution.removes?.length) lines.push(`Problems it removes, in the owner's words:\n${solution.removes.map((r) => `- ${r}`).join('\n')}`);
  } else if (input?.subject) {
    lines.push(`Subject: ${input.subject}`);
  } else {
    lines.push('Subject: not given. Plan the case study around the most common owner problem in the Solutions register.');
  }
  lines.push(`Target length: about ${target} minutes.`);
  lines.push(`Palak's notes:\n${String(input?.notes || '').trim() || '(none)'}`);
  return { system, user: lines.join('\n\n') };
}

const strings = { type: 'array', items: { type: 'string' } };

export const schema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'YouTube title, task-first, under 70 characters' },
    hook: { type: 'string', description: 'Eight words or fewer' },
    openingLine: { type: 'string', description: 'The first 60 to 80 spoken words: the problem and its cost' },
    descriptionIntro: { type: 'string', description: 'At most 150 characters: the system and the outcome' },
    pis: {
      type: 'object',
      properties: { problem: { type: 'string' }, impact: { type: 'string' }, solution: strings, close: { type: 'string' } },
      required: ['problem', 'impact', 'solution', 'close'],
      additionalProperties: false,
    },
    tags: strings,
    outline: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer', description: 'Chapter number, 1 to 6' },
          title: { type: 'string' },
          minutes: { type: 'integer' },
          purpose: { type: 'string' },
          onScreen: strings,
          toCamera: strings,
          shorts: {
            type: 'array',
            items: {
              type: 'object',
              properties: { hook: { type: 'string' }, from: { type: 'string', description: 'm:ss from the start of the chapter' }, to: { type: 'string', description: 'm:ss from the start of the chapter' } },
              required: ['hook', 'from', 'to'],
              additionalProperties: false,
            },
          },
        },
        required: ['n', 'title', 'minutes', 'purpose', 'onScreen', 'toCamera', 'shorts'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'hook', 'openingLine', 'descriptionIntro', 'pis', 'tags', 'outline'],
  additionalProperties: false,
};

/** Brings the minutes inside 30 to 45 and each chapter inside its range; flags what was changed or looks off. */
export function postProcess(output, input) {
  const warnings = [];
  const target = clamp(parseInt(input?.targetMinutes, 10) || 38, 30, 45);
  const outline = (output.outline || []).map((c, i) => ({
    n: i + 1,
    title: String(c.title || CHAPTER_PLAN[i]?.title || `Chapter ${i + 1}`).trim(),
    minutes: Math.max(1, Math.round(Number(c.minutes) || CHAPTER_PLAN[i]?.min || 3)),
    purpose: String(c.purpose || '').trim(),
    onScreen: (c.onScreen || []).map((x) => String(x).trim()).filter(Boolean),
    toCamera: (c.toCamera || []).map((x) => String(x).trim()).filter(Boolean),
    shorts: (c.shorts || []).map((s) => ({ hook: String(s.hook || '').trim(), from: String(s.from || '').trim(), to: String(s.to || '').trim() })),
  }));
  if (outline.length !== 6) warnings.push(`The outline has ${outline.length} chapters; the format is six.`);

  // minutes: each inside its range, total 30 to 45
  outline.forEach((c, i) => {
    const plan = CHAPTER_PLAN[i];
    if (!plan) return;
    const clamped = clamp(c.minutes, plan.min, plan.max);
    if (clamped !== c.minutes) { warnings.push(`Chapter ${c.n} minutes changed from ${c.minutes} to ${clamped} to stay inside ${plan.min} to ${plan.max}.`); c.minutes = clamped; }
  });
  let total = outline.reduce((a, c) => a + c.minutes, 0);
  if (outline.length === 6 && (total < 30 || total > 45)) {
    const fixed = defaultMinutes(target);
    outline.forEach((c, i) => { c.minutes = fixed[i]; });
    warnings.push(`The minutes added up to ${total}; they were reset to ${fixed.join(', ')} (${fixed.reduce((a, b) => a + b, 0)}).`);
    total = fixed.reduce((a, b) => a + b, 0);
  }

  // face moments only in chapters 1, 5 and 6
  for (const c of outline) {
    if (!FACE_CHAPTERS.includes(c.n) && c.toCamera.length) {
      warnings.push(`Chapter ${c.n} had to-camera questions; they were removed because the face moments are chapters 1, 5 and 6.`);
      c.toCamera = [];
    }
  }
  for (const n of FACE_CHAPTERS) {
    const c = outline.find((x) => x.n === n);
    if (c && !c.toCamera.length) warnings.push(`Chapter ${n} has no question to answer to camera.`);
  }

  // Shorts: three, with clean timecodes
  let shortsTotal = 0;
  for (const c of outline) {
    c.shorts = c.shorts.filter((s) => s.hook).map((s) => {
      const a = parseClock(s.from); const b = parseClock(s.to);
      if (a === null || b === null || b <= a) { warnings.push(`A Short in chapter ${c.n} has unusable timecodes (${s.from} to ${s.to}).`); return { ...s, from: fmtClock(0), to: fmtClock(30) }; }
      if (b - a < 15 || b - a > 60) warnings.push(`A Short in chapter ${c.n} runs ${b - a} seconds; Shorts should run 20 to 45.`);
      if (wordCount(s.hook) > 8) warnings.push(`A Short hook in chapter ${c.n} is over eight words.`);
      return { hook: s.hook, from: fmtClock(a), to: fmtClock(b) };
    });
    shortsTotal += c.shorts.length;
  }
  if (shortsTotal !== 3) warnings.push(`The outline lists ${shortsTotal} Shorts candidates; the format asks for three.`);

  const title = String(output.title || '').trim();
  if (title.length >= 70) warnings.push(`The title is ${title.length} characters; keep it under 70.`);
  if (/!/.test(title)) warnings.push('The title contains an exclamation mark.');
  const hook = String(output.hook || '').trim().split(/\s+/).slice(0, 8).join(' ');
  let intro = String(output.descriptionIntro || '').trim();
  if (intro.length > 150) { warnings.push('The description intro was over 150 characters and was cut at a word.'); intro = intro.slice(0, 150).replace(/\s+\S*$/, ''); }
  const opening = wordCount(output.openingLine);
  if (opening < 40 || opening > 100) warnings.push(`The opening line is ${opening} words; about 60 to 80 fit the first 30 seconds.`);

  return {
    ...output, title, hook, descriptionIntro: intro, outline, totalMinutes: total,
    tags: (output.tags || []).map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean),
    warnings,
  };
}
