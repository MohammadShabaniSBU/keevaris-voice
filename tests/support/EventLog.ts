export type EventLogOn = 'transport' | 'agentSocket' | 'session' | 'delegation' | 'bridgeConfig'

export interface EventLogEntry {
  t: number
  on: EventLogOn
  kind: string
  [key: string]: unknown
}

/**
 * Shared chronological log written by both test doubles. `t` is Date.now()
 * at push time — under mocked timers that is the virtual clock.
 */
export class EventLog {
  readonly entries: Array<EventLogEntry> = []

  push(entry: Omit<EventLogEntry, 't'>): void {
    this.entries.push({ t: Date.now(), ...entry })
  }
}
