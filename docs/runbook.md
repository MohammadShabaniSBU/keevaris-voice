# Runbook — keevaris-voice

Operational notes for the media bridge that shipped in V05-00 through V05-03.
Commands and queries below were run against the real code and, where a
process existed to hit, a live process. Items that need the `test2` Traefik
host or a live Twilio call are marked **deploy-time** — they are not claimed
as already verified from this checkout.

There is no image registry and no alerting infrastructure. Do not invent
either.

---

## Deploy

From the `keevaris-voice` repo root, on the host that already has
`traefik-network`:

```bash
docker compose up -d --build
```

That builds from [`Dockerfile`](../Dockerfile) and starts container
`keevaris-voice` with Traefik labels for `voice.test2.keevaris.local` →
port `8787`. There is no published image tag. The revision that is serving
is whatever `docker compose up --build` just compiled.

### Confirm the new revision is serving

`docker compose ps` showing "Up" is not enough. Hit readiness:

```bash
curl -sS -D - https://voice.test2.keevaris.local/health/ready
```

A process that can take a new call returns `200` and `{"status":"ok"}`.
A process that is draining, or that has a recent recorded Deepgram /
`unit-hq-api` failure, returns `503` and `{"status":"not_ready"}`.

Liveness is a different question. These two are aliases of each other and
always return `200` / `{"status":"ok"}` while the event loop is up — they
do not know about Deepgram, the API, or drain:

```bash
curl -sS https://voice.test2.keevaris.local/health
curl -sS https://voice.test2.keevaris.local/health/live
```

Verified locally against a running process on `127.0.0.1:8787` (same
bodies and status codes). Swap the host for the deployed subdomain.

### Deploy-time checks (V05-01 / V05-03)

None of these live in this repo. Confirm them against the live Traefik
host and a real call; do not assume defaults.

1. **Entrypoint timeouts vs `MAX_CALL_SECONDS`.** Default is `1800`
   (30 minutes). Read/write/idle timeouts on the Traefik entrypoint that
   serves `voice.test2.keevaris.local` must exceed that, comfortably.
   Read Traefik's static/dynamic config on the host.
2. **No API JSON middleware on this router.** A request-body-size or
   short-timeout chain written for `unit-hq-api` must not apply to
   `keevaris-voice`. The voice router is its own Traefik service
   (`keevaris-voice`), not `keevaris-api` / `keevaris-ws`.
3. **TLS.** `voice.test2.keevaris.local` must be covered the same way
   `test2.keevaris.local` and `ws.test2.keevaris.local` are (wildcard, or
   an added SAN/entry). `wss://` will not complete without it.
4. **A real WebSocket upgrade.** `curl` cannot prove this. Use `websocat`
   (or a real Twilio `<Stream>`) against
   `wss://voice.test2.keevaris.local/twilio/media`. The web transport
   path is `/web/media`.
5. **`PUBLIC_BASE_URL`.** The deployed `.env` must be
   `PUBLIC_BASE_URL=https://voice.test2.keevaris.local`, never
   `localhost`. Twilio's `<Stream>` URL is built from this value. Check
   with:

   ```bash
   docker exec keevaris-voice printenv PUBLIC_BASE_URL
   ```

6. **Live SIGTERM drain.** During an active test call:

   ```bash
   # Docker's default stop timeout is 10s. SHUTDOWN_GRACE_MS defaults to
   # 120000. Without -t, Docker SIGKILLs the process mid-drain.
   docker compose stop -t 130
   ```

   Or `docker kill --signal=TERM keevaris-voice`. Immediately:

   - `/health/ready` flips to `503` (`ReadinessState.startDraining()`).
   - Logs emit `server.shutdown_started` (fields: `activeSessions`,
     `graceMs`), then either wait for the call to hang up or, if it is
     still up at the grace deadline, `server.shutdown_forcing_sessions`
     and `teardown('server_shutdown')`. Then `server.shutdown_complete`.
   - An already-armed transfer still completes (`session.transfer_teardown`
     in the fixture; a real call is the proof).

   `docker logs keevaris-voice` is JSON (pino). Grep the `msg` field.

---

## Roll back

No registry, no tags. Rollback is rebuild-from-the-previous-commit:

```bash
git checkout <previous-sha>
docker compose up -d --build
```

Then the same `/health/ready` check as deploy. `docker compose down`
stops and removes the container; it does not restore an older image
because one was never pushed.

