import type { RawSocket } from '../../src/transport/RawSocket.js'

type MessageListener = (data: Buffer, isBinary: boolean) => void
type CloseListener = (code: number, reason: Buffer) => void
type ErrorListener = (error: Error) => void

export class FakeRawSocket implements RawSocket {
  readonly readyState = 1
  readonly closeCalls: Array<{ code?: number; reason?: string }> = []
  readonly sent: Array<string | Buffer> = []

  private readonly messageHandlers: Array<MessageListener> = []
  private readonly closeHandlers: Array<CloseListener> = []
  private readonly errorHandlers: Array<ErrorListener> = []

  on(event: 'message', listener: MessageListener): void
  on(event: 'close', listener: CloseListener): void
  on(event: 'error', listener: ErrorListener): void
  on(event: string, listener: MessageListener | CloseListener | ErrorListener): void {
    switch (event) {
      case 'message':
        this.messageHandlers.push(listener as MessageListener)
        break
      case 'close':
        this.closeHandlers.push(listener as CloseListener)
        break
      case 'error':
        this.errorHandlers.push(listener as ErrorListener)
        break
      default:
        break
    }
  }

  send(data: string | Buffer): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason })
  }

  emitMessage(data: Buffer, isBinary = false): void {
    for (const handler of this.messageHandlers) {
      handler(data, isBinary)
    }
  }

  emitClose(code = 1000, reason = ''): void {
    for (const handler of this.closeHandlers) {
      handler(code, Buffer.from(reason))
    }
  }

  emitError(error: Error): void {
    for (const handler of this.errorHandlers) {
      handler(error)
    }
  }
}
