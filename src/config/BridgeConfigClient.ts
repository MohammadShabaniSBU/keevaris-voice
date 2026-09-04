import { ASK_KEEVARIS_FUNCTION_NAME } from '../agent/prompt.js'
import { config, type BridgeCredentials } from '../config.js'
import { logger } from '../logger.js'
import type { BridgeConfig } from './types.js'

const FALLBACK_GREETING_TEMPLATE = 'I am an automated assistant for {company}.'
const FALLBACK_FILLER = 'Let me check that for you.'
const FALLBACK_PROMPT_ADDITIONS: Array<string> = [
  'Never state a price, rate, discount, availability count, unit size, size range, date, balance, ' +
    'invoice figure, unit number, or access code yourself. Describe availability and sizes only in ' +
    'general terms (for example, "a range of sizes are available") and delegate any question ' +
    `needing an exact figure by calling ${ASK_KEEVARIS_FUNCTION_NAME}.`,
  "Never answer a question about a specific customer's account from memory. Delegate it.",
  'Never speculate about what the company offers. Delegate it.',
  'When you receive a delegated answer, speak it back exactly as given.',
  'Do not read digits, dates, or ranges aloud from your own reasoning — only speak numbers that ' +
    'came back from a delegated answer.'
]

/**
 * English defaults used when GET /config fails. COMPANY_NAME and the two
 * transfer-number env vars stay as fallbacks so a brief API outage still
 * produces a speakable greeting instead of dropping the call.
 */
export function fallbackBridgeConfig(): BridgeConfig {
  return {
    companyName: config.companyName,
    locale: 'en',
    greeting: FALLBACK_GREETING_TEMPLATE.replace('{company}', config.companyName),
    filler: FALLBACK_FILLER,
    promptAdditions: FALLBACK_PROMPT_ADDITIONS,
    transfer: {
      mainLineNumber: config.transfer.mainLineNumber || null,
      voicemailNumber: config.transfer.voicemailNumber || null
    },
    maxCallDurationMinutes: 30
  }
}

/**
 * Fetches per-call prompt / greeting / filler / transfer numbers from
 * unit-hq-api. Same credential shape as KeevarisClient; never throws —
 * timeout, non-2xx, and malformed bodies all log and fall back.
 */
export class BridgeConfigClient {
  constructor(private readonly credentials: BridgeCredentials) {}

  private configUrl(): string {
    return new URL(
      `/api/voice/bridge/${this.credentials.bridgeToken}/config`,
      config.keevaris.apiUrl
    ).toString()
  }

  async fetchConfig(): Promise<BridgeConfig> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.keevaris.timeoutMs)

    try {
      const response = await fetch(this.configUrl(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Voice-Bridge-Secret': this.credentials.bridgeSecret
        },
        signal: controller.signal
      })

      if (!response.ok) {
        logger.error({ status: response.status }, 'bridge_config.fetch_failed')
        return fallbackBridgeConfig()
      }

      const parsed = parseBridgeConfig(await response.json())
      if (parsed === null) {
        logger.error({}, 'bridge_config.fetch_failed')
        return fallbackBridgeConfig()
      }

      return parsed
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'bridge_config.fetch_failed')
      return fallbackBridgeConfig()
    } finally {
      clearTimeout(timeout)
    }
  }
}

function parseBridgeConfig(body: unknown): BridgeConfig | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }

  const record = body as Record<string, unknown>
  if (typeof record.company_name !== 'string') return null
  if (typeof record.locale !== 'string') return null
  if (typeof record.greeting !== 'string') return null
  if (typeof record.filler !== 'string') return null
  if (!Array.isArray(record.prompt_additions)) return null
  if (!record.prompt_additions.every((item) => typeof item === 'string')) return null
  if (typeof record.max_call_duration_minutes !== 'number') return null
  if (typeof record.transfer !== 'object' || record.transfer === null) return null

  const transfer = record.transfer as Record<string, unknown>
  if (transfer.main_line_number !== null && typeof transfer.main_line_number !== 'string') {
    return null
  }
  if (transfer.voicemail_number !== null && typeof transfer.voicemail_number !== 'string') {
    return null
  }

  return {
    companyName: record.company_name,
    locale: record.locale,
    greeting: record.greeting,
    filler: record.filler,
    promptAdditions: record.prompt_additions,
    transfer: {
      mainLineNumber: transfer.main_line_number,
      voicemailNumber: transfer.voicemail_number
    },
    maxCallDurationMinutes: record.max_call_duration_minutes
  }
}
