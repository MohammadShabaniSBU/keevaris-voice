import { logger } from '../../logger.js'
import type { CallRegistry, CallRegistryEntry } from './CallRegistry.js'

const KEY_PREFIX = 'call-registry:'
const GET_THEN_DEL = `
local value = redis.call('GET', KEYS[1])
if value then
  redis.call('DEL', KEYS[1])
end
return value
`

/**
 * Minimal command surface RedisCallRegistry needs. ioredis and ioredis-mock
 * both satisfy this; the client is injected so connection lifecycle stays
 * in index.ts.
 */
export interface CallRegistryRedis {
  set(
    key: string,
    value: string,
    expiryMode: 'PX',
    ttlMs: number,
    setMode: 'NX'
  ): Promise<unknown>
  getdel(key: string): Promise<string | null>
  eval(script: string, numKeys: number, key: string): Promise<unknown>
}

export class RedisCallRegistry implements CallRegistry {
  private getdelUnavailable = false
  private readonly log = logger.child({ component: 'redis-call-registry' })

  constructor(private readonly client: CallRegistryRedis) {}

  async put(nonce: string, entry: CallRegistryEntry, ttlMs: number): Promise<void> {
    try {
      await this.client.set(this.key(nonce), JSON.stringify(entry), 'PX', ttlMs, 'NX')
    } catch (error) {
      this.log.error({ error: (error as Error).message }, 'call_registry.put_failed')
    }
  }

  async take(nonce: string): Promise<CallRegistryEntry | undefined> {
    try {
      const raw = await this.takeRaw(this.key(nonce))
      if (typeof raw !== 'string' || raw === '') {
        return undefined
      }

      return JSON.parse(raw) as CallRegistryEntry
    } catch (error) {
      this.log.error({ error: (error as Error).message }, 'call_registry.take_failed')

      return undefined
    }
  }

  private key(nonce: string): string {
    return `${KEY_PREFIX}${nonce}`
  }

  private async takeRaw(key: string): Promise<string | null> {
    if (this.getdelUnavailable || typeof this.client.getdel !== 'function') {
      this.getdelUnavailable = true

      return this.takeViaLua(key)
    }

    try {
      return await this.client.getdel(key)
    } catch (error) {
      if (!this.isGetdelUnavailable(error)) {
        throw error
      }

      this.getdelUnavailable = true

      return this.takeViaLua(key)
    }
  }

  private async takeViaLua(key: string): Promise<string | null> {
    const raw = await this.client.eval(GET_THEN_DEL, 1, key)
    // Redis Lua nil is often surfaced as `false` by ioredis / ioredis-mock.
    if (raw === null || raw === undefined || raw === false) {
      return null
    }

    return String(raw)
  }

  private isGetdelUnavailable(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)

    return /unknown command/i.test(message) || /getdel is not a function/i.test(message)
  }
}
