# Sprint 02 — Verbatim and delegation quality

**Sprint 1 status:** merged, all six tasks. `pnpm test` is 53/53 green,
including the five fixtures V01-00 shipped deliberately red
(`caller-speaks-during-greeting`, `hangup-during-agent-handshake`,
`transfer-after-filler`, `two-function-calls-one-request`,
`agent-socket-dies-mid-turn`) plus five more fixtures added by V01-02 through
V01-04 covering duration cap, idle timeout, the armed-transfer deadline, and
the transport-gone/agent-gone split in `completeTransfer('teardown')`. Lint
and typecheck are clean. `AGENTS.md` and `docs/conventions-and-invariants.md`
exist and cite real, merged code.

**This sprint's origin:** the reason to own this pipeline instead of renting
Vocal Bridge. `handleFunctionCalls` in `VoiceSession.ts` calls
`agent.respondToFunctionCall(result.call.id, result.call.name, result.text)`,
which sends `FunctionCallResponse` to Deepgram — and `FunctionCallResponse` is
a function *result*, not spoken text. Deepgram's think model reads it and
generates the sentence the caller actually hears. `buildSystemPrompt()` has
an instruction — "speak it back exactly as given" — asking the model not to
paraphrase. Instructions are not guarantees. Every number `GroundingGuard`
validated on the way out of `unit-hq-api` can still move on the way into the
caller's ear.

That's what the Sprint 28 launch gate called "verbatim is best-effort," and
it's the risk the entire gate was built around under the assumption we
couldn't fix it. We can now: `DeepgramVoiceAgent.injectAgentMessage(text)`
already exists, already sends `InjectAgentMessage`, and Deepgram speaks that
text directly — no think-model pass. `V01-04`'s `SpeechKind` queue already
distinguishes `filler` from `answer`. The pipe existed for the filler from day
one; this sprint routes the delegated answer through the same pipe.

## Findings → tasks

| # | Finding | Evidence | Task |
|---|---|---|---|
| 1 | The delegated answer is spoken through `FunctionCallResponse` → think-model paraphrase, not `InjectAgentMessage` verbatim | `VoiceSession.handleFunctionCalls`, `DeepgramVoiceAgent.respondToFunctionCall` | V02-00 |
| 2 | `query` sent to `KeevarisClient.ask()` is the think-model's parsed/paraphrased reading of the caller's question, not what the caller said; `GroundingGuardTest` on the API side grounds an answer to a question that was already lossy | `VoiceSession.handleFunctionCalls` (`args.query`), `AskKeevarisArguments` | V02-01 |
| 3 | `turn_id` sent to the API is Deepgram's own `FunctionCallRequest.id` — an idempotency key that depends on a vendor's id generation rather than one we mint and control | `entry.call.id` used directly as `turn_id` | V02-02 |
| 4 | `KeevarisClient.ask()` already catches every failure mode and returns a speakable fallback — that part is solid. But the fallback is structurally identical to a legitimate API-directed transfer: same shape, same `main_line` destination, no signal anywhere that this was *our* client giving up rather than the backend's decision. Nothing downstream can tell "unit-hq-api is unreachable" from "the backend routed this call to the front desk" | `KeevarisClient.fallback()`, `runTransfer` | V02-03 |
| 5 | `docs/conventions-and-invariants.md` V5 says "mechanical enforcement lands in V02-00" and V6 lists `prompt.ts` as an open violation — both need updating once this sprint lands | `docs/conventions-and-invariants.md` | V02-04 |

## Sequencing

```
V02-00 (verbatim speech path) ──┬── V02-04
V02-01 (utterance passthrough) ─┤
V02-02 (turn identity)          │
V02-03 (delegation failure) ────┘
```

V02-00 through V02-03 are independent of each other — different fields on the
same request/response shapes, different call sites. V02-04 is last because it
documents what the other four actually shipped, the same discipline V01-05
followed.

**Note on V02-03's scope:** the task doc that opened this sprint originally
asked for an hours-aware fallback policy in this service. Tracing the actual
code changed that: `KeevarisClient.ask()` already never throws and already
falls back gracefully, and office-hours logic (`OutsideHoursPolicy`,
`SiteClock::withinWindow`) lives entirely on `unit-hq-api`'s side. Duplicating
it here would repeat V6's mistake — a second source of truth for a decision
one side already owns. V02-03 below is scoped to making the fallback
*observable and distinct*, not to reimplementing hours logic locally.

## Definition of done

1. A real call: ask a question that gets a delegated numeric answer (a price,
   a unit count). The spoken audio is byte-identical to the corresponding
   `agent_conversation_messages` row for that turn on the API side — verified
   by listening and by a transcript diff, not by reading the prompt and
   trusting it.
2. `FunctionCallResponse` no longer carries the answer text. It carries a
   short context stub confirming what was answered, sized so the think model
   has enough to continue the conversation without ever needing to repeat the
   figure.
3. `KeevarisClient.ask()` receives the caller's verbatim last utterance
   alongside `query`.
4. `turn_id` is minted by this service, not read off `call.id`.
5. Delegation failure has an explicit, tested path distinct from "the whole
   call errors."
6. `docs/conventions-and-invariants.md` V5 and V6 reflect what shipped, not
   what was planned.
7. All Sprint 1 fixtures stay green. `pnpm lint`, `pnpm typecheck`, `pnpm test`
   clean.

## Not in this sprint

- **Localising the filler or greeting.** Still V03-03, still behind
  `buildFiller()`/`buildGreeting()`.
- **The config endpoint, multi-site numbers.** V03.
- **The session record, transcript persistence.** V04.
- **Barge-in cancelling a transfer.** Still explicitly out of scope per
  V01-04.
