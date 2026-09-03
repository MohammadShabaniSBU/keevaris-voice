import { WebSocket } from 'ws'
import { config } from '../../config.js'
import { logger } from '../../logger.js'
import type { AudioFormat } from '../../transport/Transport.js'
import type { AgentEvent, AgentProvider } from '../AgentProvider.js'
import { buildSettingsMessage } from './settings.js'

const DEEPGRAM_AGENT_URL = 'wss://agent.deepgram.com/v1/agent/converse'

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
  private ws: WebSocket | undefined
  private readonly handlers: Array<EventHandler> = []
  private readonly log

  constructor(
    private readonly sessionId: string,
    private readonly companyName: string
  ) {
    this.log = logger.child({ component: 'deepgram', sessionId })
  }

  onEvent(handler: EventHandler): void {
    this.handlers.push(handler)
  }

  async start(input: AudioFormat, output: AudioFormat): Promise<void> {
    const ws = new WebSocket(DEEPGRAM_AGENT_URL, {
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
        this.log.info({}, 'deepgram.connected')
        ws.send(JSON.stringify(buildSettingsMessage(input, output, { companyName: this.companyName })))
      })

      ws.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          this.emit({ type: 'audio', chunk: data })

          return
        }

        const appliedNow = this.handleControlMessage(data.toString('utf8'))
        if (appliedNow) {
          settleResolve()
        }
      })

      ws.on('close', (code: number, reasonBuf: Buffer) => {
        const reason = reasonBuf.toString('utf8') || `code_${code}`
        this.log.info({ reason }, 'deepgram.closed')
        this.emit({ type: 'closed', reason })
        settleReject(new Error(`Deepgram connection closed before SettingsApplied: ${reason}`))
      })
    })
  }

  sendAudio(chunk: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk)
    }
  }

  injectAgentMessage(text: string): void {
    this.send({ type: 'InjectAgentMessage', content: text })
  }

  respondToFunctionCall(id: string, name: string, output: string): void {
    this.send({ type: 'FunctionCallResponse', id, name, content: output })
  }

  async close(): Promise<void> {
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

    for (const entry of functions) {
      const call = this.parseFunctionCall(entry)
      if (call === null) continue

      this.emit({ type: 'functionCall', id: call.id, name: call.name, arguments: call.arguments })
    }
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

  private send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  private emit(event: AgentEvent): void {
    for (const handler of this.handlers) {
      handler(event)
    }
  }
}
