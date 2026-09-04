import type { AgentEvent } from '../agent/AgentProvider.js'
import { config } from '../config.js'
import { logger } from '../logger.js'
import type { DelegationResponse } from '../delegation/types.js'
import { runTransfer } from '../transfer/TransferPolicy.js'
import type { TransportCloseReason } from '../transport/Transport.js'
import type { VoiceSessionDeps } from './types.js'

interface AskKeevarisArguments {
  query?: string
}

interface FunctionCall {
  id: string
  name: string
  arguments: string
}

interface DelegationResultForCall {
  call: FunctionCall
  text: string
  transfer: boolean
  destination: string | undefined
}

function buildFunctionCallStub(result: DelegationResultForCall): string {
  return result.transfer
    ? 'Answered. The caller is being transferred.'
    : 'Answered. Continue the conversation naturally.'
}

type SessionState =
  | { status: 'connecting' | 'active' | 'closing' | 'closed' }
  | { status: 'transferring'; destination: string | undefined }

type SpeechKind = 'nothing' | 'greeting' | 'filler' | 'answer'
type SpokenKind = Exclude<SpeechKind, 'nothing'>
type TransferTrigger = 'answer_done' | 'deadline' | 'teardown'

type SessionLogSink = (entry: { kind: string } & Record<string, unknown>) => void

let sessionLogSink: SessionLogSink | undefined

/** Fixture runner attaches this so `session.*` log lines can be asserted. */
export function attachSessionLogSink(sink: SessionLogSink | undefined): void {
  sessionLogSink = sink
}

/**
 * One call, start to finish. Wires the Transport (audio in/out, barge-in,
 * transfer) to the AgentProvider (fast conversation, function calls) and
 * resolves every `ask_keevaris` function call through KeevarisClient.
 *
 * All state here is per-call and in-memory. The durable session row is
 * opened at connection start and closed from teardown via SessionLifecycleClient.
 */
export class VoiceSession {
  private readonly log
  private state: SessionState = { status: 'connecting' }
  private speech: SpeechKind = 'nothing'
  private readonly upcomingSpeech: Array<SpokenKind> = []
  private transferDispatched = false
  private lastCallerUtterance: string | undefined
  private turnSequence = 0
  /**
   * Set only by `transport.onClose`. `'error'` as a close reason is
   * ambiguous — both a dead Twilio socket and a dead Deepgram socket
   * arrive as `teardown('error')` — so the transfer-on-teardown gate
   * reads this flag, not the reason string.
   */
  private transportGone = false
  private durationCapTimer: ReturnType<typeof setTimeout> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private transferDeadlineTimer: ReturnType<typeof setTimeout> | undefined

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
      this.transportGone = true
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
        if (event.role === 'user') {
          this.lastCallerUtterance = event.text
        }
        this.log.info(
          { sessionId: this.deps.transport.sessionId, role: event.role, text: event.text },
          'session.transcript'
        )
        break
      case 'functionCalls':
        void this.handleFunctionCalls(event.calls)
        break
      case 'agentAudioDone':
        this.handleAgentAudioDone()
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

  private async handleFunctionCalls(calls: Array<FunctionCall>): Promise<void> {
    const { transport, agent, keevaris } = this.deps
    const sessionId = transport.sessionId
    const turnId = this.mintTurnId()

    const parsed = calls.map((call) => {
      let args: AskKeevarisArguments = {}
      try {
        args = JSON.parse(call.arguments) as AskKeevarisArguments
      } catch {
        this.log.warn({ sessionId, id: call.id, rawArguments: call.arguments }, 'session.function_call_unparseable_arguments')
      }

      const query = typeof args.query === 'string' ? args.query.trim() : ''
      return { call, query }
    })

    const needsDelegation = parsed.some((entry) => entry.query !== '')
    if (needsDelegation) {
      this.enqueueSpeech('filler')
      agent.injectAgentMessage(this.deps.filler)
    }

    const results = await Promise.all(
      parsed.map(async (entry, index) => {
        if (entry.query === '') {
          return {
            call: entry.call,
            text: 'I could not understand the question, please ask again.',
            transfer: false,
            destination: undefined
          }
        }

        const result = await keevaris.ask({
          query: entry.query,
          turn_id: `${turnId}:${index}`,
          session_id: sessionId,
          caller_number: transport.callerNumber,
          caller_utterance: this.lastCallerUtterance ?? null
        })

        this.sessionLog(
          {
            sessionId,
            id: entry.call.id,
            transfer: result.transfer,
            destination: result.destination,
            clientFallback: result.clientFallback === true
          },
          'session.delegation_result'
        )

        return {
          call: entry.call,
          text: result.text,
          transfer: result.transfer,
          destination: result.destination
        }
      })
    )

    if (this.state.status === 'closing' || this.state.status === 'closed') {
      return
    }

    const answerText = results.map((result) => result.text).join('\n')
    agent.injectAgentMessage(answerText)
    this.enqueueSpeech('answer')

    for (const result of results) {
      agent.respondToFunctionCall(result.call.id, result.call.name, buildFunctionCallStub(result))
    }

    this.armTransferIfRequested(results)
  }

