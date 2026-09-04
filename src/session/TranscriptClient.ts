import { config, type BridgeCredentials } from '../config.js'
import { logger } from '../logger.js'
import type { TranscriptClient as TranscriptClientContract, TranscriptSegment } from './types.js'

/**
 * Flushes the in-memory transcript buffer to unit-hq-api at teardown.
 * Same credential / timeout / never-throws posture as SessionLifecycleClient
 * — losing the transcript must never drop the call.
 */
export class TranscriptClient implements TranscriptClientContract {
  constructor(private readonly credentials: BridgeCredentials) {}

  private flushUrl(bridgeSessionId: string): string {
    return new URL(
      `/api/voice/bridge/${this.credentials.bridgeToken}/session/${encodeURIComponent(bridgeSessionId)}/transcript`,
      config.keevaris.apiUrl
    ).toString()
  }

  async flush(bridgeSessionId: string, segments: Array<TranscriptSegment>): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.keevaris.timeoutMs)

    try {
      const response = await fetch(this.flushUrl(bridgeSessionId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Voice-Bridge-Secret': this.credentials.bridgeSecret
        },
        body: JSON.stringify({ segments }),
        signal: controller.signal
      })

      if (!response.ok) {
        logger.error(
          { sessionId: bridgeSessionId, status: response.status, count: segments.length },
          'transcript.flush_failed'
        )
      }
    } catch (error) {
      logger.error(
        { sessionId: bridgeSessionId, count: segments.length, error: (error as Error).message },
        'transcript.flush_failed'
      )
    } finally {
      clearTimeout(timeout)
    }
  }
}