If the previous SHA is already checked out on another clone, rebuild
from that tree the same way. There is nothing to `docker pull`.

---

## Reading `agents:report-voice-latency-p95`

This command lives in `unit-hq-api`, not this repo. From the API host,
with the app container up:

```bash
docker compose exec app php artisan agents:report-voice-latency-p95 --since=2026-09-01
```

(`drun` is an alias for `docker compose exec app`.)

What it actually prints, from running
`ReportVoiceLatencyP95CommandTest` against the real command
(`p95` / `n` below are seeded test values, not a production baseline):

```
p95 round_trip_ms: 1900 (n=20)
p95 round_trip_ms: 500 (n=1, since=YYYY-MM-DD)
No voice_session_turns with round_trip_ms in range.
Invalid --since value: not-a-date
```

`round_trip_ms` is measured on this service: caller finished speaking
the question (`lastCallerUtteranceAt`) → first audio frame of the
*delegated answer* (`speech === 'answer'`). Filler audio does not close
the timer. Rows with `round_trip_ms IS NULL` are ignored.

### Healthy number

TBD. Establish a baseline in the first week of real traffic. Do not
treat the fixture numbers above as a target; they are seeded test data.

### Rising trend — which hop

The number is one span covering three hops. Tell them apart by looking
at the other signal each hop already emits:

1. **Deepgram-side latency** (STT endpointing + TTS time-to-first-audio
   after `InjectAgentMessage`). Check Deepgram status, and this
   process's `session.agent_error` / `session.agent_start_failed` lines.
2. **`unit-hq-api` load** (the Vocal Bridge POST inside the span). Check
   API response times for `/api/voice/bridge/*`, and this process's
   `delegation.fallback_engaged` / `delegation.malformed_response` /
   `session.delegation_result` (`clientFallback: true`). Compare with
   `voice_session_turns.latency_ms` — that column is the API's own
   processing time, a subset of `round_trip_ms`.
3. **Network path** (Traefik → this process → Deepgram / API). If (1)
   and (2) look fine and p95 is still up, the path between them moved.

---

## Call-drop rate

Signal: fraction of `voice_sessions` rows with `end_reason = 'error'`
or `ended_at IS NULL`, over a rolling window. Real columns, verified
against the migrated `voice_sessions` table
(`bridge_session_id`, `started_at`, `ended_at`, `end_reason`).

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE end_reason = 'error' OR ended_at IS NULL) AS dropped,
  CASE
    WHEN COUNT(*) = 0 THEN NULL
    ELSE COUNT(*) FILTER (WHERE end_reason = 'error' OR ended_at IS NULL) * 1.0 / COUNT(*)
  END AS drop_rate
FROM voice_sessions
WHERE started_at >= now() - interval '1 day';
```

Ran against the live `keevaris-test-db` schema: executes, returns
`total = 0` when the window is empty (no division-by-zero).

`ended_at IS NULL` on a row whose `started_at` is seconds ago is a live
call, not a drop. On a one-day window that noise is small; on a
five-minute window it is most of the signal. `end_reason` values this
service actually writes: `caller_hangup`, `transferred`, `error`,
`server_shutdown`, `duration_cap`, `idle_timeout`.

### Alarming rate

TBD. Establish a baseline in the first week of real traffic. No
invented threshold.

---

## Redis unavailable

Applies only when `CALL_REGISTRY_BACKEND=redis`. The default is
`memory` (an in-process `Map`); a single-instance deploy with that
default does not talk to Redis at all.

Fail-closed, as built: `RedisCallRegistry.put` / `take` catch the
error, log, and treat the nonce as missing. New Twilio `start` frames
fail the nonce match and are rejected. Existing WebSocket sessions are
untouched — the registry is only consulted at call start.

Log lines to watch (`msg` field in the pino JSON):

| Line | Where | Meaning |
|---|---|---|
| `redis.client_error` | `src/index.ts` ioredis `error` handler | The client itself lost Redis. |
| `call_registry.put_failed` | `RedisCallRegistry.put` | Webhook could not store the nonce. |
| `call_registry.take_failed` | `RedisCallRegistry.take` | `start` frame could not redeem the nonce. |
| `twilio.rejected_start_frame` | `TwilioTransport` | Nonce missing or `CallSid` mismatch — the caller-visible failure. |

```bash
docker logs keevaris-voice 2>&1 | grep -E 'redis.client_error|call_registry.put_failed|call_registry.take_failed|twilio.rejected_start_frame'
```

### Rough edge, do not smooth over

`put()` swallows the error. The Twilio webhook still returns `200` and
TwiML. The caller hears ringing, then the Media Stream `start` frame
fails nonce take and the socket closes (`1008`). Not a clean busy
signal.

### Recovery

Bring Redis back. ioredis reconnects on its own; no process restart is
required. The next webhook `put` succeeds and new calls accept. Nothing
to drain or replay — failed nonces expire on `CALL_REGISTRY_TTL_MS`
(default 60s) even if they had been written.

---

## A caller reports a bad experience

Twilio `CallSid` **is** `voice_sessions.bridge_session_id` (set from
`start.callSid` on the transport). Web sessions use a minted UUID in
the same column.

### 1. Find the row

The panel list (`/leasing/voice-sessions`) filters by date and site
only. It does not search `CallSid` / `bridge_session_id`.
`VoiceSessionResource` also does not expose `bridge_session_id` or
`end_reason`. Start in SQL:

```sql
SELECT id, bridge_session_id, caller_number, started_at, ended_at, end_reason
FROM voice_sessions
WHERE bridge_session_id = :call_sid
   OR caller_number = :from;
