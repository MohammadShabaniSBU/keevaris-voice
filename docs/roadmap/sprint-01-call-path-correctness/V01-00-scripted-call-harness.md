# V01-00 — Scripted-call harness

**Depends on:** nothing — first task of the sprint
**Blocks:** V01-01, V01-02, V01-03, V01-04
**Touches:** `keevaris-voice`

## Problem

Every other finding in this sprint is an ordering bug. Audio dropped during a handshake, a
close event delivered to an empty handler list, a transfer fired against the wrong
`AgentAudioDone`. None of them is reachable by placing a call and listening, because they
depend on the relative timing of two independent sockets, and on a phone the timing usually
lands the right way.

`package.json` currently has `"test": "echo \"Error: no test specified\" && exit 1"` on a
service that sits between a paying customer and a phone line.

There is a second reason to build this first. `AgentProvider` exists so Deepgram can be
replaced. That option is worthless without a suite that describes what a correct provider
does, because nobody will attempt the swap on faith.

## What to build

### A fake transport and a fake agent socket

Two test doubles that implement the real interfaces and are driven by the test rather than
by a network:

- `FakeTransport implements Transport` — the test pushes audio chunks, triggers close with a
  chosen reason, and asserts on what was sent back and on `clearAudio` calls.
- `FakeAgentSocket` — stands in for the Deepgram WebSocket, not for `AgentProvider`. The
  real `DeepgramVoiceAgent` runs against it, so the message translation in
  `handleControlMessage` is under test rather than mocked away. The test emits `Welcome`,
  `SettingsApplied`, `ConversationText`, `FunctionCallRequest`, `AgentAudioDone`, `Error`,
  binary audio frames, and close, at times it chooses.

Inject both through the existing constructor seams. `VoiceSession` already takes its
dependencies as a `VoiceSessionDeps` object, and `DeepgramVoiceAgent` should take a socket
factory rather than constructing `new WebSocket` inline. That is the only production change
this task makes.

### Scripted call fixtures

A call is a list of timestamped events with expectations, held as data rather than as
imperative test code:

```
fixtures/calls/
  happy-path-single-delegation.json
  caller-speaks-during-greeting.json
  hangup-during-agent-handshake.json
  transfer-after-filler.json
  two-function-calls-one-request.json
  silence-then-question.json
  delegation-timeout.json
  agent-socket-dies-mid-turn.json
```

Each fixture declares the inbound event sequence and the expected outbound sequence, and the
runner asserts **order**, not just presence. Order is the whole point: "the transfer sentence
was spoken" and "the transfer sentence was spoken before the line moved" are different
assertions and only the second one is the bug.

Fixtures use a virtual clock so a three-minute silence test runs in milliseconds. Do not use
real timers anywhere in the suite.

### A delegation stub

A `KeevarisClient` double that returns canned `{text, transfer, destination}` bodies and can
be told to delay past the timeout, return a 5xx, or return malformed JSON. The wire shape it
returns must stay in sync with `unit-hq-api`'s `VoiceBridgeTurn::handle` return type; keep a
copy of that contract in `src/delegation/types.ts` as it is today and assert against it, so a
backend change breaks a test here rather than a call in production.

### Wire it into CI

`pnpm test` runs the suite. CI runs `lint`, `typecheck`, and `test`, matching the panel's
convention of a short fixed CI surface. A red suite blocks merge.

## Acceptance criteria

- [ ] `FakeTransport` and `FakeAgentSocket` exist and the real `DeepgramVoiceAgent` and
      `VoiceSession` run unmodified against them.
- [ ] `DeepgramVoiceAgent` takes a socket factory; no `new WebSocket` at a call site that a
      test needs to reach.
- [ ] At least the eight fixtures above exist and run on a virtual clock.
- [ ] The runner asserts event **order**, and a fixture that reorders two correct events
      fails.
- [ ] The four fixtures covering findings 5, 7, 8 and 9 are **red** at the end of this task.
      They are the specification for V01-02 through V01-04 and must not be written to pass.
- [ ] `pnpm test` is wired into CI alongside `lint` and `typecheck`.

## Out of scope

- Fixing anything the red fixtures describe. Those are V01-02, V01-03 and V01-04.
- A fake Twilio REST API for `transfer()`. Assert that `transport.transfer(number)` was
  called with the right number; whether the Twilio SDK does the right thing with it is V07.
- Load or soak testing. Concurrency behaviour is V05.
- Recording real Deepgram sessions as cassettes. Tempting, and it couples the suite to a
  vendor's current wire format at exactly the layer we want replaceable.
