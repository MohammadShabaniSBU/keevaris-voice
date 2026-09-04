import type { AgentProvider } from '../agent/AgentProvider.js'
import type { BridgeConfig } from '../config/types.js'
import type { DelegationClient } from '../delegation/types.js'
import type { Transport, TransportCloseReason } from '../transport/Transport.js'

export interface SessionLifecycleClient {
  open(bridgeSessionId: string, callerNumber: string | null): Promise<void>
  end(bridgeSessionId: string, reason: TransportCloseReason): Promise<void>
}

export interface VoiceSessionDeps {
  transport: Transport
  agent: AgentProvider
  keevaris: DelegationClient
  sessionLifecycle: SessionLifecycleClient
  filler: string
  transfer: BridgeConfig['transfer']
}
