export class ConnectionGate {
  private active = 0

  constructor(private readonly limit: number) {}

  tryAcquire(): boolean {
    if (this.active >= this.limit) {
      return false
    }

    this.active++

    return true
  }

  release(): void {
    this.active = Math.max(0, this.active - 1)
  }

  get activeCount(): number {
    return this.active
  }
}
