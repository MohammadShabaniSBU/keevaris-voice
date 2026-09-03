# V02-04 — Invariants and docs update

**Depends on:** V02-00, V02-01, V02-02, V02-03
**Blocks:** nothing
**Touches:** `keevaris-voice`

## Problem

`docs/conventions-and-invariants.md` V5 currently reads "mechanical
enforcement lands in V02-00" — that's a forward reference to a task that, as
of this task starting, has landed. V6 lists `prompt.ts` as an open violation
with V03-01 as the closing task — that's still accurate and shouldn't change,
but the doc should reflect that V02 shipped without touching it, so a reader
doesn't wonder whether V02 was supposed to and didn't.

This is the same discipline V01-05 applied to the API's invariant 55/73
citation: the doc should describe what the merged code actually does, not
what a task doc predicted it would do.

## What to build

### Update V5

Replace the forward reference with a description of the real mechanism:
`VoiceSession.handleFunctionCalls` speaks the delegated answer via
`agent.injectAgentMessage(result.text)`, bypassing the think model entirely,
enforced by the fixture(s) V02-00 added asserting `InjectAgentMessage`
carries the verbatim text and `FunctionCallResponse` never contains it. Name
the actual fixture file(s), the way V1 through V4 already name real fixtures
rather than describing hypothetical ones.

### Add a note on V02-01's scope boundary

`caller_utterance` now flows from this service to `unit-hq-api`, but is not
yet used in grounding — record this explicitly next to V5 or as its own line,
so nobody assumes the presence of the field means it's load-bearing in
`AgentRuntime` today. Name the follow-up (owned by whoever scopes
`AgentRuntime` work) rather than leaving it implicit.

### Update `AGENTS.md`'s routing table if needed

Check whether the "What the fast model is allowed to say" row still points to
the right place — it should now also mention `V02-00`'s fixtures as the
concrete enforcement, not just the prompt instruction, since the prompt
instruction is no longer the only thing holding that invariant up.

### Do not touch V6

`prompt.ts` is still a local copy of `unit-hq-api`'s config as of this task.
V6 stays exactly as V01-05 wrote it. If V02 work happened to touch
`prompt.ts` (adding `buildFunctionCallStub`, for instance), that's still
local-copy territory and doesn't change V6's status — it closes with V03-01,
not before.

## Acceptance criteria

- [ ] V5 describes the real, merged enforcement mechanism and cites real
      fixture file names.
- [ ] A note records that `caller_utterance` exists on the wire but isn't yet
      used in grounding, with the follow-up named.
- [ ] V6 is unchanged in substance (still open, still closes with V03-01).
- [ ] `AGENTS.md`'s routing table is checked against the new reality and
      updated only if it's actually stale.
- [ ] No invariant is renumbered. This task documents what shipped; it does
      not restructure the numbering V01-05 established.

## Out of scope

- Adding new invariants for V02's findings (turn-id minting, fallback
  observability). Those are implementation details in service of existing
  invariants, not new rules — don't inflate the list unless a future sprint
  finds a genuinely new one.
- Anything in `unit-hq-api`'s own invariants doc. That file is not this
  task's to edit; if V02-01's API-side migration needs documentation, that's
  a normal part of V02-01 itself, not this task.
