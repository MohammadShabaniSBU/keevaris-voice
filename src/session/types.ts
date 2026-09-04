import type { AgentProvider } from '../agent/AgentProvider.js'
import type { BridgeConfig } from '../config/types.js'
import type { DelegationClient } from '../delegation/types.js'
import type { Transport } from '../transport/Transport.js'

export interface VoiceSessionDeps {
  transport: Transport
  agent: AgentProvider
  keevaris: DelegationClient
  filler: string
  transfer: BridgeConfig['transfer']
}