  private mintTurnId(): string {
    this.turnSequence += 1
    return `${this.deps.transport.sessionId}:${this.turnSequence}`
  }

  private armTransferIfRequested(results: Array<Pick<DelegationResponse, 'transfer' | 'destination'>>): void {
    if (this.state.status !== 'active' && this.state.status !== 'connecting') {
      return
    }

    const firstTransfer = results.find((result) => result.transfer)
    if (firstTransfer === undefined) {
      return
    }

    this.state = { status: 'transferring', destination: firstTransfer.destination }
    this.armTransferDeadline()
  }

  /**
   * `AgentAudioDone` fires after every spoken turn. The speech queue names
   * which turn just finished; a transfer waits for the `answer`, never the
   * filler that ran while delegation was in flight.
   */
  private handleAgentAudioDone(): void {
    const completed = this.speech
    this.speech = this.upcomingSpeech.shift() ?? 'nothing'

    if (completed === 'answer' && this.state.status === 'transferring') {
      void this.completeTransfer('answer_done')
    }
  }

  private enqueueSpeech(kind: SpokenKind): void {
    if (this.speech === 'nothing') {
      this.speech = kind
      return
    }

    this.upcomingSpeech.push(kind)
  }

  private async completeTransfer(trigger: TransferTrigger): Promise<void> {
    if (this.transferDispatched || this.state.status !== 'transferring') {
      return
    }

    // transportGone is only ever set by transport.onClose — the one place the
    // transport itself told us it is gone. Every other path into teardown
    // (agent error, agent closed, duration cap, idle timeout) reaches it with
    // the transport still live. transfer() dials through the transport, so
    // dispatching against a dead one is what caused the caller_hangup bug.
    if (trigger === 'teardown' && this.transportGone) {
      this.sessionLog(
        { sessionId: this.deps.transport.sessionId, trigger },
        'session.transfer_abandoned'
      )
      return
    }

    this.transferDispatched = true
    this.clearTransferDeadline()

    if (trigger === 'deadline') {
      this.sessionLog({ sessionId: this.deps.transport.sessionId }, 'session.transfer_deadline')
    } else if (trigger === 'teardown') {
      this.sessionLog({ sessionId: this.deps.transport.sessionId }, 'session.transfer_teardown')
    }

    const destination = this.state.destination
    const { transport } = this.deps
    await runTransfer(transport, destination, transport.sessionId, this.deps.transfer)
    await this.teardown('transferred')
  }

  private async teardown(reason: TransportCloseReason): Promise<void> {
    if (this.state.status === 'closing' || this.state.status === 'closed') {
      return
    }

    if (this.state.status === 'transferring' && !this.transferDispatched) {
      await this.completeTransfer('teardown')
      if (this.transferDispatched) {
        return
      }
    }

    this.state = { status: 'closing' }
    this.clearTimers()
    await Promise.allSettled([
      this.deps.transport.close(reason),
      this.deps.agent.close(),
      this.deps.sessionLifecycle.end(this.deps.transport.sessionId, reason)
    ])
    this.state = { status: 'closed' }
  }

  private armDurationCap(): void {
    this.durationCapTimer = setTimeout(() => {
      void this.teardown('duration_cap')
    }, config.session.maxCallMs)
  }

  private armTransferDeadline(): void {
    this.clearTransferDeadline()
    this.transferDeadlineTimer = setTimeout(() => {
      void this.completeTransfer('deadline')
    }, config.session.transferArmDeadlineMs)
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

  private clearTransferDeadline(): void {
    if (this.transferDeadlineTimer === undefined) {
      return
    }

    clearTimeout(this.transferDeadlineTimer)
    this.transferDeadlineTimer = undefined
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

    this.clearTransferDeadline()
  }

  private sessionLog(bindings: Record<string, unknown>, kind: string): void {
    this.log.info(bindings, kind)
    sessionLogSink?.({ kind, ...bindings })
  }
}
