// Import from ../Marketing into Studio. [content]
//
//   node server/import/run.mjs            # run (re-runnable)
//   node server/import/run.mjs --dry      # report only, write nothing
//   node server/import/run.mjs --no-media # skip copying the rendered files
//
// Reads reels.json, episodes.json, carousels.json + POSTING/captions.json,
// november-2026/BROLL-SCRIPTS.md (B1 to B12), november-2026/LINKEDIN-STORY-POSTS.md
// (L1 to L8), LINKEDIN-PERSONAL.md (LP1 to LP10) and POSTING/calendar.csv, and writes
// pieces (status in-review; ideas for D1 to D3, the December note, the film and the field
// stories), version 1 of each ("Imported from the repository") and data/import-calendar.json
// for the calendar module. Rendered files are copied into media/library/.
//
// Re-runnable: pieces are matched on id. When the repository text differs from what
// was imported, a new version "Repository text changed" is added and the status is
// left alone. A piece edited in Studio keeps its live text; the new version holds the
// repository's text so it can be compared or reverted to.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { store } from '../store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STUDIO = path.resolve(here, '..', '..');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const NO_MEDIA = argv.includes('--no-media');

let settings = null;
try { settings = store.getSingleton('settings'); } catch { /* defaults */ }
const MARKETING = path.resolve(argv.find((a) => a.startsWith('--marketing='))?.slice(12) || settings?.marketingRoot || path.join(STUDIO, '..', 'Marketing'));
const OUT = path.join(MARKETING, 'social-animations', 'out');
const MEDIA_LIB = path.join(STUDIO, 'media', 'library');

const read = (...p) => fs.readFileSync(path.join(MARKETING, ...p), 'utf8');
const readJson = (...p) => JSON.parse(read(...p));

// ------------------------------------------------------------------ helpers

const stripStars = (s) => String(s ?? '').replace(/\*/g, '');
const stripBold = (s) => String(s ?? '').replace(/\*\*(.+?)\*\*/g, '$1');
const sha = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex');

const TEXT_FIELDS = ['hook', 'pis', 'renditions', 'script', 'slides', 'notes'];
const textOf = (p) => Object.fromEntries(TEXT_FIELDS.map((f) => [f, p[f] ?? null]));

/** Split a caption into its text and trailing hashtag block. */
function splitHashtags(raw) {
  const text = String(raw ?? '').replace(/\s+$/, '');
  const tokens = text.split(/(\s+)/);
  const tags = [];
  while (tokens.length) {
    const t = tokens[tokens.length - 1];
    if (/^\s+$/.test(t)) { tokens.pop(); continue; }
    if (/^#[\p{L}\p{N}_]+$/u.test(t)) { tags.unshift(t); tokens.pop(); continue; }
    break;
  }
  return { text: tokens.join('').replace(/\s+$/, ''), tags };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some((x) => x !== '')) rows.push(row); }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function normaliseTime(label) {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(label || '');
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** Channel text -> account ids (the channelMap of accounts.json). */
function accountsFor(channel) {
  const c = String(channel || '');
  const ids = [];
  if (/Instagram/i.test(c)) ids.push('vd-ig');
  if (/LinkedIn/i.test(c)) ids.push('p-li');
  if (/WhatsApp Status/i.test(c)) ids.push('wa-st');
  else if (/WhatsApp/i.test(c)) ids.push('wa-note');
  if (/YouTube/i.test(c)) ids.push('yt');
  return ids;
}

// ------------------------------------------------------------ media helpers

function pngSize(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(24);
    fs.readSync(fd, b, 0, 24, 0);
    if (b.toString('latin1', 1, 4) !== 'PNG') return null;
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } finally { fs.closeSync(fd); }
}

