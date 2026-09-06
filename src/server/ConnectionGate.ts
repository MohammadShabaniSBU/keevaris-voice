import type { TransportCloseReason } from '../transport/Transport.js'

/**
 * Structural so `server/` can enumerate live calls for SIGTERM drain
 * without importing `VoiceSession`.
 */
export interface Teardownable {
  teardown(reason: TransportCloseReason): Promise<void>
}

export class ConnectionGate {
  private active = 0
  private readonly sessions = new Set<Teardownable>()

  constructor(private readonly limit: number) {}

  tryAcquire(): boolean {
    if (this.active >= this.limit) {
      return false
    }

    this.active++

    return true
  }

  release(): void {
    this.active = Math.max(0, this.active - 1)
  }

  get activeCount(): number {
    return this.active
  }

  registerSession(session: Teardownable): void {
    this.sessions.add(session)
  }

  unregisterSession(session: Teardownable): void {
    this.sessions.delete(session)
  }

  get activeSessions(): ReadonlySet<Teardownable> {
    return this.sessions
  }
}
