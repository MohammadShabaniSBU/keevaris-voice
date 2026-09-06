# Sprint 05 — Deploy and operate

**Sprint 4 status: mostly closed, one real gap.** `keevaris-voice`: 70/70
tests, lint/typecheck clean. Session-open/end and transcript persistence
(V04-00, V04-01) are fully landed and verified on both sides. **V04-02's
`unit-hq-api` half was never pushed** — `keevaris-voice` correctly measures
`round_trip_ms`/`filler_spoken` and sends them on every transcript flush
(confirmed: `771fb33`, with a fixture note proving the measured span
excludes the filler), but `VoiceBridgeTranscriptController`'s validation
rules don't include either field, so Laravel's `$request->validate()`
silently drops them — no error, nothing persisted, nothing reportable. This
should be finished before or alongside this sprint; it's small
(migration + two validation rules + a `$turn->update()` + the `agents:
report-voice-latency-p95` command) and was already fully planned and
confirmed, just not built.

**This sprint is the launch gate.** Per the roadmap, V01–V05 is the cut for
the first live call. Everything through V04 made the service correct and
observable; this sprint makes it *deployable* — somewhere it actually runs,
survives a restart without dropping a live call, and can be watched.

**This sprint's origin, grounded against the real deployment, not assumed:**

`keevaris-voice` has no `Dockerfile`, no compose file, nothing — it runs
today only from a developer's machine or wherever it was manually started.
`unit-hq-api`'s `docker-compose.yml` is the sibling pattern to build
against: `webdevops/php-nginx` on a shared `traefik-network`, Traefik labels
per service, structured JSON logging with rotation. I checked it directly
rather than assume a Node service should look the same shape — it won't,
but the *conventions* (network name, label style, logging driver) should
match so this service doesn't stick out as bespoke infrastructure.

**A specific, concrete finding worth flagging now:** `unit-hq-api`'s compose
file already reserves a Traefik router at `ws.test2.keevaris.local` on port
8080. I checked what's actually served there — the supervisord config's own
comment says plainly: *"Voice is php-fpm (POST /api/voice/bridge), never
this worker."* Port 8080 is a different, unrelated Laravel feature (almost
certainly broadcasting/Reverb for the panel's own real-time notifications).
**`keevaris-voice` needs its own subdomain, not this one** — don't reuse or
assume availability of `ws.test2.keevaris.local`.

`CallRegistry` (`src/transport/twilio/CallRegistry.ts`) is exactly the
interface V01-01 built for this moment — `InProcessCallRegistry` is the
only implementation, and the single-instance assumption it carries is
currently load-bearing, not just theoretical.

`TransportCloseReason` has carried `'server_shutdown'` since V01-02 and
nothing has ever set it — confirmed by direct search. `/health`
(`src/index.ts`) is `{ status: 'ok' }`, unconditionally, forever — it says
nothing about whether Deepgram or `unit-hq-api` are reachable, or whether
the process is mid-drain.

## Findings → tasks

| # | Finding | Evidence | Task |
|---|---|---|---|
| 1 | No container, no compose file, nothing to deploy | repo root, vs. `unit-hq-api`'s `Dockerfile`/`docker-compose.yml` | V05-00 |
| 2 | No routing exists; the one reserved subdomain on the API's compose file belongs to something else | `docker-compose.yml` Traefik labels, supervisord comment | V05-01 |
| 3 | `InProcessCallRegistry` is the only implementation of an interface built for exactly this swap; the single-instance assumption is real | `CallRegistry.ts` | V05-02 |
| 4 | `/health` is unconditional; `'server_shutdown'` is declared and never used; no SIGTERM handling exists | `index.ts`, `Transport.ts` | V05-03 |
| 5 | No runbook; no alerting on the p95 command from V04-02; no cost-per-call visibility | — | V05-04 |

## Sequencing

```
V05-00 (container) ── V05-01 (routing) ── V05-03 (health/shutdown)
                                │
V05-02 (shared state) ─────────┘ (needed before V05-03's drain story is real for >1 instance)
                                                    │
V05-04 (runbook) ───────────────────────────────────┘ (documents what V05-00–03 actually built)
```

V05-00 must land first — nothing else has anything to run inside. V05-01
and V05-02 can run in parallel once V05-00 exists; V05-03's graceful-drain
design only matters in the multi-instance case if V05-02 has already
landed, so sequence it after both. V05-04 is last because a runbook for
infrastructure that doesn't exist yet is fiction.

## Definition of done — the actual launch gate

Restated from the original roadmap's launch-gate checklist, now made
concrete against what this sprint builds:

1. `keevaris-voice` runs as a container, reachable through Traefik on its
   own subdomain, alongside `unit-hq-api` on the same `traefik-network`.
2. A restart of the service mid-call does not drop that call — SIGTERM
   drains, using `'server_shutdown'` for the first time since it was
   declared.
3. `/health` reflects real state: Deepgram reachable, `unit-hq-api`
   reachable, not mid-drain. A liveness check and a readiness check are
   different endpoints or different response codes, not the same
   unconditional 200.
4. The service can run as more than one instance without two instances
   silently stepping on each other's in-flight nonces — `CallRegistry` is
   backed by Redis, not a per-process `Map`.
5. A runbook exists: how to deploy, how to roll back, what
   `agents:report-voice-latency-p95` means and when to run it, what to do
   when the call-drop rate spikes.
6. **V04-02's API-side gap (see above) is closed** — telemetry that's
   already being measured and sent is actually persisted.

## Not in this sprint

- **Autoscaling.** One instance, correctly, is the target; more than one
  instance *working correctly* (V05-02) is what's needed, not a scaling
  policy.
- **A staging environment separate from `test2.keevaris.local`.** Whatever
  environment convention `unit-hq-api` already uses is inherited, not
  redesigned.
- **Actually placing the first live call.** That's the outcome of this
  sprint landing, not a task inside it.