/** Duration and size of an MP4 from its moov box (no ffprobe on the Mac). */
function mp4Info(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    let pos = 0;
    let moov = null;
    while (pos + 8 <= size) {
      const h = Buffer.alloc(16);
      fs.readSync(fd, h, 0, 16, pos);
      let len = h.readUInt32BE(0);
      const type = h.toString('latin1', 4, 8);
      let head = 8;
      if (len === 1) { len = Number(h.readBigUInt64BE(8)); head = 16; }
      else if (len === 0) len = size - pos;
      if (type === 'moov') {
        moov = Buffer.alloc(len - head);
        fs.readSync(fd, moov, 0, moov.length, pos + head);
        break;
      }
      if (len < 8) break;
      pos += len;
    }
    if (!moov) return null;
    const walk = (buf, want) => {
      const found = [];
      let p = 0;
      while (p + 8 <= buf.length) {
        let len = buf.readUInt32BE(p);
        const type = buf.toString('latin1', p + 4, p + 8);
        if (len < 8) break;
        if (type === want) found.push(buf.subarray(p + 8, p + len));
        p += len;
      }
      return found;
    };
    const info = { seconds: null, w: null, h: null };
    const mvhd = walk(moov, 'mvhd')[0];
    if (mvhd) {
      const v = mvhd[0];
      const timescale = v === 1 ? mvhd.readUInt32BE(20) : mvhd.readUInt32BE(12);
      const duration = v === 1 ? Number(mvhd.readBigUInt64BE(24)) : mvhd.readUInt32BE(16);
      if (timescale) info.seconds = Math.round((duration / timescale) * 10) / 10;
    }
    for (const trak of walk(moov, 'trak')) {
      const tkhd = walk(trak, 'tkhd')[0];
      if (!tkhd) continue;
      const off = tkhd[0] === 1 ? 88 : 76;
      const w = tkhd.readUInt32BE(off) / 65536;
      const h = tkhd.readUInt32BE(off + 4) / 65536;
      if (w > 0 && h > 0) { info.w = Math.round(w); info.h = Math.round(h); break; }
    }
    return info;
  } catch { return null; } finally { fs.closeSync(fd); }
}

const copied = { files: 0, bytes: 0, skipped: 0, missing: [] };

/** Copy one rendered file into media/library/<sub>/ and return its /media path, or null. */
function copyMedia(sub, rel) {
  const src = path.join(OUT, rel);
  if (!fs.existsSync(src)) { copied.missing.push(rel); return null; }
  const dest = path.join(MEDIA_LIB, sub, path.basename(rel));
  const webPath = `/media/library/${sub}/${path.basename(rel)}`;
  if (DRY || NO_MEDIA) return { webPath, src };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size) { copied.skipped++; return { webPath, src: dest }; }
  fs.copyFileSync(src, dest);
  copied.files++;
  copied.bytes += fs.statSync(src).size;
  return { webPath, src: dest };
}

function videoAsset(id, sub, rel, label) {
  const c = copyMedia(sub, rel);
  if (!c) return null;
  const info = fs.existsSync(c.src) ? mp4Info(c.src) : null;
  return { id, kind: 'video', path: c.webPath, label, w: info?.w ?? null, h: info?.h ?? null, seconds: info?.seconds ?? null };
}

function imageAsset(id, kind, sub, rel, label) {
  const c = copyMedia(sub, rel);
  if (!c) return null;
  const info = fs.existsSync(c.src) ? pngSize(c.src) : null;
  return { id, kind, path: c.webPath, label, w: info?.w ?? null, h: info?.h ?? null };
}

function animationAssets(kind, id) {
  // kind: 'episodes' | 'reels'
  const list = [];
  const cover = imageAsset('cover', 'cover', kind, `${kind}/${id}.png`, 'Cover frame');
  const vid = videoAsset('video', kind, `${kind}/${id}.mp4`, kind === 'episodes' ? 'Vertical video, 9:16' : 'Reel, 9:16');
  if (cover) list.push(cover);
  if (vid) list.push(vid);
  if (kind === 'episodes') {
    const v45 = videoAsset('video-4x5', 'episodes-4x5', `episodes-4x5/${id}.mp4`, 'Feed video, 4:5');
    if (v45) list.push(v45);
  }
  return list;
}

