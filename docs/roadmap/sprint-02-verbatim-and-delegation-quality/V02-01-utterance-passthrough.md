# V02-01 — Verbatim utterance passthrough

**Depends on:** V01 (merged)
**Blocks:** nothing in this sprint
**Touches:** `keevaris-voice`, **`unit-hq-api`** (wire format + inbound turn)

## Problem

`handleFunctionCalls` builds the delegation request from the think model's
parsed function-call arguments:

```ts
const query = typeof args.query === 'string' ? args.query.trim() : ''
```

`query` is not what the caller said. It's Deepgram's fast think model's
reading of what the caller said, filtered through whatever it decided was
relevant to put in the `ask_keevaris` function's `query` argument — the
prompt in `prompt.ts` asks for "the caller's question as plain text... close
to verbatim," but "close to" is doing real work in that sentence. A caller
who says "so if I wanted, like, the ten square meter one, roughly what would
that run me monthly, not counting the deposit" might reach `AgentRuntime` as
`query: "price of 10m2 unit monthly"` — a reasonable paraphrase, and already
lossy before `GroundingGuardTest` (invariant 55) ever runs. The guard
verifies the *answer* is grounded to *something*; it has no way to verify
that something is what the caller actually asked.

This matters most exactly where it matters most: a caller who asks two
things in one breath ("what's the price, and is there one available this
week") risks the fast model folding both into one `query` string, or dropping
one, with nothing downstream able to tell.

## What to build

### `keevaris-voice`: capture and send the verbatim utterance

Deepgram's `ConversationText` events already carry the caller's utterance
verbatim — that's the transcript source `docs/conventions-and-invariants.md`
V1 and the existing `session.transcript` log line already depend on.
`VoiceSession` needs to track the caller's most recent utterance and attach
it to the delegation request:

- Track `lastCallerUtterance: string | undefined`, updated on every
  `transcript` event where `event.role` indicates the caller (check
  `DeepgramVoiceAgent`'s event mapping for the exact role value used).
- Add `caller_utterance: string | null` to `DelegationRequest` in
  `src/delegation/types.ts`.
- In `handleFunctionCalls`, send `this.lastCallerUtterance ?? null` alongside
  `query` for every delegated call in the batch.

This is a passthrough, not a replacement. `query` stays as-is — it's still
useful as the fast model's structured read of intent, and changing what's
sent to `AgentRuntime` as the primary question is a bigger, riskier change
than this task should make. This task's job is only to make the verbatim
utterance *available* on the other side of the hop.

### `unit-hq-api`: accept the field, do not wire it into grounding yet

`VoiceBridgeWireFormat::parseHttp` and `VoiceBridgeInboundTurn` need a new
optional field (`caller_utterance` / `callerUtterance`) parsed the same way
`caller_number`/`from` is today — accepted, stored on the inbound turn object,
and persisted onto `VoiceSessionTurn` (a new nullable column) so it's visible
in the call record V04 will build out. **Do not** thread it into
`AgentRuntime::turn()` or `GroundingGuardTest` in this task — that's a
decision about what the guard checks against, belongs to whoever owns
`AgentRuntime`, and deserves its own scoped change with its own tests rather
than riding in as a side effect of a voice-repo sprint. Flag it as a follow-up
in `unit-hq-api`'s own backlog instead of doing it here.

### Migration

New nullable `caller_utterance` column on `voice_session_turns` (text,
nullable, no default). Follows the existing migration conventions in that
repo.

## Acceptance criteria

- [ ] `VoiceSession` tracks the caller's last transcribed utterance and resets
      it appropriately at call boundaries (a stale utterance from a previous
      turn must never be sent for a new question).
- [ ] `DelegationRequest.caller_utterance` is sent on every call.
- [ ] A fixture asserts the delegation stub receives the correct
      `caller_utterance` for a scripted `transcript` event followed by a
      `functionCalls` event.
- [ ] `unit-hq-api`: `caller_utterance`/`callerUtterance` is parsed and
      persisted on `voice_session_turns`; a request omitting the field
      continues to work exactly as today (this field is additive, never
      required).
- [ ] `unit-hq-api`'s own test for `VoiceBridgeWireFormat::parseHttp` covers
      the new field being present, absent, and empty-string.
- [ ] No change to what `AgentRuntime::turn()` receives or how
      `GroundingGuardTest` grounds an answer — confirmed by that suite staying
      green with zero edits to it.

## Out of scope

- **Using `caller_utterance` in grounding, or changing what `AgentRuntime`
  answers against.** Flagged as a follow-up for whoever owns `AgentRuntime`
  to scope deliberately.
- **A2A wire format.** `VoiceBridgeWireFormat::parseA2a` stays untouched; no
  live A2A client is confirmed to exist yet per the file's own comment.
- **Multiple utterances per turn** (e.g. if the caller speaks again before
  delegation resolves). One "most recent utterance at the time the function
  call fired" is the scope here.
