/**
 * Caller / front-desk turns the API has not yet seen. Delegated answers
 * are omitted — AgentRuntime already persisted those itself.
 */
export interface DelegationContextSegment {
  sequence: number
  role: 'caller' | 'agent'
  text: string
  source: 'stt' | 'fast_model'
  occurred_at: string
}

/**
 * Body accepted by `unit-hq-api`'s `POST /api/voice/bridge/{bridgeToken}`
 * (the flat HTTP contract; see VoiceBridgeWireFormat::parseHttp).
 */
export interface DelegationRequest {
  query: string
  turn_id: string
  session_id: string
  caller_number: string | null
  caller_utterance: string | null
  context_segments: Array<DelegationContextSegment>
}

/**
 * Body VoiceBridgeTurn::handle() always returns, whichever path it took
 * (answer, transfer, handoff, or outside-hours).
 */
export interface DelegationResponse {
  text: string
  transfer: boolean
  destination?: string
  /** Set only by KeevarisClient.fallback() — never present in a real
   *  backend response. Distinguishes "our client gave up" from a
   *  legitimate backend-directed transfer. */
  clientFallback?: true
}

export interface DelegationClient {
  ask(request: DelegationRequest): Promise<DelegationResponse>
}
