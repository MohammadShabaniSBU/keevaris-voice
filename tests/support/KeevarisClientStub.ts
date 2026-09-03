import type {
  DelegationClient,
  DelegationRequest,
  DelegationResponse
} from '../../src/delegation/types.js'

export interface KeevarisClientStubConfig {
  delayMs?: number
  response?: DelegationResponse
  reject?: boolean
}

const DEFAULT_RESPONSE: DelegationResponse = {
  text: 'We are open from 8 to 6.',
  transfer: false
}

/**
 * Implements DelegationClient only — does not inherit KeevarisClient, so it
 * cannot pick up the retry / hours-aware fallback V02-03 will add there.
 */
export class KeevarisClientStub implements DelegationClient {
  constructor(private readonly config: KeevarisClientStubConfig = {}) {}

  ask(_request: DelegationRequest): Promise<DelegationResponse> {
    if (this.config.reject === true) {
      return Promise.reject(new Error('delegation stub rejected'))
    }

    const response = this.config.response ?? DEFAULT_RESPONSE
    const delayMs = this.config.delayMs ?? 0
    if (delayMs <= 0) {
      return Promise.resolve(response)
    }

    return new Promise((resolve) => {
      setTimeout(() => resolve(response), delayMs)
    })
  }
}
