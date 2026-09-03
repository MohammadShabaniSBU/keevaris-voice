# V01-04 — Turn ordering: filler, function calls, and when a transfer may fire

**Depends on:** V01-02
**Blocks:** nothing in this sprint; blocks launch
**Touches:** `keevaris-voice`

## Problem

**The transfer can cut the caller off mid-sentence.** `handleFunctionCall` injects
`"Let me check that for you."` as latency filler, awaits the delegation, sets
`transferPending` when the backend asks for a transfer, and responds to the function call.
`handleAgentAudioDone` then transfers on the next `AgentAudioDone`.

But `AgentAudioDone` fires after *every* spoken turn, and the filler is a spoken turn. The
comment in the file acknowledges this and reasons that the flag makes it safe. It does not:
the delegation round trip and the filler playback run concurrently. A fast delegation — a
cached answer, a rate-limited early return, a `handoffBody` from a failed audience check —
resolves while "Let me check that for you" is still playing. The flag is set, the filler's
`AgentAudioDone` arrives, and the line moves. The caller hears half a hold phrase and then a
ringing tone. They were never told they were being transferred, and the transfer sentence
that `VoiceTransfer::handoffSentence()` carefully produced was never spoken.

This is the worst-sounding failure in the service and it gets *more* likely as the backend
gets faster.

**Two function calls means two fillers.** `handleFunctionCallRequest` iterates `functions`
and emits one event per entry. Each emitted event independently calls `injectAgentMessage`,
so the caller hears the hold phrase twice, over itself.

**A dead socket strands a pending transfer.** If the agent socket dies after the transfer is
armed and before `AgentAudioDone`, the transfer never runs and the caller is dropped rather
than routed.

## What to build

### Name the audio you are waiting for

Stop treating `AgentAudioDone` as an anonymous signal. Track what the agent is currently
speaking:

```
nothing | greeting | filler | answer
```

Set it when we cause speech (`injectAgentMessage` sets `filler`,
`respondToFunctionCall` sets `answer`) and clear it on `AgentAudioDone`. A transfer arms only
against the `AgentAudioDone` that closes an `answer`. A filler completing while a delegation
is in flight clears `filler` and does nothing else.

This is the same shape as V01-02's lifecycle state and should sit beside it, not in a
parallel set of booleans.

### One filler per request

Move the filler out of the per-call handler. `DeepgramVoiceAgent` should emit one event
carrying all functions from a `FunctionCallRequest`, or `VoiceSession` should track that a
filler is already playing for the current request. Either way: one hold phrase per caller
utterance, however many functions the model asked for.

Resolve multiple calls concurrently but respond in the order Deepgram listed them, and arm a
transfer if **any** of them asked for one. Two delegations in one turn is not a shape the
prompt encourages, and it must not produce two spoken answers over each other when it
happens.

### A deadline on the armed transfer

Once a transfer is armed, start a timer. If the closing `AgentAudioDone` does not arrive
within a small budget — a few seconds, sized against the 600-character ceiling of
`ChannelProfile::Voice` — run the transfer anyway and log it. Being transferred slightly
early is recoverable; being dropped is not.

Same reasoning for teardown: `teardown` must run a pending transfer before closing the
transport, or explicitly log that it abandoned one.

### Filler text is not a constant

`FILLER_TEXT` is hardcoded English while `buildSystemPrompt()` instructs the model to answer
in the caller's language. A Spanish-speaking caller gets an English hold phrase in the middle
of a Spanish call.

Do not fix this properly here — the phrase belongs in the config the API serves, alongside
the greeting, in V03-03. What this task does is stop it being a module-level constant: move
it behind the same accessor the greeting will use, so V03 changes one source rather than
hunting for string literals.

## Acceptance criteria

- [ ] The agent's current speech kind is tracked explicitly; `transferPending` as a bare
      boolean is gone.
- [ ] `transfer-after-filler.json` is green: with a delegation that resolves before the
      filler finishes, the transfer sentence is spoken in full and only then does
      `transport.transfer` run.
- [ ] `two-function-calls-one-request.json` is green: exactly one filler, responses in
      request order, transfer armed if any call requested one.
- [ ] An armed transfer with no closing `AgentAudioDone` fires on its deadline and logs.
- [ ] `teardown` runs a pending transfer or logs abandoning it.
- [ ] Filler text is behind an accessor, not a module constant.
- [ ] `agent-socket-dies-mid-turn.json` is green: the caller is transferred, not dropped.

## Out of scope

- **Localising the filler.** V03-03, with the greeting and the disclosure line.
- **Speaking the delegated answer verbatim.** Still `FunctionCallResponse` through the think
  model until V02-00. This task fixes *when* things are spoken, not what.
- **What the transfer dials.** `callerId`, `<Dial>` timeouts, no-answer fallback and
  voicemail are V07. `TransferPolicy` keeps its current two destinations.
- **Cancelling a transfer on barge-in.** A caller who interrupts the transfer sentence still
  gets transferred; the backend decided, not the model. If that turns out to be wrong it is a
  product decision with telemetry behind it, not a fix.
