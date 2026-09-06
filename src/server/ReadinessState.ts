import type { DependencyHealth } from './DependencyHealth.js'

/**
 * Single source of truth for `GET /health/ready`. Draining (SIGTERM) flips
 * this to not-ready immediately so the orchestrator stops sending new calls
 * here while in-flight WebSockets keep running.
 */
export class ReadinessState {
  private draining = false

  constructor(private readonly dependencyHealth: DependencyHealth) {}

  startDraining(): void {
    this.draining = true
  }

  isDraining(): boolean {
    return this.draining
  }

  isReady(): boolean {
    return !this.draining && this.dependencyHealth.isHealthy()
  }
}
