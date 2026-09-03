# Sprint 01 — Call-path correctness

**Origin:** the first sketch (`82dd161`) established the seams. `Transport`,
`AgentProvider` and `KeevarisClient` are the right three boundaries and `VoiceSession`
orchestrates them without knowing which vendor it holds. That structure is correct and this
sprint does not touch it.

What it does touch is everything that happens at the edges of a call: who is allowed to open
a socket, what happens to audio that arrives before the far end is ready, what happens when
a socket dies in the middle of setup, and which spoken turn a transfer is allowed to
interrupt. Six defects, all of them ordering or lifecycle, none of them findable by placing
a test call and listening.

That last point is why this sprint opens with a harness rather than a fix.

## The shape of the problem

A call is a state machine driven by two sockets that fail independently and a third party
(the caller) who interrupts. The first sketch models it as a set of callbacks with no
explicit state, which works for the happy path and breaks in four specific ways:

**Handlers are registered after the events they need to catch.** `createTwilioTransport`
awaits the `start` frame, and only afterwards does `VoiceSession.start()` subscribe to
`onAudio` and `onClose`. Anything the transport emits in between is delivered to an empty
handler list and gone. `emitClose` compounds this by setting `closed = true` before any
subscriber exists, so the close can never be replayed.

**Two things are called "done speaking" and only one of them is.** `AgentAudioDone` fires
after the latency filler and after the real answer, and `handleAgentAudioDone` cannot tell
them apart.

**Silence is indistinguishable from a dead socket.** Nothing sends `KeepAlive` and nothing
caps call duration, so an idle call drops and a wedged one bills forever.

**Anyone can start a call.** Neither WebSocket path authenticates, and the caller number is
read from a client-supplied frame.

## Findings → tasks

| # | Finding | Evidence | Task |
|---|---|---|---|
| 1 | `server.on('upgrade')` resolves a transport module by path and accepts the socket; no credential is checked on either path | `src/index.ts` | V01-01 |
| 2 | `customParameters.From` is trusted as the caller number and reaches `VoiceCallerIdentity::resolve()`, which drives the `KnownContacts` / `ExistingTenants` audience gate | `TwilioTransport.handleMessage` (`start`), `unit-hq-api` `VoiceBridgeTurn::audienceAllows` | V01-01 |
| 3 | No `KeepAlive` is sent; the Deepgram agent socket closes on idle | `DeepgramVoiceAgent` | V01-02 |
| 4 | `session.max_call_duration_minutes: 30` from `vb-customer-config.json` is unimplemented | — | V01-02 |
| 5 | `emitClose` latches `closed` before `VoiceSession` subscribes; a hangup during the Deepgram handshake leaks the agent socket | `TwilioTransport.emitClose`, `VoiceSession.start` | V01-02 |
| 6 | `DeepgramVoiceAgent.close()` is a no-op while `this.ws` is `undefined` or `CONNECTING`; the socket that opens afterwards is never closed | `DeepgramVoiceAgent.close` | V01-02 |
| 7 | Audio arriving before `SettingsApplied` is silently dropped by `sendAudio`'s `readyState` guard — roughly the first half-second of the call | `DeepgramVoiceAgent.sendAudio`, `VoiceSession.start` | V01-03 |
| 8 | `AgentAudioDone` fires for the injected filler; a transfer armed while the filler is playing cuts the caller off mid-sentence | `VoiceSession.handleAgentAudioDone`, `FILLER_TEXT` | V01-04 |
| 9 | `handleFunctionCallRequest` emits one event per entry in `functions`; two calls in one request means two fillers spoken | `DeepgramVoiceAgent.handleFunctionCallRequest` | V01-04 |
| 10 | `"test": "echo \"Error: no test specified\" && exit 1"` on a service in the call path | `package.json` | V01-00 |
| 11 | No `AGENTS.md` and no invariants doc in this repo; Cursor is writing most of it with no rules file | — | V01-05 |

## Sequencing

```
V01-00 (harness) ──┬── V01-02 ──┬── V01-03
                   │            └── V01-04
                   └── V01-01

V01-05 (last — conventions, invariants, CI)
```

`V01-00` is first and blocks everything. `V01-01` is independent of the lifecycle work and
can run in parallel. `V01-03` and `V01-04` both need the close-latching and state machine
that `V01-02` introduces.

## Definition of done

One Twilio number, one browser tab, and the harness:

1. `pnpm test` replays the scripted call fixtures and is green in CI.
2. A WebSocket opened directly against `/twilio/media` with a fabricated `start` frame is
   refused, and the refusal is logged with the claimed `CallSid`.
3. A WebSocket opened against `/web/media` without a valid token is refused.
4. A real call where the caller talks over the greeting: the first word appears in the
   `ConversationText` transcript.
5. A real call held silent for three minutes stays connected.
6. A caller who hangs up during the Deepgram handshake leaves no open socket — asserted in
   the harness, confirmed by a process with zero live sessions afterwards.
7. A delegated answer that returns `transfer: true` plays its full sentence before the line
   moves. Verified by listening, and asserted in the harness by event order.
8. A call that runs past the duration cap is closed with `end_reason: duration_cap`, not by
   Twilio or Deepgram timing out first.
9. `docs/conventions-and-invariants.md` exists and each of its invariants has at least one
   harness fixture.

## Not in this sprint

- **Verbatim speech.** `FunctionCallResponse` still routes our text through the think model.
  That is V02, and it is deliberately separate: this sprint makes the call path correct, the
  next makes what it says correct.
- **The config endpoint.** `prompt.ts` stays a local copy and `COMPANY_NAME` stays in env
  until V03. Do not fix the source-of-truth violation halfway.
- **Redis.** `V01-01`'s call registry is defined as an interface with an in-process
  implementation. The Redis implementation and the multi-instance question are V05-02.
- **Session persistence.** Nothing here writes `ended_at` or a transcript. V04.
- **Transfer robustness.** `callerId`, `<Dial>` timeouts, no-answer fallback and voicemail
  are V07. This sprint only fixes *when* the transfer fires, not what it dials.
