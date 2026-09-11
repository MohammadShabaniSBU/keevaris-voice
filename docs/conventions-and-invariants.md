# Conventions and invariants

Hard rules for this repo. Numbered `V1`–`Vn`, separate from the API's list. Later sprints append; they do not renumber.

Anything that crosses the delegation boundary — the HTTP contract, the outbound guards, `AgentRuntime` — is governed by `unit-hq-api/docs/09-conventions-and-invariants.md`. This file does not restate those rules, and this repo does not get to reinterpret them. If something here appears to contradict `09`, the API wins and the conflict gets flagged.

Each invariant names the code that enforces it and the fixture that proves it. An invariant with neither is a wish.

---

**V1. Audio is never resampled.** `Transport` declares its own `audioInput` / `audioOutput` (`src/transport/Transport.ts`). That pair is the only input to `buildSettingsMessage` (`src/agent/deepgram/settings.ts`) and becomes `Settings.audio`. `DeepgramVoiceAgent.enqueuePrebuffer` / `flushPrebuffer` store and forward the bytes the transport produced; nothing between the socket and Deepgram converts encoding or sample rate.

Enforced by: `Transport.audioInput` / `audioOutput`, `buildSettingsMessage`, `DeepgramVoiceAgent` prebuffer.

Fixture: `tests/agent/deepgram/DeepgramVoiceAgent.test.ts` (`SettingsApplied flushes buffered audio in order and byte-identical`) asserts flushed chunks are the same `Buffer` instances the transport emitted. `tests/fixtures/calls/caller-speaks-during-greeting.json` proves those bytes still reach the socket when they arrive before the handshake.

**V2. `VoiceSession` never branches on the vendor.** No `if (transport.vendor === 'twilio')`. A behaviour that differs by vendor belongs behind a `Transport` method. This is the property that makes the interface worth having, and it is one careless line from being lost.

Enforced by: `VoiceSession.handleAgentEvent` (`src/session/VoiceSession.ts`) — barge-in is `transport.clearAudio()`, transfer is `runTransfer(transport, …)`, audio is `transport.sendAudio`. None of those paths read `transport.vendor`.

Fixture: `tests/fixtures/calls/barge-in-clears-playback.json` (Twilio) and `tests/fixtures/calls/barge-in-clears-playback-web.json` (`vendor: web`) assert the same event-log shape. The web path produces a `{"type":"clear"}` text frame; the Twilio path produces a `clear` event. `VoiceSession` does not know which.

**V3. Close is emitted exactly once and latched.** A subscriber registering after close is told immediately. `VoiceSession.teardown` is the only path that closes either socket.

Enforced by: `TwilioTransport.emitClose` / `WebTransport.emitClose` (`closedReason` latch + replay in `onClose`); `DeepgramVoiceAgent.emit` (`closedEvent` latch + replay in `onEvent`); `VoiceSession.teardown` (`src/session/VoiceSession.ts`) — idempotent, the only call site of `transport.close` and `agent.close`. `GracefulShutdown` (`src/server/GracefulShutdown.ts`) is the first production caller of `teardown('server_shutdown')`: SIGTERM drains, then force-tears remaining sessions with that reason so an already-armed transfer still completes rather than dying under the process.

Fixture: `tests/fixtures/calls/hangup-during-agent-handshake.json` (`assertTimersClearAfter: true`) — transport already closed before `VoiceSession` exists; the late `onClose` fires, `closeRequested` closes the agent socket that opens afterwards, no `Settings` frame goes out, no timer outlives the call. `tests/agent/deepgram/DeepgramVoiceAgent.test.ts` (`close during CONNECTING…`) covers the agent half alone. `tests/fixtures/calls/server-shutdown-completes-armed-transfer.json` — SIGTERM while a transfer is armed; teardown dispatches (`session.transfer_teardown`), never abandons.

**V4. No session starts from an unauthenticated socket, and the caller number never comes from client-supplied data.** It comes from the signature-validated `/twilio/voice` webhook by way of the call registry. Anything else is an identity claim, and `VoiceSessionOpener::audienceAllows` treats it as authentication. On `/web/media` the session id comes from a signed token, not from `randomUUID()` in the constructor. If a caller number is present on that socket, it also comes from the signed token (dev mint today; V08 later), never from a client frame.

