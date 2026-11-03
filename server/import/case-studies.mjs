// Import the ten "Built to Run: Stories" episodes from ../Marketing/case-studies as
// youtube-long pieces, through the running server's API, and place them on the
// fortnightly Monday slots. Re-runnable: an episode already in the library is skipped.
//
//   node server/import/case-studies.mjs            (server on http://localhost:4747)
//   BASE=http://localhost:4752 node server/import/case-studies.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../../../Marketing/case-studies');
const BASE = process.env.BASE || 'http://localhost:4747';
const USER = process.env.STUDIO_USER || 'tools@vspindia.com';
const H = { 'content-type': 'application/json', 'X-Studio-User': USER };

// The fortnightly Mondays decided on 30 October 2026.
const DATES = ['2026-11-09', '2026-11-23', '2026-12-07', '2026-12-21', '2027-01-04', '2027-01-18', '2027-02-01', '2027-02-15', '2027-03-01', '2027-03-15'];
const FILES = ['01-dabbawalas', '02-asian-paints', '03-maggi', '04-amul', '05-aravind', '06-dmart-subhiksha', '07-indigo', '08-toyota', '09-mcdonalds', '10-zara'];

const call = async (method, p, body) => {
  const r = await fetch(`${BASE}/api${p}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${j?.error || ''}`);
  return j;
};
const toSeconds = (mmss) => { const [m, s] = mmss.split(':').map(Number); return m * 60 + (s || 0); };
const lines = (t) => String(t || '').split('\n').map((s) => s.trim()).filter(Boolean);
const section = (text, n) => {
  const re = new RegExp(`^## ${n}\\. .*$`, 'm');
  const m = re.exec(text);
  if (!m) return '';
  const start = m.index + m[0].length;
  const next = text.slice(start).search(/^## \d+\. /m);
  return next < 0 ? text.slice(start) : text.slice(start, start + next);
};

function parseEpisode(file) {
  const text = fs.readFileSync(path.join(SRC, `${file}.md`), 'utf8');
  const head = /^# Episode (\d+): (.+)$/m.exec(text);
  const n = head[1];
  const title = head[2].trim();
  const after = text.slice(head.index + head[0].length).split('\n').map((s) => s.trim()).filter(Boolean);
  const hook = after[0].replace(/\*\*/g, '');
  const runtime = after[1] || '';

  // The script: beats [mm:ss] with on-screen, spoken words and b-roll.
  const script = section(text, 3);
  const beatRe = /^### \[(\d{1,2}:\d{2})\] (.+)$/gm;
  const beats = [];
  let m;
  const idx = [];
  while ((m = beatRe.exec(script))) idx.push({ t: m[1], title: m[2].trim(), at: m.index, end: m.index + m[0].length });
  idx.forEach((b, i) => {
    const body = script.slice(b.end, i + 1 < idx.length ? idx[i + 1].at : undefined);
    const on = /\*\*On screen:\*\*\s*([\s\S]*?)(?=\n\s*\n|\*\*Palak says)/.exec(body)?.[1]?.replace(/\s+/g, ' ').trim() || '';
    const says = /\*\*Palak says:\*\*\s*([\s\S]*?)(?=\*\*B-roll:\*\*|$)/.exec(body)?.[1] || '';
    const broll = /\*\*B-roll:\*\*\s*(.*)/.exec(body)?.[1] || '';
    const layer = /^(FULL|PIP|VO|A)\b/.exec(on)?.[1] || (/\bVO\b/.test(on) ? 'VO' : /\bPIP\b/.test(on) ? 'PIP' : 'FULL');
    const codes = [...new Set([layer === 'A' ? 'FULL' : layer, ...(broll.match(/\[?(BR-\d+|GFX-\d+|GLIMPSE|A|E)\]?/g) || []).map((c) => c.replace(/[[\]]/g, ''))])];
    const next = i + 1 < idx.length ? toSeconds(idx[i + 1].t) : toSeconds(b.t) + 60;
    const onText = on.replace(/^(FULL|PIP|VO|A)\b[.:]?\s*/, '');
    beats.push({ t: b.t, title: b.title, say: lines(says).join('\n'), sees: `${layer}: ${onText}`, codes, seconds: Math.max(0, next - toSeconds(b.t)) });
  });

  // The fact sheet's "Do not claim" list, for the notes.
  const facts = section(text, 6);
  const dnc = /\*\*Do not claim\*\*\s*([\s\S]*?)(?=\n## |\n### |$)/.exec(facts)?.[1] || '';
  const doNotClaim = lines(dnc).filter((l) => l.startsWith('-')).map((l) => l.replace(/^-\s*/, ''));

  // Cut-downs: three Reels and three LinkedIn posts.
  const cuts = section(text, 8);
  const reels = [];
  const reelRe = /### Reel (\d): (.+)\n+\*\*Hook:\*\* (.+)\n+\*\*Script \((\d+) words\):\*\* ([\s\S]*?)\n+\*\*B-roll:\*\* (.*)/g;
  while ((m = reelRe.exec(cuts))) reels.push({ n: +m[1], title: m[2].trim(), hook: m[3].trim(), script: m[5].trim(), broll: m[6].trim() });
  const posts = [];
  const postRe = /### LinkedIn post (\d)\n+([\s\S]*?)(?=\n### LinkedIn post |\n## |$)/g;
  // The writers' word counts come off, and hashtags go to lower case on one last line.
  const tidyPost = (t) => t.replace(/\n?\(\d+ words\)\s*$/i, '').replace(/#\w+/g, (h) => h.toLowerCase()).trim();
  while ((m = postRe.exec(cuts))) posts.push({ n: +m[1], text: tidyPost(m[2]) });

  // The presentation outline (section 5), kept whole.
  const outline = section(text, 5).trim();
  const open = section(text, 9).trim();
  return { n, file, title, hook, runtime, beats, doNotClaim, reels, posts, outline, open };
}

function chaptersFor(beats) {
  // Chapter lines for the YouTube description: the act-level beats and the mechanisms.
  return beats.filter((b) => /^(Cold open|The question|Five|Mechanism|The day it breaks|What the test|From |Lesson|What I do now|End card)/i.test(b.title) || b.t === '00:00')
    .map((b) => `${b.t} ${b.title}`);
}

async function main() {
  const episodes = FILES.map(parseEpisode);
  const existing = await call('GET', '/pieces');
  const out = [];
  for (const [i, ep] of episodes.entries()) {
    const id = `cs${ep.n}-${ep.file.replace(/^\d+-/, '')}`;
    const date = DATES[i];
    let piece = existing.find((p) => p.id === id);
    if (piece && process.env.REFRESH === '1') {
      // Re-read the script and the cut-downs from the series file; everything else on the piece stays.
      const reel = ep.reels[0];
      const body = { ...piece,
        script: ep.beats.map((b) => ({ say: b.say, sees: b.sees, codes: b.codes, seconds: b.seconds, title: b.title, at: b.t })),
        renditions: { ...piece.renditions, ...(reel ? { ig: { ...(piece.renditions.ig || {}), caption: reel.script.startsWith(reel.hook) ? reel.script : `${reel.hook}\n\n${reel.script}` } } : {}), ...(ep.posts[0] ? { li: { ...(piece.renditions.li || {}), text: ep.posts[0].text } } : {}) },
        changeNote: 'Re-imported the script and the Reel cut-down from the series file' };
      piece = await call('PUT', `/pieces/${id}`, body);
      out.push(`${id}: refreshed`);
    }
    if (!piece) {
      const ytTitle = `Built to Run: ${ep.title}`.slice(0, 100);
      const description = [
        ep.hook,
        '',
        `Built to Run: Stories, episode ${ep.n}. Stories of businesses that run on systems, not on memory. ${ep.runtime.replace(/Publication slot:.*$/, '').trim()}`,
        '',
        'Chapters',
        ...chaptersFor(ep.beats),
        '',
        'If you want to see how this looks for your business, book a 30-minute call: https://calendly.com/craftedbypalak/discovery',
        '',
        'Venture Drafters builds the tools that run a business, on the owner\'s own Google Sheet, and runs them with the owner every week. We run the system; your team still does the work.',
      ].join('\n');
      const reel = ep.reels[0];
      const post = ep.posts[0];
      piece = await call('POST', '/pieces', {
        id, type: 'youtube-long', pillar: 'science', status: 'in-review', hook: ep.hook,
        pis: { problem: '', impact: '', solution: [], close: '' },
        renditions: {
          yt: { title: ytTitle, description, tags: ['built to run', 'business systems', 'msme india', ep.title.toLowerCase()] },
          ...(reel ? { ig: { caption: reel.script.startsWith(reel.hook) ? reel.script : `${reel.hook}\n\n${reel.script}`, hashtags: ['#businessowner', '#msmeindia', '#builttorun', '#businesssystems'], firstComment: '' } } : {}),
          ...(post ? { li: { text: post.text, firstComment: '' } } : {}),
        },
        script: ep.beats.map((b) => ({ say: b.say, sees: b.sees, codes: b.codes, seconds: b.seconds, title: b.title, at: b.t })),
        targets: ['yt', 'vd-ig', 'p-li'],
        tags: ['case-study', 'built-to-run'],
        notes: [
          `Built to Run: Stories, episode ${ep.n}: ${ep.title}. Source: Marketing/case-studies/${ep.file}.md (script, b-roll list, slide outline, fact sheet, sources, cut-downs). Fortnightly Monday slot ${date}, 11:00.`,
          '', 'Do not claim (from the fact sheet):', ...ep.doNotClaim.map((l) => `- ${l}`),
        ].join('\n'),
        passthrough: { cutDowns: { reels: ep.reels, linkedin: ep.posts }, outline: ep.outline, openQuestions: ep.open, layers: 'FULL / PIP / VO beat tags are in each script row\'s sees field' },
        source: { file: `case-studies/${ep.file}.md`, id: `CS${ep.n}` },
        changeNote: 'Imported from Marketing/case-studies (Built to Run: Stories)',
      });
      out.push(`${id}: created`);
    } else out.push(`${id}: exists`);
    // Place on the fortnightly Monday.
    if (piece.plannedDate !== date) {
      try { await call('POST', `/pieces/${id}/place`, { date, create: true }); out.push(`  placed on ${date}`); }
      catch (err) { out.push(`  not placed: ${err.message}`); }
    }
    // A video project per episode, carrying the outline and the full script.
    const fresh = await call('GET', `/pieces/${id}`);
    if (!fresh.videoId) {
      const v = await call('POST', '/video', { pieceId: id, title: `Built to Run: ${ep.title}`, targetMinutes: 30 });
      const vid = v.id || v.video?.id;
      const acts = [
        ['Cold open', '00:00'], ['The owner\'s problem', '01:30'], ['The system', '06:00'], ['The test', '18:00'], ['What this means for a business of 15 to 100 people', '23:00'], ['Close', '28:00'],
      ];
      const outline = acts.map(([t, at], k) => {
        const from = toSeconds(at); const to = k + 1 < acts.length ? toSeconds(acts[k + 1][1]) : 1800;
        const inAct = ep.beats.filter((b) => toSeconds(b.t) >= from && toSeconds(b.t) < to);
        return { n: k + 1, title: t, minutes: Math.round((to - from) / 60), onScreen: inAct.map((b) => `${b.t} ${b.title}: ${b.sees}`), toCamera: inAct.filter((b) => /^FULL/.test(b.sees)).map((b) => b.title), shorts: k === 0 ? ep.reels.map((r) => ({ hook: r.hook, from: '00:00', to: '00:50' })) : [] };
      });
      const scriptText = ep.beats.map((b) => `## [${b.t}] ${b.title}\n\n${b.say}`).join('\n\n');
      const video = await call('GET', `/videos/${vid}`);
      await call('PUT', `/videos/${vid}`, { ...video, outline, script: scriptText, status: 'script', notes: `Imported with the episode. Source: Marketing/case-studies/${ep.file}.md.` });
      out.push(`  video project ${vid}`);
    }
  }
  console.log(out.join('\n'));
}

main().catch((err) => { console.error(err.message); process.exit(1); });
