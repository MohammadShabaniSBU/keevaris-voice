import type { SessionLifecycleClient } from '../../src/session/types.js'
import type { TransportCloseReason } from '../../src/transport/Transport.js'
import type { EventLog } from './EventLog.js'

export interface SessionLifecycleClientStubConfig {
  reject?: boolean
}

/**
 * Implements SessionLifecycleClient only. `reject: true` still resolves —
 * the real client never throws — and logs the same failure kinds.
 */
export class SessionLifecycleClientStub implements SessionLifecycleClient {
  constructor(
    private readonly options: SessionLifecycleClientStubConfig = {},
    private readonly log?: EventLog
  ) {}

  open(bridgeSessionId: string, callerNumber: string | null): Promise<void> {
    if (this.options.reject === true) {
      this.log?.push({ on: 'sessionLifecycle', kind: 'session_lifecycle.open_failed', bridgeSessionId })
      return Promise.resolve()
    }

    this.log?.push({
      on: 'sessionLifecycle',
      kind: 'open',
      bridgeSessionId,
      callerNumber
    })

    return Promise.resolve()
  }

  end(bridgeSessionId: string, reason: TransportCloseReason): Promise<void> {
    if (this.options.reject === true) {
      this.log?.push({
        on: 'sessionLifecycle',
        kind: 'session_lifecycle.end_failed',
        bridgeSessionId,
        reason
      })
      return Promise.resolve()
    }

    this.log?.push({
      on: 'sessionLifecycle',
      kind: 'end',
      bridgeSessionId,
      reason
    })

    return Promise.resolve()
  }
}
