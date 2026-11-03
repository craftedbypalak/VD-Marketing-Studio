// announcement: campaign facts -> one rendition per target account. [recurring]
// Input { campaign: { name, kind, from, to, facts: [..], notes, thirdParty }, targets: [accountId, ..] }.
// Output { pieces: [ { target, hook, text, hashtags, firstComment, title } ] }, one per target.

import { registerParagraph } from './_shared.mjs';

export const name = 'announcement';
export const description = 'Drafts an announcement, launch, offer, event or milestone post for each chosen account from the campaign facts, in the register, with praise of others where a host or client is involved.';
export const inputFields = ['campaign', 'targets'];

const ANNOUNCEMENT_RULES = [
  'Use only the facts given. Do not add a date, number, place, name or result that is not in the facts. If a fact is missing, leave it out; never fill the gap.',
  'Write in the order the brief sets: say what happened or what is on offer in plain words first, then what it means for an owner, then the one next step. Never open on us or on a feature.',
  'Where a host, organiser, chapter, client or partner is involved, the post is in praise of them: thank them, say what they did, and keep Venture Drafters in the second line. Name only organisations and places the facts name or the allowed-names list permits. Never name a client, a lender or a member of staff unless the facts name a host to be thanked; never claim a result for anyone.',
  'No claim the brief blocks: no result, saving or number that is not in the facts and marked as an example, no "proven", "guaranteed" or "trusted by", no "runs by itself", no follower counts.',
  'The close is plain and single: for example "30 minutes. You see one live system." only when the campaign is an offer or a launch and the facts say so. An announcement of an event, a milestone or a thank-you has no sales close.',
  'Instagram: a caption of 80 to 150 words, hashtags in "hashtags" (five at most, none in the caption), a first comment only if the facts include a link or a detail that would not fit. LinkedIn (Palak Gupta\'s own account): first person, hook in the first 210 characters, no hashtags in the body, up to three in "hashtags". Venture Drafters LinkedIn page: third person is not used; write as the firm in short lines. Facebook: three to five short lines. WhatsApp Status: one or two short lines. WhatsApp monthly note: three short lines, only for people who opted in. YouTube: a title of 100 characters at most in "title" and a description in "text".',
  'Each hook is eight words or fewer. No emoji, no exclamation marks, no ALL CAPS words, no hashtags in the body.',
  'Return exactly one object in "pieces" for each target account id asked for, with "target" set to that id.',
];

function accountsFor(input, ctx) {
  const ids = (input?.targets || []).map(String);
  const known = ctx?.accounts || [];
  return ids.map((id) => known.find((a) => a.id === id) || { id, label: id, platform: '', limits: {} });
}

export function buildPrompt(input, ctx) {
  const c = input?.campaign || {};
  const targets = accountsFor(input, ctx);
  const system = [
    registerParagraph(ctx, 'announcement'),
    'This operation drafts announcements.\n' + ANNOUNCEMENT_RULES.map((l) => `- ${l}`).join('\n'),
  ].join('\n\n');
  const targetLines = targets.map((a) => {
    const l = a.limits || {};
    const bits = [`${a.id}: ${a.label}`, a.platform && `platform ${a.platform}`];
    if (l.textMax) bits.push(`text at most ${l.textMax} characters`);
    if (l.hashtagsMax !== undefined) bits.push(`hashtags at most ${l.hashtagsMax}${l.hashtagsWhere ? `, ${l.hashtagsWhere}` : ''}`);
    return `- ${bits.filter(Boolean).join('; ')}`;
  }).join('\n');
  const user = [
    `Campaign: ${c.name || ''}`,
    `Kind: ${c.kind || 'announcement'}`,
    c.from || c.to ? `Dates: ${[c.from, c.to].filter(Boolean).join(' to ')}` : '',
    c.thirdParty ? `Host, client or partner to praise: ${c.thirdParty}` : 'No host or client is involved unless the facts say so.',
    'Facts, one per line:',
    ...(c.facts || []).map((f) => `- ${f}`),
    c.notes ? `Notes from the owner: ${c.notes}` : '',
    '',
    'Accounts to write for:',
    targetLines,
  ].filter((l) => l !== '').join('\n');
  return { system, user };
}

/** Prompt and schema without calling the model. */
export function dryRun(input, ctx) {
  return { ...buildPrompt(input, ctx), schema };
}

export const schema = {
  type: 'object',
  properties: {
    pieces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'The account id this text is for' },
          hook: { type: 'string', description: 'Eight words or fewer' },
          text: { type: 'string', description: 'Caption, post text, note or description for the account' },
          hashtags: { type: 'array', items: { type: 'string' }, description: 'Hashtags where the account allows them, else empty' },
          firstComment: { type: 'string', description: 'First comment, or empty' },
          title: { type: 'string', description: 'YouTube title only, else empty' },
        },
        required: ['target', 'hook', 'text', 'hashtags', 'firstComment', 'title'],
        additionalProperties: false,
      },
    },
  },
  required: ['pieces'],
  additionalProperties: false,
};

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;
const plain = (s) => String(s ?? '').replace(EMOJI, '').replace(/!/g, '.').replace(/\.\.+/g, '.').trim();

export function postProcess(output, input, ctx) {
  const targets = new Set((input?.targets || []).map(String));
  const accounts = ctx?.accounts || [];
  const pieces = (output.pieces || []).filter((p) => targets.has(p.target)).map((p) => {
    const acct = accounts.find((a) => a.id === p.target);
    const max = acct?.limits?.hashtagsMax;
    let tags = (p.hashtags || []).map((t) => String(t).trim()).filter(Boolean).map((t) => (t.startsWith('#') ? t : `#${t}`));
    if (acct?.limits?.hashtagsWhere === 'none') tags = [];
    else if (typeof max === 'number') tags = tags.slice(0, max);
    const hook = plain(p.hook).split(/\s+/).slice(0, 8).join(' ');
    return { ...p, hook, text: plain(p.text), hashtags: tags, firstComment: plain(p.firstComment), title: plain(p.title).slice(0, 100) };
  });
  return { ...output, pieces };
}
