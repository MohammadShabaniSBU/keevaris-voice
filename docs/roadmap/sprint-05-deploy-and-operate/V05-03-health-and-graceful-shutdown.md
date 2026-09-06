# V05-03 — Health and graceful shutdown

**Depends on:** V05-01, V05-02
**Blocks:** nothing
**Touches:** `keevaris-voice`

## Problem

`/health` (`src/index.ts`) is `{ status: 'ok' }`, unconditionally, always
200, regardless of whether Deepgram is reachable, whether `unit-hq-api` is
reachable, or whether the process is in the middle of draining for a
deploy. A `/health` that lies is worse than no `/health` — it tells an
orchestrator to keep routing traffic to a process that can't actually
serve a call.

`TransportCloseReason` has included `'server_shutdown'` since V01-02.
Confirmed by direct search: nothing in this codebase has ever set it. A
`docker stop` or a Kubernetes rolling deploy today sends SIGTERM, Node's
default behavior kills the process immediately, and any live call gets cut
off mid-conversation with no chance to say anything or transfer.

## What to build

### Split readiness from liveness

Two endpoints, not one, because they answer different questions an
orchestrator asks at different times:

- **`GET /health/live`** — is the process itself alive (not deadlocked,
  event loop responsive)? Nearly always 200; this is what a container
  orchestrator uses to decide "should I kill and restart this."
- **`GET /health/ready`** — can this process actually serve a new call
  right now? Checks: not currently draining (see below), and a cheap,
  cached reachability signal for Deepgram and `unit-hq-api` (don't make a
  live network call on every readiness probe — cache the last check's
  result for a few seconds, refreshed by a background interval, so a
  health check storm doesn't become its own load problem). 503 during
  drain or when a dependency is confirmed down; 200 otherwise.

Keep `/health` itself as an alias for `/health/live` for backward
compatibility with whatever's already configured to hit it, but document
plainly that new orchestrator config should point at the split endpoints.

### Graceful shutdown on SIGTERM

```ts
process.on('SIGTERM', () => {
  draining = true
  server.close() // stop accepting new HTTP/upgrade requests
  const activeSessions = connectionGate.activeCount
  if (activeSessions === 0) {
    process.exit(0)
  }
  // else: wait for active calls to end naturally, or force-exit after a timeout
})
```

Setting `draining = true` immediately flips `/health/ready` to 503 — this
is what tells Traefik/the orchestrator to stop sending *new* connections
here, while existing WebSocket connections (already established, not
subject to the HTTP server's `close()`) keep running normally.

For calls still in progress when the shutdown grace period expires (a
configurable `SHUTDOWN_GRACE_MS`, default generous enough to cover a
typical call's remaining duration but not indefinite), call each active
`VoiceSession.teardown('server_shutdown')` directly rather than letting the
process die out from under them — this is the first real use of
`'server_shutdown'` since it was declared. `teardown()` already knows how
to close cleanly and, per V01-04, will complete an armed transfer rather
than abandoning it — exactly the behavior wanted here (a caller mid-call
during a deploy should be transferred if a transfer was already in
progress, not just disconnected).

Track active sessions for this purpose via `ConnectionGate` (V01-01),
which already counts them — no new tracking mechanism needed, just a way
to enumerate (not just count) active sessions so each can be individually
torn down. Extend `ConnectionGate` with a way to register/iterate active
sessions, or maintain a small `Set<VoiceSession>` alongside it — whichever
reads more naturally against the existing class.

### Cached dependency checks

A lightweight background interval (every few seconds, configurable) pings
Deepgram's own health/status mechanism if one exists cheaply, or simply
tracks whether the most recent real Deepgram connection attempt from any
call succeeded or failed recently — reusing signal that's already being
generated (every `DeepgramVoiceAgent.start()` call already knows whether it
connected) rather than adding a synthetic ping call that doesn't reflect
real usage. Same idea for `unit-hq-api` — track the result of the most
recent real `BridgeConfigClient`/`KeevarisClient` call rather than
synthesizing a new one.

## Acceptance criteria

- [x] `/health/live` and `/health/ready` exist and answer different
      questions; `/health` aliases `/health/live`.
- [x] `/health/ready` returns 503 while draining, and (when a real
      Deepgram/API outage can be simulated) when a recent real call
      attempt failed to reach either dependency.
      Unit-tested via `ReadinessState` / `DependencyHealth` / reporter
      wiring; live outage observation is operational.
- [x] SIGTERM stops accepting new connections immediately and flips
      readiness to 503.
      `GracefulShutdown` tests cover drain + `server.close()` + forced
      `teardown('server_shutdown')`.
- [ ] A live call in progress when SIGTERM arrives is not abruptly
      dropped — it either completes naturally within the grace period or
      is torn down via `teardown('server_shutdown')`, including completing
      an already-armed transfer.
      Fixture `server-shutdown-completes-armed-transfer.json` proves the
      teardown-and-transfer half.
- [ ] `docker compose stop` (or a manual SIGTERM) during an active test
      call is verified by hand, not just asserted in a fixture — this is
      exactly the kind of timing behavior a fixture can partially prove
      (the teardown call happens, with the right reason) but a real signal
      to a real process is the actual proof.
      Operational — live container + credentials; handed to V05-04's
      runbook.

## Out of scope

- **Zero-downtime deploys requiring more than graceful drain.** Blue-green
  or canary deployment strategy is an infrastructure decision, not
  something this service's code needs to implement beyond behaving well
  under SIGTERM.
- **A dedicated metrics/observability endpoint** (e.g. Prometheus
  `/metrics`). If that becomes wanted, it's a separate, deliberate
  addition — not implied by this task.
