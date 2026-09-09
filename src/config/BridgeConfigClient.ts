import { ASK_KEEVARIS_FUNCTION_NAME } from '../agent/prompt.js'
import { config, type BridgeCredentials } from '../config.js'
import { logger } from '../logger.js'
import type { DependencyHealthReporter } from '../server/DependencyHealth.js'
import type { BridgeConfig } from './types.js'

const FALLBACK_GREETING_TEMPLATE = 'I am an automated assistant for {company}.'
const FALLBACK_FILLER = 'Let me check that for you.'
const FALLBACK_PROMPT_ADDITIONS: Array<string> = [
  'You are a sales operator for this self-storage site. Your job is to help the caller rent a ' +
    'unit: greet them, understand what they need, and keep the conversation moving.',
  'Handle chit-chat, greetings, yes/no/thanks, and small talk yourself. Do not delegate those.',
  'For prices, rates, discounts, and unit availability, call the other agent ' +
    `(${ASK_KEEVARIS_FUNCTION_NAME}). Never invent those figures.`,
  'Always call the other agent ' +
    `(${ASK_KEEVARIS_FUNCTION_NAME}) to do any action: send a quote, text, SMS, email, or link; ` +
    'book, schedule, or confirm a visit; take a name; hold or reserve a unit; ' +
    'resolve a move-in date. Never invent a time or a full phone number.',
  'Never ask the caller for their phone number or email address, and never say you can\'t see ' +
    'their phone — the system already has the number from the call. Ask only for a name, then ' +
    'delegate right away.',
  'Never say a quote was sent, a visit is booked, or a contact was created unless that sentence ' +
    'just came back from the other agent.',
  "Never answer a question about a specific customer's account from memory. Delegate it.",
  'Never speculate about what the company offers. Delegate it.',
  'A delegated answer is spoken for you. After it finishes, stay silent and wait for the caller. ' +
    'Do not summarize, rephrase, or add a follow-up.',
  'A request to continue or switch language is not a fact question. Answer it yourself; do not delegate it.'
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
  constructor(
    private readonly credentials: BridgeCredentials,
    private readonly dependencyHealth?: DependencyHealthReporter
  ) {}

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
        return this.fallback()
      }

      const parsed = parseBridgeConfig(await response.json())
      if (parsed === null) {
        logger.error({}, 'bridge_config.fetch_failed')
        return this.fallback()
      }

      this.dependencyHealth?.report('keevaris', true)
      return parsed
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'bridge_config.fetch_failed')
      return this.fallback()
    } finally {
      clearTimeout(timeout)
    }
  }

  private fallback(): BridgeConfig {
    this.dependencyHealth?.report('keevaris', false)
    return fallbackBridgeConfig()
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
