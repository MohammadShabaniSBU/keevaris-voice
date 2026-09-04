# V04-01 — Transcript persistence

**Depends on:** V04-00
**Blocks:** nothing
**Touches:** `unit-hq-api`, `keevaris-voice`

## Problem

`ConversationText` events — every utterance, from the caller and from
Deepgram's fast model — reach `VoiceSession.handleAgentEvent`'s `'transcript'`
case (`src/session/VoiceSession.ts`) and go to pino. There's no table, no
endpoint, nothing that survives past the log line. An operator asking "what
did this caller actually say" has no answer, only whatever delegated
answers happened to get grounded through `unit-hq-api` — the caller's own
words, and the fast model's own turns that never delegated, are gone.

## Design decision, carried from the original sprint plan

**Not `agent_conversation_messages`.** That table's entire value is that
every row passed `GroundingGuardTest` — invariant 55 depends on that being
true unconditionally. A raw transcript segment is, by definition, unverified
speech: the caller's own words, or the fast model's own turn that may not
have gone through delegation at all. Mixing the two would either weaken
`agent_conversation_messages`'s guarantee or require a `verified` flag
nobody would reliably check. A sibling table keeps the guarantee intact and
merges the two views only where something actually needs both — the UI, not
the schema.

## What to build

### `unit-hq-api`: `voice_transcript_segments`

```php
Schema::create('voice_transcript_segments', function (Blueprint $table): void {
    $table->id();
    $table->foreignId('voice_session_id')->constrained('voice_sessions')->cascadeOnDelete();
    $table->integer('sequence');
    $table->string('role'); // 'caller' | 'agent'
    $table->text('text');
    $table->string('source'); // 'stt' | 'fast_model' | 'delegated'
    $table->foreignId('voice_session_turn_id')->nullable()->constrained('voice_session_turns');
    $table->timestamp('occurred_at');
    $table->timestamps();

    $table->unique(['voice_session_id', 'sequence']);
});
```

Mirrors `agent_conversation_messages`'s `sequence` + per-parent-unique
pattern. `cascadeOnDelete` (not `restrictOnDelete`, unlike
`voice_session_turns`'s relation to `voice_sessions`) — a transcript is
disposable detail of its session in a way a turn record isn't; if a session
is ever hard-deleted (AR-03 redaction, V10), its transcript should go with
it rather than blocking the delete. `voice_session_turn_id` is nullable and
lets a segment correlate to the turn it was part of, when there was one —
most segments (ordinary conversation, no delegation) won't have one.

`POST /api/voice/bridge/{bridgeToken}/session/{bridgeSessionId}/transcript`

Body: `{ segments: Array<{ sequence, role, text, source, occurred_at, turn_id?: string }> }`
— batched, not one call per utterance. `turn_id` (if present) is this
service's minted turn id (V02-02's `sessionId:seq:index` format); resolve it
to `voice_session_turn_id` via the existing `(voice_session_id, turn_id)`
unique lookup `storedTurn()` already does, reusing that method rather than
writing a second lookup.

No `show`/read endpoint in this task — `VoiceSessionController::show()`
already eager-loads a session's relations; add `voiceTranscriptSegments`
(ordered by `sequence`) to that load list so the transcript rides along with
everything else the panel already fetches for a session, rather than
building a second endpoint for it.

### `keevaris-voice`: buffer and flush

`VoiceSession` accumulates transcript segments in memory during the call —
a plain array, appended to on every `'transcript'` event, tagging `source`
(`'stt'` for the caller's own `ConversationText`, `'fast_model'` for the
agent's non-delegated turns) and, separately, one segment per delegated
answer actually spoken via `injectAgentMessage` (`source: 'delegated'`,
carrying the minted `turn_id` from V02-02).

Flush on `teardown()`, alongside the `SessionLifecycleClient.end()` call
from V04-00 — same client, same failure posture (log-and-continue, never
block teardown). Batched in one HTTP call per session, not streamed live;
nothing in this sprint needs a transcript to be readable *during* an
in-progress call.

## Acceptance criteria

- [ ] `voice_transcript_segments` exists with the shape above; unique on
      `(voice_session_id, sequence)`.
- [ ] The transcript endpoint accepts a batch, resolves `turn_id` to
      `voice_session_turn_id` via `storedTurn()`, reused not reimplemented.
- [ ] `VoiceSessionController::show()` eager-loads transcript segments,
      ordered.
- [ ] `keevaris-voice` buffers every `ConversationText` event plus every
      `injectAgentMessage`-spoken delegated answer, tagged with the right
      `source`, and flushes once at `teardown()`.
- [ ] A real call with one delegated question produces a complete,
      correctly-ordered transcript: the caller's question, the filler, the
      delegated answer (tagged `source: 'delegated'`, correlated to its
      turn), in the order they actually occurred.
- [ ] All Sprint 1/2/3 fixtures stay green; new fixtures cover the flush
      behavior via a stub on the same client shape as V04-00's.

## Out of scope

- **Live/streaming transcript delivery.** Flush-at-end only, this sprint.
- **A panel UI rendering the transcript.** `show()` returning it is enough
  for this task; whether/how it's displayed is a follow-up.
- **Deduplicating the fast model's own non-delegated turns against what a
  human reviewing the call would consider "the same thing said twice."**
  Store what actually happened; presentation-layer cleanup is a later
  concern if it turns out to matter.
