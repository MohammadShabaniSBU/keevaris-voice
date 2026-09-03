/**
 * Local copy of the prompt shape from unit-hq-api's VoiceBridgeCustomerConfig
 * (docs/roadmap/sprint-28-customer-facing-voice-via-vocal-bridge-delegation/
 * vb-customer-config.json). Kept here rather than fetched at boot so this
 * service has zero runtime dependency on unit-hq-api beyond the delegation
 * call itself.
 *
 * Follow-up, not part of this sketch: serve this from an API endpoint so
 * there is one source of truth and the greeting can vary by site locale
 * instead of being fixed to English here.
 */

export const GREETING_EN = 'I am an automated assistant for {company}.'

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
 * Spoken directly by Deepgram as `agent.greeting` — not routed through the
 * LLM — so the disclosure line is guaranteed verbatim rather than at the
 * mercy of the think-model paraphrasing it (S28-05's "verbatim" invariant,
 * applied here instead of via Vocal Bridge's "External TTS" setting).
 */
export function buildGreeting(companyName: string): string {
  return GREETING_EN.replace('{company}', companyName)
}

export function buildSystemPrompt(): string {
  return [
    'The opening disclosure line has already been spoken to the caller before you receive any ' +
      'input. Do not repeat it, and do not say anything before the caller speaks.',
    'Answer in the language the caller is speaking, even if it differs from the opening line\'s ' +
      'language.',
    'Never state a price, rate, discount, availability count, unit size, size range, date, balance, ' +
      'invoice figure, unit number, or access code yourself. Describe availability and sizes only in ' +
      'general terms (for example, "a range of sizes are available") and delegate any question ' +
      `needing an exact figure by calling ${ASK_KEEVARIS_FUNCTION_NAME}.`,
    'Never answer a question about a specific customer\'s account from memory. Delegate it.',
    'Never speculate about what the company offers. Delegate it.',
    'When you receive a delegated answer, speak it back exactly as given.',
    'Do not read digits, dates, or ranges aloud from your own reasoning — only speak numbers that ' +
      'came back from a delegated answer.'
  ].join('\n')
}