Enforced by: `handleTwilioVoiceWebhook` + `InProcessCallRegistry` (`src/index.ts`, `src/transport/twilio/CallRegistry.ts`); `TwilioTransport` reading `callerNumber` from `CallRegistry.take` only; `WebTokenService` + `createWebTransport` (`src/transport/web/WebToken.ts`, `src/transport/web/WebTransport.ts`); `ConnectionGate` at upgrade (`src/server/ConnectionGate.ts`). `GET /dev/token` is registered only when `ALLOW_DEV_PAGE` is true.

Fixture: `tests/transport/twilio/TwilioTransport.test.ts` (forged `start` frame, replayed nonce, `CallSid` mismatch); `tests/transport/twilio/CallRegistry.test.ts`; `tests/transport/web/WebToken.test.ts`; `tests/server/ConnectionGate.test.ts`.

**V5. The fast model never speaks a figure that did not come back from a delegated answer.** Prices, availability, dates, balances, unit numbers, access codes. Enforced in the prompt (`buildSystemPrompt` in `src/agent/prompt.ts`) and mechanically: `VoiceSession.handleFunctionCalls` speaks the delegated answer via `agent.injectAgentMessage(result.text, 'interrupt')`, bypassing the think model entirely. `FunctionCallResponse` carries only `buildFunctionCallStub(result)`, a fixed acknowledgement string — never the answer text or any figure from it. After that answer's own `AgentAudioDone`, `VoiceSession` drops leftover think-model audio and agent transcripts until a non-empty caller `ConversationText` arrives (`suppressThinkSpeech`). VAD (`userStartedSpeaking`) does not clear the mute — mic noise must not unlatch it. The mute is also cleared immediately before a filler or answer `injectAgentMessage` so speech we asked for is never swallowed. Filler uses `queue` and may be refused while the caller is mid-turn (`InjectionRefused`); that must not block `deliverAnswer` — skip the filler wait and still inject the answer. Barge-in resets the speech queue so a late `AgentAudioDone` from the barged-in turn is not labeled `answer`. A 2s watchdog covers a lost filler `AgentAudioDone`. `Settings.agent.think.provider.temperature` defaults to 0; that only reduces randomness, it does not mute the leftover turn.

This is a restatement of the API's **invariant 55** ("No money, date, or unit identifier in agent output originates from the model") and must stay in sync with it rather than drift. Sprint-01 task text called this "invariant 73"; that was draft numbering from `S28-02` and never landed in `09`. The rule in `unit-hq-api/docs/09-conventions-and-invariants.md` is 55.

Enforced by: `VoiceSession.handleFunctionCalls` (`src/session/VoiceSession.ts`), `buildFunctionCallStub`, `DeepgramVoiceAgent.injectAgentMessage` / `respondToFunctionCall`.

Fixture: `tests/fixtures/calls/happy-path-single-delegation.json` and `tests/fixtures/calls/two-delegated-answers-one-request.json` assert `InjectAgentMessage` carries the verbatim answer text and `FunctionCallResponse` never contains it (`forbidContent`, per-call via `functionCallId` in the two-answer case). `tests/fixtures/calls/think-speech-suppressed-after-answer.json` asserts a leftover think-model `ConversationText` plus a uniquely sized audio frame after the answer `AgentAudioDone` never reach `transport.sendAudio` or the transcript. `tests/fixtures/calls/think-speech-survives-vad-without-transcript.json` asserts `UserStartedSpeaking` without a following user `ConversationText` leaves the mute latched. `tests/fixtures/calls/filler-inject-refused-still-speaks-answer.json` asserts a refused filler still yields the answer inject and `FunctionCallResponse`. `tests/fixtures/calls/barge-in-during-answer-then-delegate.json` asserts a barge-in during the first answer plus a refused second filler still injects the second answer, and a late `AgentAudioDone` does not latch `suppressThinkSpeech`.

