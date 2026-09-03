import type { AgentEvent } from '../agent/AgentProvider.js'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { runTransfer } from '../transfer/TransferPolicy.js'
import type { TransportCloseReason } from '../transport/Transport.js'
import type { VoiceSessionDeps } from './types.js'

/**
 * Spoken immediately via `InjectAgentMessage` while the delegation round
 * trip to unit-hq-api is in flight, so the caller is never in silence
 * during the slow agent's turn budget.
 */
const FILLER_TEXT = 'Let me check that for you.'

interface AskKeevarisArguments {
  query?: string
}

type SessionState =
  | { status: 'connecting' | 'active' | 'closing' | 'closed' }
  | { status: 'transferring'; destination: string | undefined }

/**
 * One call, start to finish. Wires the Transport (audio in/out, barge-in,
 * transfer) to the AgentProvider (fast conversation, function calls) and
 * resolves every `ask_keevaris` function call through KeevarisClient.
 *
 * All state here is per-call and in-memory; the only durable record of the
 * call is whatever unit-hq-api itself writes when we delegate to it.
 */
export class VoiceSession {
  private readonly log
  private state: SessionState = { status: 'connecting' }
  private durationCapTimer: ReturnType<typeof setTimeout> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly deps: VoiceSessionDeps) {
    this.log = logger.child({
      component: 'voice-session',
      vendor: deps.transport.vendor
    })
  }

  async start(): Promise<void> {
    const { transport, agent } = this.deps

    this.armDurationCap()
    this.resetIdleTimer()

    transport.onAudio((chunk) => {
      this.resetIdleTimer()
      agent.sendAudio(chunk)
    })
    transport.onClose((reason) => {
      this.log.info({ sessionId: transport.sessionId, reason }, 'session.transport_closed')
      void this.teardown(reason)
    })

    agent.onEvent((event) => this.handleAgentEvent(event))

    try {
      await agent.start(transport.audioInput, transport.audioOutput)
      if (this.state.status === 'connecting') {
        this.state = { status: 'active' }
      }
      this.log.info(
        { sessionId: transport.sessionId, callerNumber: transport.callerNumber },
        'session.started'
      )
    } catch (error) {
      this.log.error(
        { sessionId: transport.sessionId, error: (error as Error).message },
        'session.agent_start_failed'
      )
      await this.teardown('error')
    }
  }

  private handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'audio':
        this.resetIdleTimer()
        this.deps.transport.sendAudio(event.chunk)
        break
      case 'userStartedSpeaking':
        this.deps.transport.clearAudio()
        break
      case 'transcript':
        this.log.info(
          { sessionId: this.deps.transport.sessionId, role: event.role, text: event.text },
          'session.transcript'
        )
        break
      case 'functionCall':
        void this.handleFunctionCall(event.id, event.name, event.arguments)
        break
      case 'agentAudioDone':
        void this.handleAgentAudioDone()
        break
      case 'error':
        this.log.error(
          { sessionId: this.deps.transport.sessionId, message: event.message },
          'session.agent_error'
        )
        void this.teardown('error')
        break
      case 'closed':
        this.log.info(
          { sessionId: this.deps.transport.sessionId, reason: event.reason },
          'session.agent_closed'
        )
        void this.teardown('error')
        break
      default:
        break
    }
  }

  private async handleFunctionCall(id: string, name: string, rawArguments: string): Promise<void> {
    const { transport, agent, keevaris } = this.deps
    const sessionId = transport.sessionId

    let parsed: AskKeevarisArguments = {}
    try {
      parsed = JSON.parse(rawArguments) as AskKeevarisArguments
    } catch {
      this.log.warn({ sessionId, id, rawArguments }, 'session.function_call_unparseable_arguments')
    }

    const query = typeof parsed.query === 'string' ? parsed.query.trim() : ''
    if (query === '') {
      agent.respondToFunctionCall(id, name, 'I could not understand the question, please ask again.')

      return
    }

    agent.injectAgentMessage(FILLER_TEXT)

    const result = await keevaris.ask({
      query,
      turn_id: id,
      session_id: sessionId,
      caller_number: transport.callerNumber
    })

    this.log.info(
      { sessionId, id, transfer: result.transfer, destination: result.destination },
      'session.delegation_result'
    )

    if (result.transfer && (this.state.status === 'active' || this.state.status === 'connecting')) {
      this.state = { status: 'transferring', destination: result.destination }
    }

    agent.respondToFunctionCall(id, name, result.text)
  }

  /**
   * `AgentAudioDone` fires after every spoken turn, transfer or not — we
   * only act on it when a delegation asked for a transfer, so the caller
   * hears the full transfer sentence before the line moves.
   */
  private async handleAgentAudioDone(): Promise<void> {
    if (this.state.status !== 'transferring') {
      return
    }

    const destination = this.state.destination
    const { transport } = this.deps
    await runTransfer(transport, destination, transport.sessionId)
    await this.teardown('transferred')
  }

  private async teardown(reason: TransportCloseReason): Promise<void> {
    if (this.state.status === 'closing' || this.state.status === 'closed') {
      return
    }

    this.state = { status: 'closing' }
    this.clearTimers()
    await Promise.allSettled([this.deps.transport.close(reason), this.deps.agent.close()])
    this.state = { status: 'closed' }
  }

  private armDurationCap(): void {
    this.durationCapTimer = setTimeout(() => {
      void this.teardown('duration_cap')
    }, config.session.maxCallMs)
  }

  private resetIdleTimer(): void {
    if (this.state.status === 'closing' || this.state.status === 'closed') {
      return
    }

    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer)
    }

    this.idleTimer = setTimeout(() => {
      void this.teardown('idle_timeout')
    }, config.session.idleTimeoutMs)
  }

  private clearTimers(): void {
    if (this.durationCapTimer !== undefined) {
      clearTimeout(this.durationCapTimer)
      this.durationCapTimer = undefined
    }

    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
  }
}
