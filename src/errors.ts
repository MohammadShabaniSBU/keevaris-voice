export class ConnectionRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectionRejectedError'
  }
}