**Note (V02-01 scope boundary).** `caller_utterance` now flows from this service (`VoiceSession.lastCallerUtterance` → `DelegationRequest.caller_utterance`) to `unit-hq-api`, which persists it on `voice_session_turns`. It is not yet used in grounding or query resolution — its presence on the wire does not mean it is load-bearing in `AgentRuntime` today. Follow-up (wiring it into grounding) belongs to whoever next scopes `AgentRuntime` work, not to this repo.

**Note (transcript delta).** Each `ask()` also carries `context_segments`: the unsent caller / front-desk turns strictly before the triggering utterance (`lastMirroredSequence < sequence < lastCallerUtteranceSequence`, `source !== 'delegated'`). The triggering row is omitted because the API persists `query` as that turn's user message. Delegated answers are omitted because `AgentRuntime` already wrote them. The bridge holds no conversation state of its own on the API side and never re-sends what it already sent — `lastMirroredSequence` is the watermark. The same delta is attached to every call in a batch; the API watermark makes repeats free. Fixture: `tests/fixtures/calls/transcript-context-sent-to-delegation.json`.

**V6. There is one source of truth for prompt, greeting, and filler, and it is `unit-hq-api`.** A local copy is a defect even when it is faster.

**Closed in V03-03.** `BridgeConfigClient` fetches `GET /api/voice/bridge/{token}/config` once per call; `prompt.ts`'s `GREETING_EN`/`FILLER_EN` and the hand-written prompt-additions list are gone. `COMPANY_NAME` and the transfer-number env vars remain as fallback-only defaults when the fetch fails — the call still proceeds in English rather than dropping. A config change on the API side takes effect on the next call, not the current one.

Enforced by: `BridgeConfigClient`, `handleTransportConnection` (`src/index.ts`).

Fixture: `tests/fixtures/calls/bridge-config-drives-greeting-and-prompt.json` asserts a non-default greeting, filler, and `promptAdditions` reach `Settings` and `InjectAgentMessage`. `tests/fixtures/calls/bridge-config-fetch-failure-falls-back.json` asserts a failed fetch logs `bridge_config.fetch_failed` and still starts the call with the English fallback.

**V7. An ordering fix ships with a fixture that fails without it.** Every defect in sprint 01 was a timing relationship, and a timing relationship that is not asserted is not fixed. `tests/runFixture.ts` + `tests/calls.test.ts` replay `tests/fixtures/calls/*.json` against doubles; a new ordering bug adds a fixture there, not a prose reproduction.

Enforced by: `tests/runFixture.ts`, `tests/calls.test.ts`.

Fixture: the mechanism is the fixture set. Precedent from this sprint:

| Defect | Fixture |
|---|---|
| Hangup during handshake leaks the agent socket | `hangup-during-agent-handshake.json` |
| Silence drops Deepgram | `silence-then-question.json` |
| Duration cap / idle timeout | `duration-cap-closes-call.json`, `idle-timeout-closes-call.json` |
| Pre-handshake audio dropped | `caller-speaks-during-greeting.json` |
| Filler's `AgentAudioDone` fires the transfer | `transfer-after-filler.json` |
| Two function calls, two fillers | `two-function-calls-one-request.json` |
| Armed transfer, dead agent socket | `agent-socket-dies-mid-turn.json` |
| Transfer deadline / teardown abandon | `armed-transfer-deadline.json`, `transfer-abandoned-on-caller-hangup.json` |
| SIGTERM drain completes an armed transfer | `server-shutdown-completes-armed-transfer.json` |
| Second FunctionCallRequest while first ask is in flight | `queued-function-calls-across-events.json` |
| Think-model leftover after a delegated answer | `think-speech-suppressed-after-answer.json` |
| VAD without a transcript must not unlatch the mute | `think-speech-survives-vad-without-transcript.json` |
| Unsent transcript delta on each `ask()` | `transcript-context-sent-to-delegation.json` |
| Refused filler must not block the answer | `filler-inject-refused-still-speaks-answer.json` |
| Barge-in during answer, then a new delegation | `barge-in-during-answer-then-delegate.json` |
