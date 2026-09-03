import type {
  DelegationClient,
  DelegationRequest,
  DelegationResponse
} from '../../src/delegation/types.js'
import type { EventLog } from './EventLog.js'

export interface KeevarisClientStubConfig {
  delayMs?: number
  response?: DelegationResponse
  responses?: Array<DelegationResponse>
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
  private nextResponseIndex = 0

  constructor(
    private readonly config: KeevarisClientStubConfig = {},
    private readonly log?: EventLog
  ) {}

  ask(request: DelegationRequest): Promise<DelegationResponse> {
    this.log?.push({
      on: 'delegation',
      kind: 'ask',
      callerUtterance: request.caller_utterance,
      query: request.query,
      turnId: request.turn_id
    })

    if (this.config.reject === true) {
      return Promise.reject(new Error('delegation stub rejected'))
    }

    const response = this.nextResponse()
    const delayMs = this.config.delayMs ?? 0
    if (delayMs <= 0) {
      return Promise.resolve(response)
    }

    return new Promise((resolve) => {
      setTimeout(() => resolve(response), delayMs)
    })
  }

  private nextResponse(): DelegationResponse {
    const sequenced = this.config.responses
    if (sequenced !== undefined && sequenced.length > 0) {
      const index = Math.min(this.nextResponseIndex, sequenced.length - 1)
      this.nextResponseIndex += 1
      return sequenced[index] as DelegationResponse
    }

    return this.config.response ?? DEFAULT_RESPONSE
  }
}
