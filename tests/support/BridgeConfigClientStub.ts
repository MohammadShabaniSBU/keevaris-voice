import { fallbackBridgeConfig } from '../../src/config/BridgeConfigClient.js'
import type { BridgeConfig } from '../../src/config/types.js'
import type { EventLog } from './EventLog.js'

export interface BridgeConfigClientStubConfig {
  response?: BridgeConfig
  reject?: boolean
}

/**
 * Implements the same fetchConfig() surface as BridgeConfigClient.
 * `reject: true` logs `bridge_config.fetch_failed` and returns the English
 * fallback — the real client never throws.
 */
export class BridgeConfigClientStub {
  constructor(
    private readonly options: BridgeConfigClientStubConfig = {},
    private readonly log?: EventLog
  ) {}

  fetchConfig(): Promise<BridgeConfig> {
    if (this.options.reject === true) {
      this.log?.push({ on: 'bridgeConfig', kind: 'bridge_config.fetch_failed' })
      return Promise.resolve(fallbackBridgeConfig())
    }

    return Promise.resolve(this.options.response ?? fallbackBridgeConfig())
  }
}
