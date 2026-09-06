export interface CallRegistryEntry {
  callSid: string
  from: string
  to: string
  bridgeToken: string
  bridgeSecret: string
  createdAt: number
}

export interface CallRegistry {
  put(nonce: string, entry: CallRegistryEntry, ttlMs: number): Promise<void>
  /** Single-use: deletes on read. Returns undefined if unknown, expired, or already taken. */
  take(nonce: string): Promise<CallRegistryEntry | undefined>
}

export class InProcessCallRegistry implements CallRegistry {
  private readonly entries = new Map<string, { entry: CallRegistryEntry; expiresAt: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  async put(nonce: string, entry: CallRegistryEntry, ttlMs: number): Promise<void> {
    this.entries.set(nonce, {
      entry,
      expiresAt: this.now() + ttlMs
    })
  }

  async take(nonce: string): Promise<CallRegistryEntry | undefined> {
    const stored = this.entries.get(nonce)
    if (stored === undefined) {
      return undefined
    }

    this.entries.delete(nonce)

    if (stored.expiresAt <= this.now()) {
      return undefined
    }

    return stored.entry
  }
}
