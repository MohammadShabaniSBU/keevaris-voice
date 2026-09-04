import { WebSocket } from 'ws'
import { config } from '../../config.js'
import { logger } from '../../logger.js'
import type { AudioFormat } from '../../transport/Transport.js'
import type { AgentEvent, AgentProvider } from '../AgentProvider.js'
import { buildSettingsMessage } from './settings.js'

const DEEPGRAM_AGENT_URL = 'wss://agent.deepgram.com/v1/agent/converse'
const PREBUFFER_SECONDS = 2

function bytesPerSecond(format: AudioFormat): number {
  return format.sampleRate * (format.encoding === 'linear16' ? 2 : 1)
}

export interface DeepgramSocket {
  readonly readyState: number
  on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): void
  on(event: 'close', listener: (code: number, reason: Buffer) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  once(event: 'open', listener: () => void): void
  off(event: string, listener: (...args: Array<never>) => void): void
  send(data: string | Buffer): void
  close(): void
}

export type DeepgramSocketFactory = (
  url: string,
  options: { headers: Record<string, string> }
) => DeepgramSocket

type EventHandler = (event: AgentEvent) => void

interface DeepgramFunctionCall {
  id: string
  name: string
  arguments: string
  client_side: boolean
}

/**
 * `AgentProvider` backed by Deepgram's Voice Agent API. One instance per
 * call: connect, send `Settings`, wait for `SettingsApplied`, then stream
 * audio both ways and translate Deepgram's control messages into
 * `AgentEvent`s. See https://developers.deepgram.com/docs/voice-agent-message-flow.
 */
export class DeepgramVoiceAgent implements AgentProvider {
  private ws: DeepgramSocket | undefined
  private readonly handlers: Array<EventHandler> = []
  private closedEvent: AgentEvent | undefined
  private closeRequested = false
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined
  private audioSentSinceLastTick = false
  private inputFormat: AudioFormat | undefined
  private readonly prebuffer: Array<Buffer> = []
  private prebufferedBytes = 0
  private droppedPrebufferChunks = 0
  private readyForAudio = false
  private readonly log

  constructor(
    private readonly sessionId: string,
    private readonly options: { greeting: string; promptAdditions: Array<string> },
    private readonly socketFactory: DeepgramSocketFactory = (url, options) =>
      new WebSocket(url, options)
  ) {
    this.log = logger.child({ component: 'deepgram', sessionId })
  }

  onEvent(handler: EventHandler): void {
    this.handlers.push(handler)
    if (this.closedEvent !== undefined) {
      handler(this.closedEvent)
    }
  }

  async start(input: AudioFormat, output: AudioFormat): Promise<void> {
    this.inputFormat = input
    const ws = this.socketFactory(DEEPGRAM_AGENT_URL, {
      headers: { Authorization: `Token ${config.deepgram.apiKey}` }
    })
    this.ws = ws

    await new Promise<void>((resolve, reject) => {
      let settled = false

      const settleReject = (error: Error): void => {
        if (settled) return
        settled = true
        reject(error)
      }

      const settleResolve = (): void => {
        if (settled) return
        settled = true
        resolve()
      }

      ws.on('error', (error: Error) => {
        this.log.error({ error: error.message }, 'deepgram.socket_error')
        this.emit({ type: 'error', message: error.message })
        settleReject(error)
      })

      ws.once('open', () => {
        if (this.closeRequested) {
          ws.close()
          return
        }

        this.log.info({}, 'deepgram.connected')
        ws.send(JSON.stringify(buildSettingsMessage(input, output, this.options)))
        this.startKeepAlive()
      })

      ws.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          this.emit({ type: 'audio', chunk: data })

          return
        }

        const appliedNow = this.handleControlMessage(data.toString('utf8'))
        if (appliedNow) {
          this.flushPrebuffer(ws)
          settleResolve()
        }
      })

      ws.on('close', (code: number, reasonBuf: Buffer) => {
        this.stopKeepAlive()
        const reason = reasonBuf.toString('utf8') || `code_${code}`
        this.log.info({ reason }, 'deepgram.closed')
        this.emit({ type: 'closed', reason })
        settleReject(new Error(`Deepgram connection closed before SettingsApplied: ${reason}`))
      })

