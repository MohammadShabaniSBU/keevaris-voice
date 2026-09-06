export type DependencyName = 'deepgram' | 'keevaris'

export interface DependencyHealthReporter {
  report(name: DependencyName, ok: boolean): void
}

interface DependencyEntry {
  ok: boolean
  at: number
}

/**
 * Passive reachability cache. Callers report the result of a real Deepgram
 * connect or `unit-hq-api` fetch; nothing here opens a synthetic ping.
 * A recorded failure older than `staleAfterMs` is forgotten so a quiet
 * process is not stuck unready after the outage has passed.
 */
export class DependencyHealth implements DependencyHealthReporter {
  private readonly entries = new Map<DependencyName, DependencyEntry>()
  private sweepTimer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly staleAfterMs: number,
    private readonly sweepIntervalMs: number
  ) {}

  report(name: DependencyName, ok: boolean): void {
    this.entries.set(name, { ok, at: Date.now() })
  }

  sweep(): void {
    const now = Date.now()
    for (const [name, entry] of this.entries) {
      if (now - entry.at >= this.staleAfterMs) {
        this.entries.delete(name)
      }
    }
  }

  startSweeping(): void {
    this.stopSweeping()
    this.sweepTimer = setInterval(() => {
      this.sweep()
    }, this.sweepIntervalMs)
    this.sweepTimer.unref()
  }

  stopSweeping(): void {
    if (this.sweepTimer === undefined) {
      return
    }

    clearInterval(this.sweepTimer)
    this.sweepTimer = undefined
  }

  isHealthy(): boolean {
    for (const entry of this.entries.values()) {
      if (!entry.ok) {
        return false
      }
    }

    return true
  }
}
