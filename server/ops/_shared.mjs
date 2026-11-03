// Shared prompt text for every AI operation (section 6, last paragraph). [core]
//
// registerParagraph(ctx, type?) returns the system text every op starts from:
// the register paragraph, rules.frame, the say and never lists, the claims
// allowed and blocked, the course terms, the Solutions list as the only
// solution names, the signed-off examples for the piece type, and the closing
// instruction to return only the JSON the schema asks for.
//
// ctx = { rules, solutions, examples, accounts, settings } (built by ai.mjs).

const REGISTER =
  'You write for Venture Drafters, a systems partner for owner-led Indian businesses with 15 to 100 people. ' +
  'The register is formal and warm: a professional firm addressing a managing director. Short sentences, one idea each, ' +
  'plain words an owner reads on a phone between calls. Sentence case. No emoji, no exclamation marks, no hashtags in the ' +
  'body of a LinkedIn post, no ALL CAPS. Never casual, never coach-style hype. Rupee amounts are written "Rs 20,000", never ' +
  'the rupee glyph; numbers in digits. "follow-ups" always carries the hyphen. Every piece is written in the order Problem, ' +
  'Impact, Solution; nothing opens on us. One Hindi tag ("Task hua?", "ho gaya?") is allowed only inside a quoted owner line, ' +
  'never in our own voice, and never a whole Hindi sentence. Numbers come only from the owner or are clearly marked as an ' +
  'example. Never name a client, a lender or a member of staff. ' +
  'The reader is the owner, founder or MD of an owner-led Indian business with 15 to 100 people (manufacturing, job-work, trading, distribution, ' +
  'a multi-staff service or advisory firm), or the son or daughter who has joined and is systemising it: their day is the phone full of messages, ' +
  'the notes on the desk, the 7 pm, chasing by phone, finding out last. Their words are chase, follow-up, slipped, update. They are buying their ' +
  'time back and the calm of one screen, not software. Every piece carries three beats: the owner\'s moment, what it costs, and the tool we built ' +
  'and run, named from the Solutions list; a piece that stops at the problem is half a piece. Hashtags are lower case.';

function lines(arr, prefix = '- ') {
  return (arr || []).map((x) => `${prefix}${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n');
}

export function registerParagraph(ctx = {}, type) {
  const rules = ctx.rules || {};
  const solutions = ctx.solutions || [];
  const examples = (ctx.examples && type && ctx.examples[type]) || [];
  const blocks = [];

  blocks.push(REGISTER);

  if (rules.frame) blocks.push(`The storyline:\n${rules.frame}`);

  if (rules.voice?.length) blocks.push(`Voice:\n${lines(rules.voice)}`);

  if (rules.say?.length) blocks.push(`Words and phrases we use:\n${rules.say.join(', ')}.`);

  if (rules.never?.length) {
    const any = rules.never.filter((n) => n.scope === 'any').map((n) => n.phrase);
    const headline = rules.never.filter((n) => n.scope === 'headline').map((n) => n.phrase);
    const ourVoice = rules.never.filter((n) => n.scope === 'ourVoice').map((n) => n.phrase);
    const parts = [];
    if (any.length) parts.push(`Never, anywhere: ${any.join('; ')}.`);
    if (headline.length) parts.push(`Never as a hook, title, first line or headline (allowed only as a close): ${headline.join('; ')}.`);
    if (ourVoice.length) parts.push(`Never in our own voice (only inside a quoted owner line): ${ourVoice.join('; ')}.`);
    blocks.push(parts.join('\n'));
  }

  if (rules.courseTerms?.length) {
    blocks.push(`Internal and course terms that must never appear in any public field: ${rules.courseTerms.join(', ')}.`);
  }

  if (rules.claimsOk?.length) blocks.push(`Claims we can make:\n${lines(rules.claimsOk)}`);
  if (rules.claimsBlocked?.length) blocks.push(`Claims we cannot make:\n${lines(rules.claimsBlocked)}`);

  if (rules.allowNames?.length) {
    blocks.push(`The only organisations and places that may be named: ${rules.allowNames.join(', ')}.`);
  }

  if (solutions.length) {
    const list = solutions.map((s) => `- ${s.publicName}: ${s.oneLine || ''}`).join('\n');
    blocks.push(
      'The only solutions you may name are the ones below, by their public name. A solution line names one of them, ' +
      'or says what it does in plain words; never say "system" alone and never invent a tool.\n' + list,
    );
  }

  if (examples.length) {
    blocks.push(`Signed-off examples for a "${type}" piece, in the voice to match:\n${lines(examples)}`);
  }

  blocks.push('Return only the JSON the schema asks for. No preamble, no commentary, no markdown fences.');

  return blocks.join('\n\n');
}

export default registerParagraph;
