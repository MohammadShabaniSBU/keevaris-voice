export interface RawSocket {
  readonly readyState: number
  on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): void
  on(event: 'close', listener: (code: number, reason: Buffer) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  send(data: string | Buffer): void
  close(code?: number, reason?: string): void
}