function carouselAssets(cid, count) {
  const list = [];
  for (let n = 1; n <= count; n++) {
    const nn = String(n).padStart(2, '0');
    const a = imageAsset(`slide-${nn}`, n === 1 ? 'cover' : 'image', 'carousels', `${cid}-slide-${nn}.png`, `Slide ${n}`);
    if (a) list.push(a);
  }
  const c = copyMedia('carousels', `${cid}.pdf`);
  if (c) list.push({ id: 'pdf', kind: 'pdf', path: c.webPath, label: 'PDF carousel for LinkedIn', w: 1080, h: 1350 });
  return list;
}

// -------------------------------------------------------------- the sources

function importReels() {
  const PILLAR = { Problem: 'problem', Cost: 'problem', 'How it works': 'glimpse', 'Own the data': 'science', Intro: 'offer' };
  return readJson('social-animations', 'reels.json').map((r) => {
    const beats = r.beats || [];
    const { id, caption, ...rest } = r;
    return {
      id, type: 'reel-animated', pillar: PILLAR[r.pillar] || 'problem', status: 'in-review',
      hook: stripStars(r.head),
      pis: { problem: beats[0] || '', impact: beats.length > 2 ? beats[1] : '', solution: beats.length > 2 ? beats.slice(2) : beats.slice(1), close: r.cta || '' },
      renditions: { ig: { caption: caption || '', hashtags: [] } },
      assets: animationAssets('reels', id),
      source: { file: 'social-animations/reels.json', id },
      passthrough: rest,
      targets: ['vd-ig'],
    };
  });
}

function importEpisodes() {
  return readJson('social-animations', 'episodes.json').map((e) => {
    const { id, problem, impact, solution, close, caption, ...rest } = e;
    const cap = splitHashtags(caption);
    return {
      id, type: 'episode', pillar: 'problem', status: 'in-review',
      hook: stripStars(problem),
      pis: { problem, impact, solution: solution || [], close },
      renditions: { ig: { caption: cap.text, hashtags: cap.tags } },
      assets: animationAssets('episodes', id),
      source: { file: 'social-animations/episodes.json', id },
      passthrough: rest,
      targets: ['vd-ig'],
    };
  });
}

function importCarousels() {
  const PILLAR = { c1: 'problem', c2: 'problem', c3: 'glimpse', c4: 'offer', c5: 'problem', c6: 'problem', c7: 'science', c8: 'science', c9: 'founder' };
  const data = readJson('social-animations', 'carousels.json');
  const captions = readJson('POSTING', 'captions.json');
  return Object.entries(data).map(([id, c]) => {
    const cap = captions[id] ? splitHashtags(captions[id]) : null;
    const piece = {
      id, type: 'carousel', pillar: PILLAR[id.split('-')[0]] || 'problem', status: 'in-review',
      hook: stripStars(c.title),
      slides: c.slides,
      assets: carouselAssets(id, c.slides.length),
      source: { file: 'social-animations/carousels.json', id },
      passthrough: { title: c.title },
      targets: ['vd-ig'],
    };
    if (cap) piece.renditions = { ig: { caption: cap.text, hashtags: cap.tags } };
    return piece;
  });
}

