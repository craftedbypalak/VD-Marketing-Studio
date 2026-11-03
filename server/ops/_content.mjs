// Shared helpers for the content operations (propose, draft, check, refine,
// reviewPass). Begins with an underscore, so the AI bridge does not list it as
// an operation. [content]

// Which rendition key each account takes (one piece, written once, its form per account).
export const TARGET_RENDITION = {
  'vd-ig': 'ig', 'p-ig': 'ig',
  'vd-fb': 'fb', 'p-fb': 'fb',
  yt: 'yt',
  'vd-li': 'liCo', 'p-li': 'li',
  'wa-st': 'waStatus', fam: 'waStatus',
  'wa-note': 'waNote',
};

export const RENDITION_LABEL = {
  ig: 'Instagram caption',
  li: "Palak's LinkedIn post",
  liCo: 'Venture Drafters LinkedIn page reshare line',
  fb: 'Facebook text',
  waStatus: 'WhatsApp Status text',
  waNote: 'WhatsApp monthly note',
  yt: 'YouTube title and description',
};

export const TYPE_LABEL = {
  'reel-animated': 'Animated reel',
  episode: 'Episode',
  carousel: 'Carousel',
  broll: 'B-roll video',
  'linkedin-text': 'LinkedIn post',
  'linkedin-carousel': 'LinkedIn carousel',
  'status-rule': 'Status rule',
  greeting: 'Greeting',
  'wa-note': 'Monthly note',
  'youtube-long': 'YouTube long video',
  'youtube-short': 'YouTube Short',
  'field-story': 'Field story',
  announcement: 'Announcement',
  'image-post': 'Image post',
};

const TYPE_BRIEF = {
  'reel-animated': 'A 20 to 30 second animated Instagram Reel. The hook is the on-screen head. The caption is short: the hook, one or two lines of Impact and Solution, and one plain ask (save or share).',
  episode: 'An animated episode of about seven seconds per beat, written Problem, Impact, Solution, Close. The caption runs 70 to 120 words in the same order and ends with up to five hashtags, held in the hashtags list and never in the caption.',
  carousel: 'A seven-slide Instagram carousel in the kit\'s slide types: one cover, a run of point slides (or one list slide), and a closing cta slide. One idea a slide. The caption is short and carries the hashtags in the hashtags list.',
  'linkedin-carousel': 'A PDF carousel for Palak\'s LinkedIn: one cover, point slides, an optional list slide and a closing cta slide. The post text above the document is short: the idea, what the slides cover, and one question.',
  broll: 'A 40 to 55 second vertical video, 90 to 130 spoken words. Palak speaks to camera (shot code A) and the picture cuts away to real footage on marked lines. Every row of the script is one spoken line (say) and what the viewer sees (sees) with shot codes. The first row is the hook, on camera, with the same words on screen. The last row is the end card (E) with nothing said. The caption repeats the idea in three or four short sentences.',
  'youtube-long': 'A long case-study video. The script rows are chapters of spoken lines with what is on screen. The YouTube title is under 100 characters and the description opens with the promise, then chapter lines.',
  'youtube-short': 'A YouTube Short under 60 seconds: a complete Problem, Impact, Solution in spoken lines.',
  'linkedin-text': 'A text post from Palak\'s personal LinkedIn. The first two lines are the hook and must carry the tap on "see more" (the post is cut at about 210 characters on a phone). Short paragraphs of one idea each, written in the first person. No link in the body; any link goes in the first comment. No hashtags in the body; up to three on the last line. End with one question.',
  'field-story': 'A short LinkedIn post about one observation from the floor of an event, with credit to the host and no names without consent.',
  'status-rule': 'One line for WhatsApp Status, plain text, a single idea. Words wrapped in *stars* show in lime. No offer.',
  greeting: 'A plain greeting for Status or a post: warm wishes, signed "Palak Gupta, Venture Drafters". No design, no offer, no topical tie-in.',
  'wa-note': 'The monthly WhatsApp note to people who said yes: about 90 words, plain, one idea, one offer of help. Never a hard sell.',
  announcement: 'An announcement written once and fitted to each target account. Plain facts first, then one line on what the owner can do next.',
  'image-post': 'A single image post with a short caption; the image carries one line from the brand tagline set.',
};

