# V04-02 — Turn telemetry and the p95 report

**Depends on:** V04-00
**Blocks:** nothing
**Touches:** `unit-hq-api`, `keevaris-voice`

## Problem

`voice_session_turns.latency_ms` (added
`2026_09_02_000500_add_latency_telemetry_to_voice_session_turns.php`) is
written by `VoiceBridgeTurn::handle()` as `$elapsedMs` — the API's own
processing time for that turn. It's real and useful, but it isn't what
Sprint 28's launch gate was written around: the caller's actual experience
is STT endpointing, the fast model's decision to delegate, the HTTP round
trip to `unit-hq-api` (which `latency_ms` is *part* of, not all of), and TTS
time-to-first-audio. Only `keevaris-voice` sits where it can measure that
full span, and nothing does yet.

## What to build

### `unit-hq-api`: two more columns, additive

```php
Schema::table('voice_session_turns', function (Blueprint $table): void {
    $table->unsignedInteger('round_trip_ms')->nullable()->after('latency_ms');
    $table->boolean('filler_spoken')->default(false)->after('round_trip_ms');
});
```

`round_trip_ms`: this service's own measured time from "caller finished
speaking the question" to "delegated answer's first audio frame reached the
transport." `filler_spoken`: whether the filler was actually injected for
this turn (it's conditional on `needsDelegation`, per V02-00) — useful
context for interpreting `round_trip_ms`, since a turn with no filler and a
long round trip is a worse caller experience than one where the filler
covered the wait.

Both fields accepted on the existing delegation request body
(`DelegationRequest` already carries `turn_id`; add `round_trip_ms?: number`
and `filler_spoken?: boolean` as optional fields — optional because they
can't be known until *after* the round trip completes, so they arrive on a
*follow-up* call, not the original `ask()`). Simplest shape: extend the
transcript batch endpoint from V04-01 rather than inventing a third
endpoint — a turn's timing is exactly the kind of "happened during this
call, report it at teardown" data the transcript flush already exists to
carry. Add `round_trip_ms`/`filler_spoken` as optional fields on the
transcript batch's per-segment shape where `source: 'delegated'`, or as a
small parallel array in the same request body — whichever reads cleaner
once V04-01's actual request shape is in front of you.

`VoiceBridgeTurn`'s existing `persistAnswer()` (and its callers,
`persistTransfer`/`persistHandoff`, already threading `callerUtterance`
through per V02-01's pattern) gains the same treatment: accept and store
`round_trip_ms`/`filler_spoken` as named, optional parameters, forwarded at
every call site the same way V02-01 required for `callerUtterance` — named
arguments at every forwarding call site, not positional, for the same
silent-drop reason that mattered there.

### `keevaris-voice`: measure it

In `VoiceSession.handleFunctionCalls`, record a timestamp when the
triggering `ConversationText` (the caller's question) was received —
already tracked as part of V02-01's `lastCallerUtterance` capture, so this
is a timestamp alongside data already being captured, not new plumbing.
Record a second timestamp at the first `agentSocket` audio frame following
the delegated `injectAgentMessage` call (the answer's first spoken byte,
not the filler's). `round_trip_ms` is the difference.

Send both fields on the next transcript-flush call (V04-01) for that turn,
correlated by `turn_id`.

### The p95 report

No reporting infrastructure exists in either repo to build a dashboard
around — confirmed by search, not assumed. The report is a query, not a new
system: `SELECT round_trip_ms FROM voice_session_turns WHERE round_trip_ms
IS NOT NULL ORDER BY round_trip_ms` at the 95th-percentile offset, scoped by
date range. Add it as an artisan command
(`php artisan voice:report-latency-p95 --since=...`), matching
`ExportVoiceBridgeConfigCommand`'s existing pattern of a console command as
the interface for an operational, infrequent query — not a new panel page,
not a scheduled job, until there's a demonstrated need for either.

## Acceptance criteria

- [ ] `voice_session_turns` gains `round_trip_ms`, `filler_spoken`, both
      nullable/defaulted, purely additive.
- [ ] `keevaris-voice` measures round-trip from caller-question-received to
      answer-first-audio-frame and reports it at the next flush.
- [ ] `persistAnswer()`'s forwarding chain accepts and threads these two
      fields through every call site with named arguments — same pattern
      V02-01 required for `callerUtterance`, applied here for the same
      reason.
- [ ] On a real call, `round_trip_ms` is visibly larger than that turn's
      `latency_ms` (round trip fully contains, and exceeds, the API's own
      processing slice) — this is the concrete proof the two numbers measure
      different things, not the same thing twice.
- [ ] `voice:report-latency-p95` runs against real data and prints a p95
      figure.
- [ ] All Sprint 1/2/3 fixtures stay green.

## Out of scope

- **Alerting on the p95 number.** V05.
- **A panel page for this report.** The console command is the interface for
  this sprint; a panel view is a follow-up if the console command turns out
  to be used often enough to justify one.
- **Per-site or per-number breakdown in the report.** A flat p95 across
  whatever date range is passed is enough to start; slicing further is easy
  to add to the same command later and isn't needed to answer "is this
  fast enough."
