import type { TranscriptClient, TranscriptSegment } from '../../src/session/types.js'
import type { EventLog } from './EventLog.js'

export interface TranscriptClientStubConfig {
  reject?: boolean
}

/**
 * Implements TranscriptClient only. `reject: true` still resolves —
 * the real client never throws — and logs the same failure kind.
 */
export class TranscriptClientStub implements TranscriptClient {
  constructor(
    private readonly options: TranscriptClientStubConfig = {},
    private readonly log?: EventLog
  ) {}

  flush(bridgeSessionId: string, segments: Array<TranscriptSegment>): Promise<void> {
    if (this.options.reject === true) {
      this.log?.push({
        on: 'transcript',
        kind: 'transcript.flush_failed',
        bridgeSessionId
      })
      return Promise.resolve()
    }

    for (const segment of segments) {
      this.log?.push({
        on: 'transcript',
        kind: 'segment',
        role: segment.role,
        source: segment.source,
        content: segment.text,
        turnId: segment.turn_id,
        sequence: segment.sequence
      })
    }

    this.log?.push({
      on: 'transcript',
      kind: 'flush',
      bridgeSessionId
    })

    return Promise.resolve()
  }
}