export function typeBrief(type) {
  return TYPE_BRIEF[type] || '';
}

const RENDITION_BRIEF = {
  ig: 'ig: { caption, hashtags[], firstComment }. caption is the Instagram caption without any hashtag in it; hashtags holds the tags (at most {igHashtags}, each starting with #), which are placed at the end of the post; firstComment is optional and may carry a link.',
  li: 'li: { text, firstComment }. text is the full post for Palak\'s LinkedIn: the first line is the hook, no hashtags in the body, at most {liHashtagsBottom} hashtags on the very last line; firstComment is optional and carries any link.',
  liCo: 'liCo: { text }. One line that introduces a reshare of the strongest post on the Venture Drafters LinkedIn page. No original claim, no hashtags.',
  fb: 'fb: { text }. A plain Facebook text, no hashtags.',
  waStatus: 'waStatus: { text }. One line for WhatsApp Status, plain text, at most 700 characters, one idea. Words in *stars* show in lime.',
  waNote: 'waNote: { text }. The monthly note for opted-in contacts, about 90 words, at most 1200 characters.',
  yt: 'yt: { title, description, tags[] }. title under 100 characters; description opens with the promise; at most three hashtags at the bottom of the description; tags are plain keywords.',
};

export function renditionBrief(keys, rules = {}) {
  const lim = rules.limits || {};
  return keys.map((k) => (RENDITION_BRIEF[k] || k)
    .replace('{igHashtags}', lim.igHashtags ?? 5)
    .replace('{liHashtagsBottom}', lim.liHashtagsBottom ?? 3)).join('\n');
}

export function renditionKeysFor(targets = []) {
  const keys = [];
  for (const t of targets) {
    const k = TARGET_RENDITION[t];
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

// ----------------------------------------------------------------- schemas

const str = (description) => ({ type: 'string', ...(description ? { description } : {}) });
const strList = (description) => ({ type: 'array', items: { type: 'string' }, ...(description ? { description } : {}) });

export const pisSchema = {
  type: 'object',
  properties: {
    problem: str('The owner\'s problem, in the owner\'s words, one or two short sentences'),
    impact: str('What the problem costs the owner, as an impact and not a second problem'),
    solution: strList('One or two lines. Each names a tool from the Solutions list or says plainly what it does'),
    close: str('One closing line'),
  },
  required: ['problem', 'impact', 'solution', 'close'],
  additionalProperties: false,
};

export const renditionsSchema = {
  type: 'object',
  properties: {
    ig: {
      type: 'object',
      properties: { caption: str(), hashtags: strList('Each starts with #'), firstComment: str() },
      required: ['caption', 'hashtags'],
      additionalProperties: false,
    },
    li: {
      type: 'object',
      properties: { text: str(), firstComment: str() },
      required: ['text'],
      additionalProperties: false,
    },
    liCo: { type: 'object', properties: { text: str() }, required: ['text'], additionalProperties: false },
    fb: { type: 'object', properties: { text: str() }, required: ['text'], additionalProperties: false },
    waStatus: { type: 'object', properties: { text: str() }, required: ['text'], additionalProperties: false },
    waNote: { type: 'object', properties: { text: str() }, required: ['text'], additionalProperties: false },
    yt: {
      type: 'object',
      properties: { title: str(), description: str(), tags: strList() },
      required: ['title', 'description'],
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const scriptSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      say: str('The spoken line; empty for the end card'),
      sees: str('What the viewer sees, starting with the shot code'),
      codes: strList('Shot codes used in this row, such as A, P1, S3, E'),
      seconds: { type: 'number', description: 'Seconds of cutaway footage if the row cuts away; 0 otherwise' },
    },
    required: ['say', 'sees', 'codes'],
    additionalProperties: false,
  },
};

export const slidesSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      t: { type: 'string', enum: ['cover', 'point', 'list', 'cta'] },
      eyebrow: str(),
      head: str('The slide head; one word or short phrase in *stars* is highlighted in lime'),
      body: str(),
      n: str('The point number or label, such as 1, Before or After'),
      items: strList('The lines of a list slide'),
      foot: str(),
    },
    required: ['t', 'head'],
    additionalProperties: false,
  },
};