      if (this.closeRequested) {
        ws.close()
      }
    })
  }

  sendAudio(chunk: Buffer): void {
    if (!this.readyForAudio) {
      this.enqueuePrebuffer(chunk)
      return
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk)
      this.audioSentSinceLastTick = true
    }
  }

  injectAgentMessage(text: string): void {
    this.send({ type: 'InjectAgentMessage', behavior: 'queue', message: text })
  }

  respondToFunctionCall(id: string, name: string, output: string): void {
    this.send({ type: 'FunctionCallResponse', id, name, content: output })
  }

  async close(): Promise<void> {
    this.closeRequested = true
    this.stopKeepAlive()
    this.ws?.close()
  }

  /** @returns true once (and only once) SettingsApplied has been seen. */
  private handleControlMessage(raw: string): boolean {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(raw) as Record<string, unknown>
    } catch {
      this.log.warn({ raw }, 'deepgram.unparseable_message')

      return false
    }

    const type = typeof message.type === 'string' ? message.type : undefined

    switch (type) {
      case 'Welcome':
        this.log.info({ requestId: message.request_id }, 'deepgram.welcome')

        return false
      case 'SettingsApplied':
        this.log.info({}, 'deepgram.settings_applied')

        return true
      case 'UserStartedSpeaking':
        this.emit({ type: 'userStartedSpeaking' })

        return false
      case 'ConversationText':
        this.emit({
          type: 'transcript',
          role: message.role === 'user' ? 'user' : 'agent',
          text: typeof message.content === 'string' ? message.content : ''
        })

        return false
      case 'FunctionCallRequest':
        this.handleFunctionCallRequest(message)

        return false
      case 'AgentAudioDone':
        this.emit({ type: 'agentAudioDone' })

        return false
      case 'InjectionRefused':
        // `behavior: 'queue'` still refuses when the caller is mid-speech.
        // The answer then never reaches the caller even though the think
        // model already received the "Answered" stub. Not solved here —
        // emitting `'error'` would tear the whole call down over one
        // dropped injection.
        this.log.warn({}, 'deepgram.injection_refused')

        return false
      case 'Error': {
        const description = typeof message.description === 'string' ? message.description : 'unknown_error'
        this.log.error({ description }, 'deepgram.error_message')
        this.emit({ type: 'error', message: description })

        return false
      }
      default:
        return false
    }
  }

  private handleFunctionCallRequest(message: Record<string, unknown>): void {
    const functions = Array.isArray(message.functions) ? (message.functions as Array<unknown>) : []
    const calls: Array<{ id: string; name: string; arguments: string }> = []

    for (const entry of functions) {
      const call = this.parseFunctionCall(entry)
      if (call === null) continue

      calls.push({ id: call.id, name: call.name, arguments: call.arguments })
    }

    if (calls.length === 0) {
      return
    }

    this.emit({ type: 'functionCalls', calls })
  }

  private parseFunctionCall(entry: unknown): DeepgramFunctionCall | null {
    if (typeof entry !== 'object' || entry === null) return null

    const record = entry as Record<string, unknown>
    const id = record.id
    const name = record.name
    if (typeof id !== 'string' || typeof name !== 'string') return null

    const args = record.arguments
    const clientSide = record.client_side !== false

    return {
      id,
      name,
      arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      client_side: clientSide
    }
  }

  private enqueuePrebuffer(chunk: Buffer): void {
    this.prebuffer.push(chunk)
    this.prebufferedBytes += chunk.length

    const format = this.inputFormat
    if (format === undefined) {
      return
    }

    const cap = PREBUFFER_SECONDS * bytesPerSecond(format)
    while (this.prebufferedBytes > cap && this.prebuffer.length > 0) {
      const dropped = this.prebuffer.shift()
      if (dropped === undefined) {
        break
      }

      this.prebufferedBytes -= dropped.length
      this.droppedPrebufferChunks += 1
      this.log.warn(
        { droppedBytes: dropped.length, totalDroppedChunks: this.droppedPrebufferChunks },
        'deepgram.prebuffer_overflow'
      )
    }
  }

  private flushPrebuffer(ws: DeepgramSocket): void {
    this.readyForAudio = true

    if (this.prebuffer.length === 0) {
      return
    }

    const bytes = this.prebufferedBytes
    const format = this.inputFormat
    const durationMs =
      format === undefined ? 0 : Math.round((bytes / bytesPerSecond(format)) * 1000)
    this.log.info({ bytes, durationMs }, 'deepgram.prebuffer_flushed')

    for (const chunk of this.prebuffer) {
      ws.send(chunk)
    }
    this.audioSentSinceLastTick = true
    this.prebuffer.length = 0
    this.prebufferedBytes = 0
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  private startKeepAlive(): void {
    this.stopKeepAlive()
    this.keepAliveTimer = setInterval(() => {
      if (!this.audioSentSinceLastTick) {
        this.send({ type: 'KeepAlive' })
      }
      this.audioSentSinceLastTick = false
    }, config.deepgram.keepAliveIntervalMs)
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer === undefined) {
      return
    }

    clearInterval(this.keepAliveTimer)
    this.keepAliveTimer = undefined
  }

  private emit(event: AgentEvent): void {
    if (event.type === 'closed' && this.closedEvent === undefined) {
      this.closedEvent = event
    }

    for (const handler of this.handlers) {
      handler(event)
    }
  }
}
