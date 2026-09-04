import { config, type BridgeCredentials } from '../config.js'
import { logger } from '../logger.js'
import type { TransportCloseReason } from '../transport/Transport.js'
import type { SessionLifecycleClient as SessionLifecycleClientContract } from './types.js'

/**
 * Opens and ends the durable voice_sessions row on unit-hq-api. Same
 * credential / timeout / never-throws posture as BridgeConfigClient and
 * KeevarisClient — losing the session record must never drop the call.
 */
export class SessionLifecycleClient implements SessionLifecycleClientContract {
  constructor(private readonly credentials: BridgeCredentials) {}

  private openUrl(): string {
    return new URL(
      `/api/voice/bridge/${this.credentials.bridgeToken}/session`,
      config.keevaris.apiUrl
    ).toString()
  }

  private endUrl(bridgeSessionId: string): string {
    return new URL(
      `/api/voice/bridge/${this.credentials.bridgeToken}/session/${encodeURIComponent(bridgeSessionId)}/end`,
      config.keevaris.apiUrl
    ).toString()
  }

  async open(bridgeSessionId: string, callerNumber: string | null): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.keevaris.timeoutMs)

    try {
      const response = await fetch(this.openUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Voice-Bridge-Secret': this.credentials.bridgeSecret
        },
        body: JSON.stringify({
          bridge_session_id: bridgeSessionId,
          caller_number: callerNumber
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        logger.error({ sessionId: bridgeSessionId, status: response.status }, 'session_lifecycle.open_failed')
      }
    } catch (error) {
      logger.error({ sessionId: bridgeSessionId, error: (error as Error).message }, 'session_lifecycle.open_failed')
    } finally {
      clearTimeout(timeout)
    }
  }

  async end(bridgeSessionId: string, reason: TransportCloseReason): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.keevaris.timeoutMs)

    try {
      const response = await fetch(this.endUrl(bridgeSessionId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Voice-Bridge-Secret': this.credentials.bridgeSecret
        },
        body: JSON.stringify({ end_reason: reason }),
        signal: controller.signal
      })

      if (!response.ok) {
        logger.error(
          { sessionId: bridgeSessionId, reason, status: response.status },
          'session_lifecycle.end_failed'
        )
      }
    } catch (error) {
      logger.error(
        { sessionId: bridgeSessionId, reason, error: (error as Error).message },
        'session_lifecycle.end_failed'
      )
    } finally {
      clearTimeout(timeout)
    }
  }
}
