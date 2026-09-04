# Sprint 04 — The call record

**Sprint 3 status:** merged across all three repos. `keevaris-voice`:
70/70 tests, lint/typecheck clean, `prompt.ts` reduced to structural
instructions only, V6 closed with real detail. `unit-hq-api`: invariant 26b
landed correctly, response envelope consistent. `unit-hq-panel`: voice-bridge
tab wired into the site detail page, i18n present in all three locales
(couldn't run `bun lint`/`typecheck` — no toolchain in this session, flagging
rather than claiming).

**One outstanding item, not blocking, should land as a quick follow-up:**
`VoiceBridgeTokenController`'s `store`/`regenerateSecret`/`revoke` don't call
`CredentialAudit::created/rotated/removed(...)`, which invariant #27
requires for every credential lifecycle event. The helper already exists and
is a three-line fix; I missed it across two review rounds of V03-04 and I'm
saying so plainly rather than letting it quietly ride into this sprint.

**This sprint's origin:** a live call today produces almost no durable
record. Traced against the real schema, not the roadmap sketch's assumption:

- `voice_sessions.ended_at` is a real, nullable column — with no write path.
  `VoiceSessionController` has only `index` and `show`. Nothing calls
  `ended_at = now()` from anywhere a live call could reach.
- A `VoiceSession` row is created in exactly one place:
  `VoiceBridgeTurn::handle()`, line 330 — triggered by the *first delegated
  question*. A call that hangs up before asking anything, dials a wrong
  number, or sits in silence never creates a row at all. The call happened;
  the system has no idea.
- No `end_reason` column exists.
- No transcript table exists, anywhere. `ConversationText` events go to pino
  and die, as they have since V01.
- `voice_session_turns.latency_ms` exists (added
  `2026_09_02_000500_add_latency_telemetry_to_voice_session_turns.php`) —
  but it's `VoiceBridgeTurn::handle()`'s own internal processing time. It
  says nothing about what the caller actually waited through: STT
  endpointing, the fast model's decision to delegate, the HTTP round trip to
  `unit-hq-api`, and TTS time-to-first-audio. Only `keevaris-voice` can
  measure that, and nothing does yet.

None of this is backfillable. A month of calls with no session row, no
transcript, and no real latency number is a month you can't go back and
capture later — which is why this sits before V05/deploy in the roadmap, not
after.

## Findings → tasks

| # | Finding | Evidence | Task |
|---|---|---|---|
| 1 | No session row for a call that never delegates; no way to report a call's end | `VoiceBridgeTurn::handle()` line 330, `VoiceSessionController` (index/show only) | V04-00 |
| 2 | No transcript is captured anywhere; `ConversationText` events are logged and discarded | `keevaris-voice` `VoiceSession.handleAgentEvent`'s `'transcript'` case | V04-01 |
| 3 | `latency_ms` measures the API's own turn, not what the caller experienced | migration `2026_09_02_000500...`, `VoiceBridgeTurn::handle()`'s `$elapsedMs` | V04-02 |
| 4 | Nothing surfaces the p95 number S28-04's launch gate was written around | — | V04-02 (folded in, see below) |

## Sequencing

```
V04-00 (session lifecycle) ── V04-01 (transcript)
        │
        └──────────────────── V04-02 (turn telemetry + p95 report)
```

V04-00 must land first in both directions: V04-01's transcript rows need a
`voice_session_id` to hang off, and a session that opens at call-start
(rather than at first delegation) is what makes V04-01's transcript
complete rather than partial. V04-02 only needs V04-00's session-open
endpoint to exist (to attach timing to), not V04-01's transcript work, so it
can run in parallel with V04-01 once V04-00 is in.

## Departure from the original roadmap sketch

The original sketch split this into four tasks including a standalone
"session lifecycle API" and a separate "observability and the p95 report."
Grounding this against the real code changed that shape twice:

- **Session open and session end turned out to be one task, not something
  splittable.** The reason `VoiceSession` rows are incomplete today is that
  nothing opens one until the first delegated question — fixing *that* is
  what makes "does every call get a row" true, and it's the same lifecycle
  concept as closing one. Splitting them would mean shipping "calls can now
  report their end" while still not creating a row for calls that never
  delegate, which is the actual problem.
- **The p95 report folds into V04-02 rather than standing alone.** There's
  no reporting infrastructure in this codebase to build a fourth task
  around — no dashboard framework, no scheduled-report convention found in
  either repo this session. The real work is capturing the right numbers
  (V04-02's job); *querying* them once captured is a follow-up query
  against `voice_session_turns`, not a separate build.

## Definition of done

1. A real call that hangs up without asking anything produces a
   `voice_sessions` row with `ended_at` and an `end_reason` set.
2. A real call with one delegated question produces a complete transcript —
   caller's utterances and the spoken responses, in order — queryable
   against that call's session.
3. `voice_session_turns` carries a service-reported round-trip time distinct
   from the API's own `latency_ms`, and the two numbers visibly differ on a
   real call (round trip is always ≥ API processing time).
4. All Sprint 1/2/3 fixtures and PHPUnit suites stay green.

## Not in this sprint

- **Alerting on the p95 number.** That's an operational concern for V05.
- **A panel UI for the transcript or session list.** `VoiceSessionController`
  already exists for employee-facing listing; whether/how a transcript
  renders in the panel is a follow-up, not scoped here.
- **Recording audio itself.** V10, gated on the consent decision.
