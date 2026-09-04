import { config } from '../../config.js'
import type { AudioFormat } from '../../transport/Transport.js'
import { ASK_KEEVARIS_DESCRIPTION, ASK_KEEVARIS_FUNCTION_NAME, buildSystemPrompt } from '../prompt.js'

export interface DeepgramSettingsOptions {
  greeting: string
  promptAdditions: Array<string>
}

/**
 * The one `Settings` message that configures the whole Deepgram Voice Agent
 * session: audio format (matched to the transport, so no resampling),
 * listen/think/speak providers, and the `ask_keevaris` function.
 *
 * `ask_keevaris` has no `endpoint` — that makes it a client-side function
 * call: Deepgram sends us a `FunctionCallRequest` and waits for our
 * `FunctionCallResponse` rather than calling a URL itself. That is what lets
 * `VoiceSession` inject a filler message and control the exact delegation
 * request shape via `KeevarisClient`.
 */
export function buildSettingsMessage(input: AudioFormat, output: AudioFormat, options: DeepgramSettingsOptions) {
  return {
    type: 'Settings',
    audio: {
      input: { encoding: input.encoding, sample_rate: input.sampleRate },
      output: { encoding: output.encoding, sample_rate: output.sampleRate, container: 'none' }
    },
    agent: {
      language: 'en',
      listen: {
        provider: { type: 'deepgram', version: 'v2', model: config.deepgram.listenModel }
      },
      think: {
        provider: { type: config.deepgram.thinkProvider, model: config.deepgram.thinkModel },
        prompt: buildSystemPrompt(options.promptAdditions),
        functions: [
          {
            name: ASK_KEEVARIS_FUNCTION_NAME,
            description: ASK_KEEVARIS_DESCRIPTION,
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'The caller\'s question, close to verbatim.'
                }
              },
              required: ['query']
            }
          }
        ]
      },
      speak: {
        provider: { type: 'deepgram', version: 'v2', model: config.deepgram.speakModel }
      },
      greeting: options.greeting
    }
  }
}
