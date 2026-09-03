# V01-02 — Socket lifecycle: keepalive, duration cap, and close exactly once

**Depends on:** V01-00
**Blocks:** V01-03, V01-04
**Touches:** `keevaris-voice`

## Problem

A call holds two sockets that fail independently, and the first sketch has no shared notion
of when the call is over. Four consequences:

**Silence closes the agent socket.** Nothing sends `KeepAlive`. A caller who thinks for
twenty seconds, or who is put on hold at their end, can drop the Deepgram connection, and
the only signal is a `closed` event that tears down the call.

**Nothing caps duration.** `session.max_call_duration_minutes: 30` was a Vocal Bridge
dashboard setting and is now nobody's job. A wedged call streams audio and bills until a
vendor's own timeout notices.

**A close can be delivered to nobody.** `emitClose` sets `this.closed = true` and iterates
`closeHandlers`. During setup that array is empty: `createTwilioTransport` awaits the `start`
frame, then `DeepgramVoiceAgent` is constructed and `agent.start()` is awaited, and only
inside `VoiceSession.start()` does `transport.onClose` get registered. A caller who hangs up
in that window sets `closed` with no subscriber, and the close is unrecoverable. The Deepgram
socket that opens a moment later has nothing left that will close it.

**Closing an agent mid-handshake does nothing.** `DeepgramVoiceAgent.close()` is
`this.ws?.close()`. While `start()` is still awaiting, `this.ws` is either `undefined` or
`CONNECTING`, so the call is a no-op and the socket opens afterwards, unowned.

Together these are the leak. There is no counter today that would show it.

## What to build

### Latch the close

`Transport` implementations keep the close reason, not just a boolean. `onClose(handler)`
invokes the handler immediately if the transport is already closed, then never again. The
existing "exactly once" guarantee stays; late subscription stops losing the event.

Do the same for the agent's terminal `closed` event. Everything else on `AgentEvent` is
transient and must not be replayed — only the terminal state is latched.

### An explicit call lifecycle

Give `VoiceSession` a single owned state rather than three booleans (`transferPending`,
`transferDestination`, `closing`) that can disagree:

```
connecting → active → { transferring | closing } → closed
```

Terminal transitions run one `teardown(reason)` that closes both sockets, is idempotent, and
is the only place either socket is closed. Every path — caller hangup, agent error, duration
cap, idle timeout, transfer complete, delegation catastrophe — goes through it.

`TransportCloseReason` gains `duration_cap` and `idle_timeout`. `server_shutdown` already
exists in the type and is still unused; leave it, V05-03 uses it.

### `KeepAlive`

Send Deepgram's keepalive on a timer while the agent socket is open and no audio has been
sent within the interval. Use the interval Deepgram's Voice Agent documentation specifies
rather than a guessed number, and put it in config with that citation in a comment. Stop the
timer in `teardown`; a leaked interval keeps the process alive after the call.

### Duration cap and idle timeout

Two independent timers, both configurable, both firing `teardown`:

- **Duration cap** (`MAX_CALL_SECONDS`, default 1800) from the moment the transport is
  created.
- **Idle timeout** (`IDLE_TIMEOUT_SECONDS`) since the last caller audio *or* agent audio.
  This catches the case where both sockets are technically open and nothing is happening —
  a caller who set the phone down.

The reason is recorded distinctly for each, because V04 will report on them and "we hung up
on them" and "they walked away" are different operational facts.

Speaking a line before closing on the cap is desirable and needs the ordering machinery from
V01-04. Do it there if it is cheap; a bare close with the right reason is acceptable for this
task.

### Close the agent that has not opened yet

`DeepgramVoiceAgent` tracks a `closeRequested` flag. `close()` sets it and closes whatever
exists; the `open` handler checks it and closes immediately if set. `start()`'s promise must
reject rather than hang when close arrives first, so the awaiting caller unwinds.

## Acceptance criteria

- [ ] `onClose` registered after close fires immediately, exactly once.
- [ ] `VoiceSession` has one lifecycle state; `transferPending` / `closing` booleans are
      gone.
- [ ] `teardown(reason)` is the only code path that closes either socket, and is idempotent.
- [ ] `KeepAlive` is sent on the documented interval and stops at teardown; the fixture for
      a three-minute silence stays connected.
- [ ] Duration cap and idle timeout each fire teardown with their own reason.
- [ ] `hangup-during-agent-handshake.json` is green: no socket remains open, and the
      registered session count returns to zero.
- [ ] `DeepgramVoiceAgent.close()` during `CONNECTING` closes the socket when it opens and
      `start()` rejects.
- [ ] No timer outlives its call; the harness asserts the process has no pending timers after
      teardown.

## Out of scope

- **Graceful process shutdown.** Draining live calls on SIGTERM is V05-03; this task only
  makes the per-call teardown correct enough for it to be built on.
- **Reconnecting a dropped Deepgram socket mid-call.** Tempting and wrong at this stage: the
  conversation state lives in Deepgram's session and does not survive. A dropped agent socket
  ends the call. Revisit only if telemetry from V04 says it happens often.
- **Persisting `ended_at` and the end reason.** The reasons are produced here and written in
  V04-00.
