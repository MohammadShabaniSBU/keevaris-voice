export const ASK_KEEVARIS_FUNCTION_NAME = 'ask_keevaris'

/**
 * Becomes the Deepgram function's `description` — this is the "when to
 * delegate" instruction, read by the fast think-model to decide whether to
 * call the function instead of answering itself.
 */
export const ASK_KEEVARIS_DESCRIPTION =
  'Delegate whenever the caller asks anything that needs a fact about this company, this site, ' +
  'this number, a unit, a price, or a customer account. Do not answer those from your own ' +
  'knowledge. Do not guess. Do not paraphrase a remembered answer from earlier in the call if it ' +
  'contained a number.\n\n' +
  'Always delegate:\n' +
  '- sizes, unit types, what we offer, how storage works here\n' +
  '- availability, "do you have space", "how many left"\n' +
  '- prices, rates, discounts, promotions, "how much"\n' +
  '- move-in dates, notice periods, contract terms\n' +
  '- anything about a specific customer\'s account, balance, or contract\n' +
  '- anything you are not certain about\n\n' +
  'Pass the caller\'s question as plain text in `query`, close to verbatim. Speak the returned ' +
  'text back to the caller exactly as given — do not paraphrase or shorten it.'

/**
 * Structural instructions this service owns (opening-disclosure handling,
 * answer-in-the-caller's-language). Content constraints come from
 * `promptAdditions`, served by unit-hq-api.
 */
export function buildSystemPrompt(promptAdditions: Array<string>): string {
  return [
    'The opening disclosure line has already been spoken to the caller before you receive any ' +
      'input. Do not repeat it, and do not say anything before the caller speaks.',
    'Answer in the language the caller is speaking, even if it differs from the opening line\'s ' +
      'language.',
    ...promptAdditions
  ].join('\n')
}
