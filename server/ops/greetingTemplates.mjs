// greetingTemplates: festival or national day -> the three plain lines. [recurring]
// Input { event: { name, shortName, date, kind, scope, whoGets, postingRule, greetingText, note }, tiers: [..] }.
// Output { status, linkedin, whatsapp, note? }: plain text, no offer, signed.

import { registerParagraph } from './_shared.mjs';

export const name = 'greetingTemplates';
export const description = 'Writes the WhatsApp Status line, the LinkedIn line and the one-to-one WhatsApp line for a festival or national day. Plain, no offer, signed.';
export const inputFields = ['event', 'tiers'];

export const SIGNATURE = 'Palak Gupta, Venture Drafters';

const GREETING_RULES = [
  'This is a greeting, not marketing. Write plain text that a person would type to a business contact.',
  `Sign every line "${SIGNATURE}". The signature is the last words of the line.`,
  'No offer, no call to action, no mention of our services, solutions, calls or prices, no link, no hashtag, no emoji, no exclamation mark. Do not claim anything about the business.',
  'No topical tie-ins to news, markets or the economy. No "may your business run better".',
  'Use the customary wording of the occasion for its community, exactly: Eid al-Fitr and Eid al-Adha, "Eid Mubarak" (Eid al-Adha: "Eid al-Adha Mubarak"); Ramadan, "Ramadan Mubarak"; Milad-un-Nabi, "Eid Milad-un-Nabi Mubarak"; Guru Nanak Jayanti, "Gurpurab di lakh lakh vadhaiyan"; Lohri, "Warm wishes on Lohri"; Christmas, "Merry Christmas"; Easter, "Wishing you a blessed Easter"; Mahavir Jayanti, the message of ahimsa; Samvatsari, "Michhami Dukkadam" followed by a plain request for forgiveness. These customary phrases are the only non-English words allowed, and only in the place the occasion calls for.',
  'Diwali is "joyous and prosperous", Holi "joyful and colourful", national days "respectful greetings" or "warm wishes". Keep to these plain forms; do not invent new blessings. Never "best wishes": "best" is a word the brief blocks everywhere; write "warm wishes".',
  'WhatsApp Status: one or two short lines, thirty words at most before the signature. The firm\'s card is not used; this is typed text.',
  'LinkedIn: two to four short lines from Palak Gupta in the first person, thirty to sixty words, no hashtags, no mention of Venture Drafters beyond the signature.',
  'WhatsApp one-to-one: one line, thirty words at most before the signature, with no name in it (the first name and "ji" are added when the touch is created).',
  'If the occasion is one a firm should not greet (Good Friday, Muharram, Ashura, Pitru Paksha, a martyrdom day, any mourning day), return empty strings for all three and say why in "note".',
  'If the event already carries a greeting text, keep its wording and meaning and improve only what is needed to satisfy the rules above.',
];

export function buildPrompt(input, ctx) {
  const ev = input?.event || {};
  const tiers = Array.isArray(input?.tiers) ? input.tiers : [];
  const system = [
    registerParagraph(ctx, 'greeting'),
    'This operation writes festival and national-day greetings.\n' + GREETING_RULES.map((l) => `- ${l}`).join('\n'),
  ].join('\n\n');
  const user = [
    `Occasion: ${ev.shortName || ev.name || ''}`,
    ev.name && ev.name !== ev.shortName ? `Full calendar entry: ${ev.name}` : '',
    `Date: ${ev.date || ''}`,
    `Scope: ${ev.scope || 'national'}`,
    `Who receives it: ${ev.whoGets || 'everyone'}`,
    tiers.length ? `Network tiers receiving the one-to-one line: ${tiers.join(', ')}` : 'No network tier receives a one-to-one line; this is a Status greeting.',
    ev.greetingText ? `Existing greeting text: ${ev.greetingText}` : '',
    ev.note ? `Calendar note: ${ev.note}` : '',
    '',
    'Write the three lines.',
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
    status: { type: 'string', description: 'WhatsApp Status line, signed' },
    linkedin: { type: 'string', description: 'LinkedIn post text from Palak Gupta, signed, no hashtags' },
    whatsapp: { type: 'string', description: 'One-to-one WhatsApp line without a name, signed' },
    note: { type: 'string', description: 'Only when the occasion should not be greeted: the reason' },
  },
  required: ['status', 'linkedin', 'whatsapp'],
  additionalProperties: false,
};

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

function clean(text, { block = false } = {}) {
  let t = String(text ?? '').replace(EMOJI, '').replace(/!/g, '.').replace(/#\w+/g, '').replace(/[ \t]+\n/g, '\n').trim();
  t = t.replace(/\.\.+/g, '.');
  if (!t) return '';
  if (!t.endsWith(SIGNATURE)) {
    const stripped = t.replace(/\s*Palak Gupta,? Venture Drafters\.?$/i, '').trim();
    const body = /[.?)]$/.test(stripped) ? stripped : `${stripped}.`;
    t = `${body}${block ? '\n\n' : ' '}${SIGNATURE}`;
  }
  return t;
}

export function postProcess(output) {
  return {
    ...output,
    status: clean(output.status),
    linkedin: clean(output.linkedin, { block: true }),
    whatsapp: clean(output.whatsapp),
  };
}