// -------------------------------------------------------------- piece views

export const TEXT_FIELDS = ['hook', 'pis', 'renditions', 'script', 'slides', 'notes'];

/** The editable text of a piece, as the model should see and return it. */
export function textView(piece = {}) {
  const out = {
    type: piece.type, pillar: piece.pillar, hook: piece.hook || '',
    targets: piece.targets || [],
  };
  if (piece.pis) out.pis = piece.pis;
  if (piece.renditions) out.renditions = piece.renditions;
  if (piece.script?.length) out.script = piece.script;
  if (piece.slides?.length) out.slides = piece.slides;
  return out;
}

export function pieceJson(piece) {
  return JSON.stringify(textView(piece), null, 2);
}

export const wordCount = (s) => String(s || '').replace(/\*/g, '').split(/\s+/).filter(Boolean).length;

/** Tidy model output so it fits the Piece shape (4.1). */
export function cleanPis(p) {
  if (!p || typeof p !== 'object') return undefined;
  const solution = Array.isArray(p.solution) ? p.solution : (p.solution ? [p.solution] : []);
  return {
    problem: String(p.problem || '').trim(),
    impact: String(p.impact || '').trim(),
    solution: solution.map((s) => String(s).trim()).filter(Boolean),
    close: String(p.close || '').trim(),
  };
}

export function cleanRenditions(r, allowedKeys) {
  const out = {};
  if (!r || typeof r !== 'object') return out;
  for (const [k, v] of Object.entries(r)) {
    if (allowedKeys && !allowedKeys.includes(k)) continue;
    if (!v || typeof v !== 'object') continue;
    const o = { ...v };
    if (k === 'ig' || k === 'yt') {
      const key = k === 'ig' ? 'hashtags' : 'tags';
      if (Array.isArray(o[key])) {
        o[key] = o[key].map((t) => String(t).trim()).filter(Boolean)
          .map((t) => (k === 'ig' && !t.startsWith('#') ? `#${t}` : t));
      }
    }
    for (const f of Object.keys(o)) if (typeof o[f] === 'string') o[f] = o[f].trim();
    out[k] = o;
  }
  return out;
}

export function cleanScript(rows) {
  if (!Array.isArray(rows)) return undefined;
  return rows.map((r) => {
    const row = { say: String(r.say || '').trim(), sees: String(r.sees || '').trim(), codes: Array.isArray(r.codes) ? r.codes.map(String) : [] };
    if (typeof r.seconds === 'number' && r.seconds > 0) row.seconds = r.seconds;
    return row;
  });
}

export function cleanSlides(rows) {
  if (!Array.isArray(rows)) return undefined;
  return rows.map((s) => {
    const o = { t: ['cover', 'point', 'list', 'cta'].includes(s.t) ? s.t : 'point' };
    for (const k of ['eyebrow', 'head', 'body', 'n', 'foot']) if (s[k] !== undefined && s[k] !== '') o[k] = String(s[k]).trim();
    if (Array.isArray(s.items) && s.items.length) o.items = s.items.map((x) => String(x).trim()).filter(Boolean);
    return o;
  });
}

/** A single paragraph naming the limits the model must respect. */
export function limitsParagraph(rules = {}) {
  const l = rules.limits || {};
  return `Limits: the hook is ${l.hookWords ?? 8} words or fewer; Instagram takes at most ${l.igHashtags ?? 5} hashtags, at the end; ` +
    `LinkedIn takes none in the body and at most ${l.liHashtagsBottom ?? 3} at the bottom; the first ${l.liHookChars ?? 210} characters of a LinkedIn post carry the hook; ` +
    `no emoji and no exclamation marks anywhere.`;
}
