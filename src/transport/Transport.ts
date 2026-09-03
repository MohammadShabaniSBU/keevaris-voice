/**
 * Audio format a transport speaks. Drives the Deepgram `Settings.audio`
 * block so nothing gets resampled in between.
 */
export interface AudioFormat {
  encoding: 'mulaw' | 'linear16'
  sampleRate: number
}

export type TransportCloseReason =
  | 'caller_hangup'
  | 'transferred'
  | 'error'
  | 'server_shutdown'
  | 'duration_cap'
  | 'idle_timeout'

/**
 * One live call/session on one vendor. Twilio phone calls and browser mic
 * sessions both implement this; `VoiceSession` never knows which one it has.
 *
 * Implementations must call their close handler exactly once, including on
 * error, so the orchestrator can always release the paired AgentProvider.
 */
export interface Transport {
  readonly vendor: string
  /** Becomes `voice_sessions.bridge_session_id` on the Laravel side. */
  readonly sessionId: string
  readonly callerNumber: string | null
  /** Twilio is symmetric (mulaw 8k both ways); web is not (16k in, 24k out). */
  readonly audioInput: AudioFormat
  readonly audioOutput: AudioFormat

  onAudio(handler: (chunk: Buffer) => void): void
  onClose(handler: (reason: TransportCloseReason) => void): void

  sendAudio(chunk: Buffer): void
  /** Barge-in: discard whatever playback the transport has buffered. */
  clearAudio(): void

  transfer(destinationNumber: string): Promise<void>
  close(reason: TransportCloseReason): Promise<void>
}
