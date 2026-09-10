export const ASK_KEEVARIS_FUNCTION_NAME = 'ask_keevaris'

/**
 * Becomes the Deepgram function's `description` — this is the "when to
 * delegate" instruction, read by the fast think-model to decide whether to
 * call the function instead of answering itself.
 */
export const ASK_KEEVARIS_DESCRIPTION =
  'Call this function when the caller needs a company fact or an action from the prompt. ' +
    'Do not answer those yourself.\n\n' +
    'Pass the caller\'s question as plain text in `query`, close to verbatim, plus any size, name, ' +
    'phone, or email already given on this call.\n\n' +
    'After the returned answer is spoken, do not repeat its content. Do not summarize, rephrase, ' +
    'or add a follow-up. Wait for the caller.'

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
      'language. If they ask to switch or continue in a language, switch immediately and do not ' +
      `call ${ASK_KEEVARIS_FUNCTION_NAME}.`,
    ...promptAdditions
  ].join('\n')
}
