# V02-00 — Verbatim speech path

**Depends on:** V01 (merged)
**Blocks:** V02-04
**Touches:** `keevaris-voice`

## Problem

`handleFunctionCalls` in `VoiceSession.ts` ends with:

```ts
for (const result of results) {
  agent.respondToFunctionCall(result.call.id, result.call.name, result.text)
}
```

`respondToFunctionCall` sends Deepgram a `FunctionCallResponse`, which is a
function *result*. Deepgram's think model reads it as context and generates
the sentence it speaks — the same model `buildSystemPrompt()` instructs with
"speak it back exactly as given" and "do not paraphrase or shorten it." That
instruction is the entire enforcement mechanism today, and it is exactly the
"external TTS is best-effort" risk the Sprint 28 launch gate flagged as
unfixable at the time.

`unit-hq-api`'s `GroundingGuardTest` (invariant 55) guarantees the *text*
`result.text` is grounded — no money, date, or unit identifier that didn't
come from a delegated source. It guarantees nothing about what Deepgram's
think model does with that text on the way to the caller's ear. A price of
"one hundred twenty" can become "about a hundred and twenty" or "just over a
hundred" without anything in this pipeline noticing, because nothing checks
the *output* of the think model against the *input* it was given.

`injectAgentMessage(text)` already exists and already sends
`InjectAgentMessage`, which Deepgram speaks directly with no think-model
pass — that's how the filler ("Let me check that for you.") is spoken today,
verbatim, every time. The mechanism this task needs already exists in the
codebase; it's wired to the wrong turn.

## What to build

### Speak the answer via `InjectAgentMessage`

Change `handleFunctionCalls`'s response loop. For each result:

1. Call `agent.injectAgentMessage(result.text)` — the caller hears exactly
   `result.text`, the same string `GroundingGuardTest` validated.
2. Call `agent.respondToFunctionCall(result.call.id, result.call.name, stub)`
   with a short context stub, not the full answer — see below. This keeps the
   function-call/response pair Deepgram's protocol requires, without handing
   the full text to the think model to potentially reprocess.

The existing `SpeechKind` queue (`filler` → `answer`, from V01-04) already
tracks which spoken turn is in flight and which one a transfer should wait on.
`injectAgentMessage` for the answer enqueues as `'answer'`, exactly the way it
does today — no change needed to the queue logic itself, only to *what* gets
spoken as the answer.

### Design the context stub

`FunctionCallResponse` still needs *some* content, because Deepgram's protocol
expects a response to every function call and the think model uses it to
decide what to say or do next (for example, to continue the conversation
naturally after the injected message finishes, or to notice a transfer is
pending). The stub must never contain a figure:

```ts
function buildFunctionCallStub(result: DelegationResultForCall): string {
  return result.transfer
    ? 'Answered. The caller is being transferred.'
    : 'Answered. Continue the conversation naturally.'
}
```

Exact wording is not load-bearing — what's load-bearing is that no number,
date, or identifier from `result.text` appears in it. Enforce this
mechanically (see Acceptance criteria), not just by writing careful code.

### Multiple calls in one request

`V01-04` already handles the batching: one filler for the whole
`FunctionCallRequest`, responses sent in Deepgram's list order, one `answer`
enqueued after the last response. This task changes what gets spoken for that
one `answer` slot — nothing about the batching or ordering changes. If two
calls in one request both return text, decide how they concatenate for the
single `injectAgentMessage` call (newline-joined is the reasonable default);
write a fixture for it, since nothing currently exercises two delegated
answers landing in the same request.

### Verify Deepgram's behaviour, don't assume it

Confirm against Deepgram's Voice Agent documentation, or by testing against
the real API in a manual call, that:

- An injected message during an active `FunctionCallRequest`/
  `FunctionCallResponse` exchange is queued and spoken correctly rather than
  interleaved oddly with the function-call turn.
- The injected text appears in `ConversationText` events attributed to the
  assistant, so V04's transcript work (later) captures it correctly.

If either doesn't hold as expected, that changes this task's shape — flag it
rather than working around it silently.

## Acceptance criteria

- [ ] `handleFunctionCalls` calls `injectAgentMessage(result.text)` for the
      answer; `respondToFunctionCall` carries only the stub.
- [ ] A fixture asserts `agentSocketSend:InjectAgentMessage` carries the full
      delegated text (matched against the fixture's canned `result.text`,
      not just presence).
- [ ] A fixture asserts `agentSocketSend:FunctionCallResponse`'s content does
      **not** contain the delegated text or any digit from it — this is the
      test that would catch a regression back to speaking through the
      function-call response.
- [ ] A fixture covers two calls in one `FunctionCallRequest` both returning
      delegated text, asserting both appear in the spoken output.
- [ ] `transfer-after-filler.json` and every other Sprint 1 fixture referring
      to `AgentAudioDone`/`answer` timing stays green — this task changes
      *what* is spoken as the answer, not *when*.
- [ ] Manual verification: one real call, one delegated numeric answer,
      transcript diff against `agent_conversation_messages` shows an exact
      match.

## Out of scope

- **The context stub's exact wording being configurable.** Hardcode two
  variants (transfer / no transfer) for now; revisit only if Deepgram's
  behaviour requires more nuance than that.
- **Verifying `GroundingGuardTest` itself.** That's `unit-hq-api`'s
  responsibility; this task assumes `result.text` arrives already grounded
  and only guarantees it reaches the caller unchanged.
- **The caller's utterance being sent verbatim to delegation.** That's
  V02-01 — this task is about output fidelity, that one is about input
  fidelity.
