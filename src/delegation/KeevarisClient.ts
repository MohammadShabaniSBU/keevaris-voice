import { config, type BridgeCredentials } from '../config.js'
import { logger } from '../logger.js'
import type { DelegationClient, DelegationRequest, DelegationResponse } from './types.js'

/**
 * Mirrors `agents.voice.handoff_sentence` in unit-hq-api's config/agents.php.
 * Used only when the backend itself is unreachable/times out — the normal
 * "I can't help with that" case always comes back as real `text` from
 * VoiceBridgeTurn, this is just the last-resort fallback for a dead network.
 */
const FALLBACK_HANDOFF_TEXT = 'Let me put you through to someone who can help.'

/**
 * One question, one answer. Always speaks the flat HTTP contract that
 * VoiceBridgeWireFormat::parse() auto-detects (no `jsonrpc` key) — this
 * service owns session_id/caller_number reliably, so there is no reason to
 * use the A2A envelope that exists only to work around Vocal Bridge.
 *
 * Credentials are per-call (resolved from the inbound number), not the
 * process-wide config. apiUrl and timeoutMs stay deployment-wide.
 */
export class KeevarisClient implements DelegationClient {
  constructor(private readonly credentials: BridgeCredentials) {}

  private bridgeUrl(): string {
    return new URL(`/api/voice/bridge/${this.credentials.bridgeToken}`, config.keevaris.apiUrl).toString()
  }

  async ask(request: DelegationRequest): Promise<DelegationResponse> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.keevaris.timeoutMs)

    try {
      const response = await fetch(this.bridgeUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Voice-Bridge-Secret': this.credentials.bridgeSecret
        },
        body: JSON.stringify(request),
        signal: controller.signal
      })

      if (!response.ok) {
        logger.error(
          { sessionId: request.session_id, turnId: request.turn_id, status: response.status },
          'delegation.http_error'
        )

        return this.fallback(request.session_id, request.turn_id)
      }

      const body = (await response.json()) as Partial<DelegationResponse>
      if (typeof body.text !== 'string') {
        logger.error({ sessionId: request.session_id, turnId: request.turn_id }, 'delegation.malformed_response')

        return this.fallback(request.session_id, request.turn_id)
      }

      return {
        text: body.text,
        transfer: body.transfer === true,
        destination: typeof body.destination === 'string' ? body.destination : undefined
      }
    } catch (error) {
      logger.error(
        { sessionId: request.session_id, turnId: request.turn_id, error: (error as Error).message },
        'delegation.request_failed'
      )

      return this.fallback(request.session_id, request.turn_id)
    } finally {
      clearTimeout(timeout)
    }
  }

  private fallback(sessionId: string, turnId: string): DelegationResponse {
    logger.error({ sessionId, turnId }, 'delegation.fallback_engaged')
    return { text: FALLBACK_HANDOFF_TEXT, transfer: true, destination: 'main_line', clientFallback: true }
  }
}
