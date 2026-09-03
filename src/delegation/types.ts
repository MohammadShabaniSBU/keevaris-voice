/**
 * Body accepted by `unit-hq-api`'s `POST /api/voice/bridge/{bridgeToken}`
 * (the flat HTTP contract; see VoiceBridgeWireFormat::parseHttp).
 */
export interface DelegationRequest {
  query: string
  turn_id: string
  session_id: string
  caller_number: string | null
}

/**
 * Body VoiceBridgeTurn::handle() always returns, whichever path it took
 * (answer, transfer, handoff, or outside-hours).
 */
export interface DelegationResponse {
  text: string
  transfer: boolean
  destination?: string
}

export interface DelegationClient {
  ask(request: DelegationRequest): Promise<DelegationResponse>
}
