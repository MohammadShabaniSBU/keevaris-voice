import type { AudioFormat } from '../transport/Transport.js'

export type AgentEvent =
  | { type: 'audio'; chunk: Buffer }
  | { type: 'userStartedSpeaking' }
  | { type: 'transcript'; role: 'user' | 'agent'; text: string }
  | { type: 'functionCalls'; calls: Array<{ id: string; name: string; arguments: string }> }
  | { type: 'agentAudioDone' }
  | { type: 'closed'; reason: string }
  | { type: 'error'; message: string }

/**
 * The fast conversational vendor (Deepgram today). Owns STT, the small/fast
 * LLM, TTS, and barge-in detection; the only thing it is not allowed to do
 * on its own is state a fact — that always goes through a `functionCalls`
 * event that `VoiceSession` resolves via `KeevarisClient`.
 *
 * Swapping vendors means implementing this interface; nothing in
 * `VoiceSession` or the transports needs to change.
 */
export interface AgentProvider {
  start(input: AudioFormat, output: AudioFormat): Promise<void>
  sendAudio(chunk: Buffer): void
  /** Latency filler while a functionCall is being resolved. */
  injectAgentMessage(text: string): void
  respondToFunctionCall(id: string, name: string, output: string): void
  onEvent(handler: (event: AgentEvent) => void): void
  close(): Promise<void>
}