```

That query runs against the real schema (empty result when the id is
unknown). Take `id` from the row.

### 2. Panel — guarded conversation only

`/leasing/voice-sessions/{id}` (`VoiceSessionController::show`,
`app/pages/leasing/voice-sessions/[id].vue`) renders
`session.conversation.messages` and `session.conversation.trace`.
That is `agent_conversation_messages` — the guarded table. It is **not**
the full call record. The page does not read `transcript_segments` /
`voiceTranscriptSegments`, even though the API show payload includes
`transcript_segments` when the relation is loaded.

### 3. Full transcript — `voice_transcript_segments`

This is the table V04-01 built for what the guarded log never has: the
caller's raw utterances and every non-delegated agent turn.

```sql
SELECT sequence, role, source, text, occurred_at, voice_session_turn_id
FROM voice_transcript_segments
WHERE voice_session_id = :id
ORDER BY sequence;
```

`role` is `caller` | `agent`. `source` is `stt` | `fast_model` |
`delegated`. Ran against the real table; order is the unique
`(voice_session_id, sequence)` key.

### 4. Turn telemetry — also not on the panel

`round_trip_ms` and `filler_spoken` are on `voice_session_turns` and
in the API show payload under `turns`. The panel type omits them and
the page does not render them.

```sql
SELECT turn_id, caller_utterance, answer_text, round_trip_ms, filler_spoken,
       latency_ms, transfer, destination, handoff_reason
FROM voice_session_turns
WHERE voice_session_id = :id
ORDER BY id;
```

---

## Signals worth alerting on

No alerting infrastructure exists in `keevaris-voice` or `unit-hq-api`.
This list is for whoever eventually stands one up. No thresholds — those
wait on the first week of real traffic, same as the TBD baselines
above.

1. **Call-drop rate** — the query in [Call-drop rate](#call-drop-rate),
   over a rolling window long enough that in-progress calls are not the
   numerator.
2. **p95 latency trend** — `agents:report-voice-latency-p95 --since=…`
   rising versus the (still unestablished) baseline.
3. **Redis connection failures** — rate of `redis.client_error` /
   `call_registry.put_failed` / `call_registry.take_failed`. Only
   meaningful when `CALL_REGISTRY_BACKEND=redis`.
4. **`/health/ready` flapping** — 503 count over time. A single 503
   during `docker compose stop` is the drain working. Repeated 503s
   while the process is not being replaced means a recorded Deepgram or
   `unit-hq-api` failure younger than `DEPENDENCY_HEALTH_STALE_MS`
   (default 60s).

---

## Cost per call

No per-session Deepgram cost lives in this schema. The number you can
produce today is an average:

1. Call count over the billing period (ran against the real table):

   ```sql
   SELECT COUNT(*)
   FROM voice_sessions
   WHERE started_at BETWEEN :from AND :to;
   ```

2. Divide Deepgram's own usage-based invoice for the same dates by that
   count.

That is a period average, not a per-call figure. Do not build new
instrumentation unless this average is not enough for a real decision.
