import type { AgentProvider } from '../agent/AgentProvider.js'
import type { DelegationClient } from '../delegation/types.js'
import type { Transport } from '../transport/Transport.js'

export interface VoiceSessionDeps {
  transport: Transport
  agent: AgentProvider
  keevaris: DelegationClient
  /** Used to render the greeting template; a stand-in until the greeting is served from the API. */
  companyName: string
}
