// The smallest real operation: proves the bridge end to end. [core]
// Input { text } -> output { echo, wordCount }.

import { registerParagraph } from './_shared.mjs';

export const name = 'ping';
export const description = 'Echoes a line of text and counts its words. Used to test the AI bridge.';
export const inputFields = ['text'];

export function buildPrompt(input, ctx) {
  const text = String(input?.text ?? '').trim();
  const system =
    registerParagraph(ctx) +
    '\n\nThis is a connectivity test. Echo the text exactly as given in "echo" and put the number of words it contains in "wordCount".';
  const user = `Text: ${text}`;
  return { system, user };
}

export const schema = {
  type: 'object',
  properties: {
    echo: { type: 'string', description: 'The text, exactly as given' },
    wordCount: { type: 'integer', description: 'How many words the text contains' },
  },
  required: ['echo', 'wordCount'],
  additionalProperties: false,
};

export function postProcess(output, input) {
  // The model's count is checked against our own, so the test is honest.
  const ours = String(input?.text ?? '').trim().split(/\s+/).filter(Boolean).length;
  return { ...output, localWordCount: ours, agrees: ours === output.wordCount };
}
