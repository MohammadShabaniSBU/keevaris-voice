import type { AgentProvider } from '../agent/AgentProvider.js'
import type { BridgeConfig } from '../config/types.js'
import type { DelegationClient } from '../delegation/types.js'
import type { Transport, TransportCloseReason } from '../transport/Transport.js'

export interface SessionLifecycleClient {
  open(bridgeSessionId: string, callerNumber: string | null): Promise<void>
  end(bridgeSessionId: string, reason: TransportCloseReason): Promise<void>
}

export type TranscriptRole = 'caller' | 'agent'
export type TranscriptSource = 'stt' | 'fast_model' | 'delegated'

export interface TranscriptSegment {
  sequence: number
  role: TranscriptRole
  text: string
  source: TranscriptSource
  occurred_at: string
  turn_id?: string
}

export interface TranscriptClient {
  flush(bridgeSessionId: string, segments: Array<TranscriptSegment>): Promise<void>
}

export interface VoiceSessionDeps {
  transport: Transport
  agent: AgentProvider
  keevaris: DelegationClient
  sessionLifecycle: SessionLifecycleClient
  transcript: TranscriptClient
  filler: string
  transfer: BridgeConfig['transfer']
}
