import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import type { DeepgramSocket } from '../../src/agent/deepgram/DeepgramVoiceAgent.js'
import type { EventLog } from './EventLog.js'

/**
 * Stands in for Deepgram's WebSocket. readyState starts CONNECTING and only
 * becomes OPEN on simulateOpen(); simulateClose/simulateError move it to
 * CLOSED so production send guards cannot speak into a dead socket unnoticed.
 */
export class DeepgramSocketDouble implements DeepgramSocket {
  readyState: number = WebSocket.CONNECTING
  readonly sentAudioChunks: Array<Buffer> = []

  private readonly emitter = new EventEmitter()

  constructor(private readonly log: EventLog) {}

  on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): void
  on(event: 'close', listener: (code: number, reason: Buffer) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: string, listener: (...args: Array<never>) => void): void {
    this.emitter.on(event, listener)
  }

  once(event: 'open', listener: () => void): void {
    this.emitter.once(event, listener)
  }

  off(event: string, listener: (...args: Array<never>) => void): void {
    this.emitter.off(event, listener)
  }

  send(data: string | Buffer): void {
    if (typeof data !== 'string') {
      this.sentAudioChunks.push(data)
      this.log.push({ on: 'agentSocket', kind: 'sendAudio', bytes: data.length })
      return
    }

    let messageType = 'unknown'
    try {
      const parsed = JSON.parse(data) as { type?: unknown }
      if (typeof parsed.type === 'string') {
        messageType = parsed.type
      }
    } catch {
      messageType = 'unparseable'
    }

    this.log.push({ on: 'agentSocket', kind: 'send', messageType })
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSED) return
    this.readyState = WebSocket.CLOSED
    this.log.push({ on: 'agentSocket', kind: 'closed' })
    this.emitter.emit('close', 1000, Buffer.from(''))
  }

  simulateOpen(): void {
    this.readyState = WebSocket.OPEN
    this.emitter.emit('open')
  }

  sendControl(message: Record<string, unknown>): void {
    this.emitter.emit('message', Buffer.from(JSON.stringify(message), 'utf8'), false)
  }

  sendAudioFrame(buffer: Buffer): void {
    this.emitter.emit('message', buffer, true)
  }

  simulateClose(code = 1006, reason = 'test_close'): void {
    this.readyState = WebSocket.CLOSED
    this.emitter.emit('close', code, Buffer.from(reason, 'utf8'))
  }

  simulateError(error: Error): void {
    this.readyState = WebSocket.CLOSED
    this.emitter.emit('error', error)
  }
}
