# V04-00 — Session lifecycle: every call gets a row, every call reports its end

**Depends on:** nothing — first task of the sprint
**Blocks:** V04-01, V04-02
**Touches:** `unit-hq-api`, `keevaris-voice`

## Problem

Traced the actual creation path: a `VoiceSession` row exists in exactly one
place — `VoiceBridgeTurn::findOrCreateSession()` (`app/Support/Ai/
VoiceBridgeTurn.php`, line 285), called from `handle()` when the *first*
delegated question arrives. It's already written defensively —
`findOrCreateSession` handles the case where a session already exists for a
`bridge_session_id` (catching `UniqueConstraintViolationException` and
re-finding), which matters for this task: it means a session opened earlier
by something else is a safe, idempotent no-op here, not a conflict.

The consequence: a caller who hangs up before asking anything, dials a wrong
number, or sits in silence for the whole call leaves zero trace in
`voice_sessions`. The call happened; the system doesn't know.

Second gap: `voice_sessions.ended_at` is a real, nullable column with no
write path. `VoiceSessionController` has only `index` and `show`. Nothing —
not the delegation endpoint, not any scheduled job — ever sets it.

`keevaris-voice`'s `VoiceSession.teardown(reason: TransportCloseReason)`
(`src/session/VoiceSession.ts`, line 314) is the single, unified path every
call end already flows through — duration cap, idle timeout, caller hangup,
agent error, completed transfer. `TransportCloseReason` is already exactly
the shape an `end_reason` column needs.

## What to build

### `unit-hq-api`: extract session-open into its own endpoint

`POST /api/voice/bridge/{bridgeToken}/session`

Body: `{ bridge_session_id: string, caller_number: string | null }`. Auth via
the existing `VoiceBridgeAuth` (same as the delegation and config
endpoints). Handler calls the *same* `findOrCreateSession()` logic
`VoiceBridgeTurn::handle()` already uses — extract it from `VoiceBridgeTurn`
into a shared location both call (a small `VoiceSessionOpener` support
class, or a public static method `VoiceBridgeTurn` and the new controller
both use — whichever keeps `findOrCreateSession`'s existing
identity/conversation-creation logic in one place rather than duplicated).

This means `VoiceBridgeTurn::handle()`'s own session-creation call becomes a
safety net for calls that skip the explicit open (an older `keevaris-voice`
version, a race, a retry) — it doesn't change behavior for calls that *do*
open explicitly, since `findOrCreateSession` already no-ops on a duplicate
`bridge_session_id`.

Response: `{ id, bridge_session_id }` — the caller doesn't need the full
`VoiceSessionResource` shape, just confirmation and the id for later
correlation if needed (correlation is by `bridge_session_id` throughout,
matching the existing pattern).

### `unit-hq-api`: `end_reason` and the end endpoint

Migration: `end_reason` (string, nullable) alongside `ended_at` on
`voice_sessions`.

`POST /api/voice/bridge/{bridgeToken}/session/{bridgeSessionId}/end`

Body: `{ end_reason: string }`. Sets `ended_at = now()` and `end_reason` on
the matching `VoiceSession` (found by `bridge_session_id`, scoped to the
token — same cross-tenant safety as every other bridge endpoint). If no
session exists for that `bridge_session_id` at all (a call that never opened
and never delegated — should be rare after this task, but possible from an
older client), create one with `started_at = ended_at` rather than silently
discarding the end signal; log this case distinctly (`voice_session.end_without_open`)
so it's visible if it turns out to happen often.

Idempotent: ending an already-ended session updates nothing and returns
success, not an error — `keevaris-voice`'s `teardown()` guards against
double-calls already (`state.status === 'closed'` early-returns), but the
API side shouldn't assume that guarantee holds across a network retry.

### `keevaris-voice`: call both, at the right points

New `src/session/SessionLifecycleClient.ts`, same shape as
`KeevarisClient`/`BridgeConfigClient` — takes `BridgeCredentials`, two
methods, neither throws (log-and-continue on failure, matching the fallback
posture already established for the other two clients — losing the session
record must never drop the call):

- `open(bridgeSessionId, callerNumber)` — called from
  `handleTransportConnection` (`src/index.ts`) right after `transport`
  exists, in parallel with the `BridgeConfigClient` fetch (`Promise.all`,
  not sequential — neither depends on the other, and serializing them adds
  latency to every call for no reason).
- `end(bridgeSessionId, reason)` — called from `VoiceSession.teardown()`,
  the single line at the end of the method, after
  `Promise.allSettled([transport.close(...), agent.close()])`. Fire it, but
  don't let its own failure block returning from `teardown()` — it's
  already log-and-continue internally, so a bare call, not awaited into the
  critical path, is fine here; awaiting it is also fine given
  `Promise.allSettled` already tolerates failures — either is acceptable,
  pick whichever reads more clearly alongside the existing method.

`bridgeSessionId` — what is it, concretely? For Twilio, `CallSid` (already
resolved via the `CallRegistry`, V01-01). For web, `transport.sessionId`
(the token-claimed session id, V01-01/V03-02). Use `transport.sessionId`
uniformly — it already resolves to the right value on both transports, per
their existing constructors, so no new field is needed.

## Acceptance criteria

- [ ] `POST /api/voice/bridge/{token}/session` opens a session using the
      same identity-resolution logic as the existing delegation path, and is
      idempotent on repeat calls with the same `bridge_session_id`.
- [ ] `POST .../session/{bridgeSessionId}/end` sets `ended_at`/`end_reason`,
      is idempotent, and creates a session record if one is somehow missing
      rather than discarding the signal.
- [ ] `VoiceBridgeTurn::findOrCreateSession()`'s logic is shared, not
      duplicated, between the delegation path and the new open endpoint.
- [ ] `keevaris-voice` calls `open()` at connection start and `end()` from
      `teardown()`, neither blocking the call or teardown on failure.
- [ ] A real call that never asks a question — connect, wait, hang up —
      produces a `voice_sessions` row with `ended_at` set and `end_reason`
      matching the actual close reason.
- [ ] All Sprint 1/2/3 fixtures stay green; new fixtures cover the
      `SessionLifecycleClient` being called at the right points with the
      right values, using a stub matching `KeevarisClientStub`'s pattern.
- [ ] `unit-hq-api`: PHPUnit coverage for open (fresh session, idempotent
      repeat, cross-token 404), end (sets fields, idempotent, missing-session
      fallback), and confirmation that `VoiceBridgeTurn::handle()`'s
      existing behavior is unchanged when a session was already opened.

## Out of scope

- **Duration.** Per this project's own convention (established in the
  original V04 sketch and unchanged since): derive duration from
  `ended_at - started_at` at read time, never store it directly.
- **Retrying a failed `open()`/`end()` call.** Log-and-continue is the
  posture for this task; a retry policy is a V05 observability concern if
  the failure rate turns out to matter.
- **Anything about what happens *during* the session.** Transcript is
  V04-01; timing is V04-02.