function shotCodes(sees) {
  const out = [];
  for (const part of String(sees).split(/\s*(?:,|;|:|\bthen\b|\band\b)\s*/)) {
    const m = /^(A|[PDOSK]\d|N|E)(?=\s|$)/.exec(part.trim());
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function importBroll() {
  const text = read('november-2026', 'BROLL-SCRIPTS.md');
  const parts = text.split(/^### (?=B\d+\.)/m).slice(1);
  const PILLAR = (meta) => {
    const p = (/Pillar:\s*([^.]*)\./i.exec(meta) || [])[1] || '';
    if (/problem/i.test(p)) return 'problem';
    if (/science/i.test(p)) return 'science';
    if (/glimpse/i.test(p)) return 'glimpse';
    if (/offer/i.test(p)) return 'offer';
    if (/own the data/i.test(p)) return 'science';
    return 'founder';
  };
  return parts.map((block) => {
    const lines = block.split('\n');
    const head = /^(B\d+)\.\s*(.*)$/.exec(lines[0]);
    const id = head[1];
    const hook = head[2].replace(/\s*\(.*\)\s*$/, '').trim();
    const meta = (lines.find((l) => /^\*[^*].*\*$/.test(l.trim())) || '').trim().replace(/^\*|\*$/g, '');
    const script = [];
    let inTable = false;
    for (const l of lines) {
      const t = l.trim();
      if (!t.startsWith('|')) { if (inTable) break; continue; }
      inTable = true;
      const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (/^You say$/i.test(cells[0]) || /^-+$/.test(cells[0].replace(/\s/g, ''))) continue;
      const say = stripBold(cells[0] || '');
      const sees = stripBold(cells[1] || '');
      const row = { say, sees, codes: shotCodes(sees) };
      const sec = /(\d+)\s*seconds?/i.exec(sees);
      if (sec) row.seconds = parseInt(sec[1], 10);
      script.push(row);
    }
    const capIdx = lines.findIndex((l) => l.startsWith('**Caption:**'));
    let caption = '';
    let tags = [];
    if (capIdx >= 0) {
      caption = lines[capIdx].replace('**Caption:**', '').trim();
      const next = (lines[capIdx + 1] || '').trim();
      if (/^#/.test(next)) tags = next.split(/\s+/).filter((x) => x.startsWith('#'));
    }
    return {
      id, type: 'broll', pillar: PILLAR(meta), status: 'in-review',
      hook, script,
      renditions: { ig: { caption, hashtags: tags } },
      notes: meta,
      assets: [],
      source: { file: 'november-2026/BROLL-SCRIPTS.md', id },
      passthrough: {},
      targets: ['vd-ig'],
    };
  });
}

/** The first blockquote of a markdown block as plain text. */
function firstQuote(lines) {
  const out = [];
  let started = false;
  for (const l of lines) {
    if (l.startsWith('>')) { started = true; out.push(l.replace(/^>\s?/, '')); }
    else if (started) break;
  }
  return stripBold(out.join('\n').trim());
}

function firstCommentOf(lines) {
  const l = lines.find((x) => x.startsWith('**First comment:**'));
  if (!l) return { comment: '', note: '' };
  const body = l.replace('**First comment:**', '').trim();
  const q = /^["“](.+?)["”]\.?(?:\s|$)/.exec(body);
  if (q) return { comment: q[1].trim(), note: '' };
  return { comment: '', note: body };
}

function l4Slides(lines) {
  const out = [];
  const items = lines.filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s*/, '').trim());
  items.forEach((raw, i) => {
    let foot = '';
    let rest = raw;
    const f = /\s\*([^*]+)\*\s*$/.exec(rest);
    if (f && i === items.length - 1) { foot = f[1]; rest = rest.slice(0, f.index).trim(); }
    const b = /^\*\*(.+?)\*\*\s*(.*)$/.exec(rest);
    const s = { t: i === 0 ? 'cover' : (i === items.length - 1 ? 'cta' : 'point') };
    if (b) {
      s.head = b[1].trim();
      const body = b[2].replace(/^\*([^*]+)\*$/, '$1').trim();
      if (body) s.body = body;
    } else s.body = rest;
    if (foot) s.foot = foot;
    out.push(s);
  });
  return out;
}

function importLinkedInStory() {
  const text = read('november-2026', 'LINKEDIN-STORY-POSTS.md');
  const parts = text.split(/^## (?=L\d+\.)/m).slice(1);
  const PILLAR = { L1: 'founder', L2: 'founder', L3: 'science', L4: 'glimpse', L5: 'offer', L6: 'offer', L7: 'problem', L8: 'problem' };
  return parts.map((block) => {
    const lines = block.split('\n');
    const head = /^(L\d+)\.\s*(.*)$/.exec(lines[0]);
    const id = head[1];
    const meta = (lines.slice(1).find((l) => /^\*[^*].*\*$/.test(l.trim())) || '').trim().replace(/^\*|\*$/g, '');
    const body = firstQuote(lines);
    const fc = firstCommentOf(lines);
    const extra = lines.filter((l) => /^\*\*(Still|Source)/.test(l)).map((l) => stripBold(l).trim());
    const notes = [meta, ...extra, fc.note ? `First comment: ${fc.note}` : ''].filter(Boolean).join('\n');
    const li = { text: body };
    if (fc.comment) li.firstComment = fc.comment;
    const piece = {
      id, type: 'linkedin-text', pillar: PILLAR[id] || 'founder', status: 'in-review',
      hook: head[2].trim(),
      renditions: { li },
      notes,
      assets: [],
      source: { file: 'november-2026/LINKEDIN-STORY-POSTS.md', id },
      passthrough: {},
      targets: ['p-li'],
    };
    if (id === 'L4') {
      piece.type = 'linkedin-carousel';
      piece.slides = l4Slides(lines);
      piece.assets = carouselAssets('c9-google-sheet', piece.slides.length);
    }
    return piece;
  });
}

function importLinkedInPersonal() {
  const text = read('LINKEDIN-PERSONAL.md');
  const parts = text.split(/^## (?=\d+\.\s)/m).slice(1);
  const PILLAR = { 1: 'problem', 2: 'problem', 3: 'problem', 4: 'problem', 5: 'problem', 6: 'science', 7: 'glimpse', 8: 'glimpse', 9: 'founder', 10: 'offer' };
  return parts.map((block) => {
    const lines = block.split('\n');
    const head = /^(\d+)\.\s*(.*)$/.exec(lines[0]);
    const n = parseInt(head[1], 10);
    const body = firstQuote(lines);
    const fc = firstCommentOf(lines);
    const goes = (/Goes with `([^`]+)`/.exec(head[2]) || [])[1] || null;
    const notes = [
      head[2].startsWith('Goes with') ? head[2].replace(/`/g, '') : '',
      ...lines.filter((l) => /^\*[^*].*\*$/.test(l.trim())).map((l) => l.trim().replace(/^\*|\*$/g, '')),
      fc.note ? `First comment: ${fc.note}` : '',
    ].filter(Boolean).join('\n');
    const li = { text: body };
    if (fc.comment) li.firstComment = fc.comment;
    const assets = [];
    if (goes && fs.existsSync(path.join(OUT, 'reels', `${goes}.mp4`))) {
      const v = videoAsset('reel', 'reels', `reels/${goes}.mp4`, `The Reel this post goes with (${goes})`);
      if (v) assets.push(v);
    }
    const hook = (body.split('\n')[0] || '').trim();
    return {
      id: `LP${n}`, type: 'linkedin-text', pillar: PILLAR[n] || 'problem', status: 'in-review',
      hook, renditions: { li }, notes, assets,
      source: { file: 'LINKEDIN-PERSONAL.md', id: `LP${n}` },
      passthrough: goes ? { goesWith: goes } : {},
      targets: ['p-li'],
    };
  });
}

// ---------------------------------------------------------- the calendar rows

function readCalendar() {
  const rows = parseCsv(read('POSTING', 'calendar.csv'));
  const usedByDate = new Map();
  return rows.map((r) => {
    const rawId = r.Id || '';
    let pieceId = rawId;
    if (rawId === 'rule' || rawId === 'greeting' || rawId === 'field') {
      pieceId = `${rawId}-${r.Date}`;
      const key = pieceId;
      const n = usedByDate.get(key) || 0;
      usedByDate.set(key, n + 1);
      if (n) pieceId = `${pieceId}-${String.fromCharCode(97 + n)}`;
    }
    return {
      date: r.Date,
      time: normaliseTime(r['Time (IST)']),
      timeLabel: r['Time (IST)'],
      channel: r.Channel,
      accounts: accountsFor(r.Channel),
      format: r.Format,
      id: rawId,
      pieceId,
      hook: r.Hook,
      notes: r.Notes,
      status: r.Status,
      week: r.Week,
      day: r.Day,
      ready: r['Ready?'],
      yourFace: r['Your face'],
      text: r['Caption or text (when not in a source file)'],
    };
  });
}

/** Pieces the calendar names that no source file holds: rules, greetings, ideas. */
function piecesFromCalendar(rows, known) {
  const out = [];
  const IDEAS = {
    D1: { type: 'field-story', pillar: 'founder' },
    D2: { type: 'linkedin-text', pillar: 'science' },
    D3: { type: 'linkedin-text', pillar: 'founder' },
    'note-dec': { type: 'wa-note', pillar: 'problem' },
    film: { type: 'youtube-long', pillar: 'founder' },
  };
  for (const r of rows) {
    if (known.has(r.pieceId) || out.some((p) => p.id === r.pieceId)) continue;
    const base = {
      id: r.pieceId, hook: r.hook, status: 'in-review', assets: [], targets: r.accounts, passthrough: {},
      source: { file: 'POSTING/calendar.csv', id: r.id }, notes: r.notes || '',
    };
    if (r.id === 'rule') {
      out.push({ ...base, type: 'status-rule', pillar: 'problem', renditions: { waStatus: { text: r.text || r.hook } } });
    } else if (r.id === 'greeting') {
      const rend = { waStatus: { text: r.text || r.hook } };
      if (r.accounts.includes('vd-ig')) rend.ig = { caption: r.text || r.hook, hashtags: [] };
      out.push({ ...base, type: 'greeting', pillar: 'greeting', renditions: rend });
    } else if (r.id === 'field') {
      out.push({ ...base, type: 'field-story', pillar: 'founder', status: 'idea' });
    } else if (IDEAS[r.id]) {
      out.push({ ...base, ...IDEAS[r.id], status: 'idea' });
    } else {
      console.warn(`  note: calendar row ${r.date} ${r.id} names no source piece and was kept as an idea`);
      out.push({ ...base, type: 'reel-animated', pillar: 'problem', status: 'idea' });
    }
  }
  return out;
}

// ----------------------------------------------------------------- the writer

const report = {};
const bump = (type, key) => {
  report[type] ||= { created: 0, updated: 0, unchanged: 0, newVersions: 0 };
  report[type][key]++;
};

const snapshotOf = (p) => { const { check, measure, ...rest } = p; return rest; };

async function addVersion(piece, changeNote) {
  const n = store.list('versions', (v) => v.pieceId === piece.id).length + 1;
  const version = {
    id: store.nextId('vr'), pieceId: piece.id, n, snapshot: snapshotOf(piece),
    by: 'import', at: new Date().toISOString(), changeNote,
  };
  await store.put('versions', version);
  return version;
}

async function writePiece(P, calRows) {
  const hash = sha(textOf(P));
  P.source = { ...P.source, hash };
  const mine = calRows.filter((r) => r.pieceId === P.id);
  const existing = store.get('pieces', P.id);

  if (!existing) {
    const first = [...mine].sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`))[0];
    const targets = mine.length ? [...new Set(mine.flatMap((r) => r.accounts))] : (P.targets || []);
    const piece = {
      ...P,
      targets: targets.length ? targets : P.targets || [],
      owner: 'Palak Gupta',
      by: 'import',
    };
    if (first) { piece.plannedDate = first.date; if (first.time) piece.plannedTime = first.time; }
    if (DRY) { bump(P.type, 'created'); return; }
    const stored = await store.put('pieces', piece);
    await addVersion(stored, 'Imported from the repository');
    bump(P.type, 'created');
    return;
  }

  // Re-run: refresh what the repository owns, leave status, dates and targets alone.
  const v1 = store.list('versions', (v) => v.pieceId === P.id).sort((a, b) => a.n - b.n)[0];
  const previousHash = existing.source?.hash || (v1 ? sha(textOf(v1.snapshot)) : null);
  const next = { ...existing, assets: P.assets?.length ? P.assets : (existing.assets || []), passthrough: P.passthrough, source: { ...P.source } };
  let changedText = false;
  if (previousHash && previousHash !== hash) {
    changedText = true;
    const unedited = sha(textOf(existing)) === previousHash;
    const repoText = Object.fromEntries(TEXT_FIELDS.filter((f) => P[f] !== undefined).map((f) => [f, P[f]]));
    if (DRY) { bump(P.type, 'updated'); report[P.type].newVersions++; return; }
    if (unedited) Object.assign(next, repoText);
    const stored = await store.put('pieces', next);
    await addVersion(unedited ? stored : { ...stored, ...repoText }, unedited ? 'Repository text changed' : 'Repository text changed (the live text was edited in Studio and was kept)');
    bump(P.type, 'updated');
    report[P.type].newVersions++;
    return;
  }
  if (DRY) { bump(P.type, 'unchanged'); return; }
  const same = JSON.stringify(next.assets) === JSON.stringify(existing.assets) && JSON.stringify(next.passthrough) === JSON.stringify(existing.passthrough)
    && existing.source?.hash === hash;
  if (!same) await store.put('pieces', next);
  bump(P.type, same ? 'unchanged' : 'updated');
  if (!changedText && !v1 && !DRY) await addVersion(next, 'Imported from the repository');
}

// ------------------------------------------------------------------ main

async function main() {
  console.log(`Importing from ${MARKETING}${DRY ? ' (dry run: nothing is written)' : ''}`);
  if (!fs.existsSync(MARKETING)) throw new Error(`The Marketing folder was not found at ${MARKETING}`);

  const calRows = readCalendar();
  const sourced = [
    ...importReels(), ...importEpisodes(), ...importCarousels(),
    ...importBroll(), ...importLinkedInStory(), ...importLinkedInPersonal(),
  ];
  const known = new Set(sourced.map((p) => p.id));
  const fromCalendar = piecesFromCalendar(calRows, known);
  const all = [...sourced, ...fromCalendar];

  for (const p of all) await writePiece(p, calRows);

  // The calendar rows for the calendar module (data/import-calendar.json).
  if (!DRY) {
    const file = path.join(STUDIO, 'data', 'import-calendar.json');
    fs.writeFileSync(file, JSON.stringify(calRows, null, 2) + '\n');
  }

  const total = Object.values(report).reduce((n, r) => n + r.created + r.updated + r.unchanged, 0);
  console.log('\nPieces by type (created / updated / unchanged / new versions):');
  for (const [type, r] of Object.entries(report).sort()) {
    console.log(`  ${type.padEnd(18)} ${String(r.created).padStart(3)} ${String(r.updated).padStart(3)} ${String(r.unchanged).padStart(3)} ${String(r.newVersions).padStart(3)}`);
  }
  console.log(`  ${'total'.padEnd(18)} ${total}`);
  const byStatus = {};
  for (const p of all) byStatus[p.status] = (byStatus[p.status] || 0) + 1;
  console.log('\nBy status:', JSON.stringify(byStatus));
  console.log(`Calendar rows written to data/import-calendar.json: ${calRows.length}`);
  console.log(`Media: ${copied.files} copied (${(copied.bytes / 1048576).toFixed(1)} MB), ${copied.skipped} already present${copied.missing.length ? `, ${copied.missing.length} missing` : ''}`);
  if (copied.missing.length) console.log('  missing (first 5):', copied.missing.slice(0, 5).join(', '));
  const withAssets = all.filter((p) => p.assets?.length).length;
  console.log(`Pieces with assets: ${withAssets}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
