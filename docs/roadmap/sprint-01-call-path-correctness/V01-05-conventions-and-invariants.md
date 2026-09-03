# V01-05 — Repo conventions, invariants, and CI

**Depends on:** V01-01, V01-02, V01-03, V01-04
**Blocks:** nothing
**Touches:** `keevaris-voice`, `unit-hq-api/docs`

## Problem

`unit-hq-api` has `AGENTS.md` and `09-conventions-and-invariants.md`, and the instruction
that a request conflicting with the invariants gets flagged rather than silently obeyed. This
repo has neither, and Cursor is writing most of it.

The first sketch shows exactly what that costs. It is good code that quietly violated three
rules nobody had written down: it introduced a second source of truth for the prompt (with a
comment apologising for it), it baked the operator's company name into process env after
S28's launch gate said that must never happen, and it read an identity claim from a
client-supplied frame. Each was locally reasonable. None would have survived a rules file.

Last task of the sprint, because the invariants should describe what the code now does rather
than what someone hoped it would.

## What to build

### `AGENTS.md`

Short, in the API's format: a table routing a task to the doc that governs it, then the
non-negotiables. It must point across the repo boundary — anything touching the delegation
contract, the guards, or the agent runtime is governed by
`unit-hq-api/docs/09-conventions-and-invariants.md`, and this repo does not get to
reinterpret it.

### `docs/conventions-and-invariants.md`

The rules this repo actually needs. Start with these seven and let later sprints append:

**V1. Audio is never resampled.** `Transport` declares its own format and that format drives
`Settings.audio`. Nothing between the socket and Deepgram converts encoding or sample rate.

**V2. `VoiceSession` never branches on the vendor.** No `if (transport.vendor === 'twilio')`.
A behaviour that differs by vendor belongs behind a `Transport` method. This is the property
that makes the interface worth having, and it is one careless line from being lost.

**V3. Close is emitted exactly once and latched.** A subscriber registering after close is
told immediately. `teardown` is the only path that closes either socket.

**V4. No session starts from an unauthenticated socket, and the caller number never comes
from client-supplied data.** It comes from the signature-validated webhook by way of the call
registry. Anything else is an identity claim, and `VoiceBridgeTurn::audienceAllows` treats
it as authentication.

**V5. The fast model never speaks a figure that did not come back from a delegated answer.**
Prices, availability, dates, balances, unit numbers, access codes. Enforced in the prompt
today; enforced mechanically from V02-00. This one is a restatement of the API's invariant 73
and must stay in sync with it rather than drift.

**V6. There is one source of truth for prompt, greeting, and filler, and it is
`unit-hq-api`.** A local copy is a defect even when it is faster. (Currently violated by
`prompt.ts` by explicit decision; V03-01 closes it. Record the violation here with its
closing task rather than pretending the rule holds.)

**V7. An ordering fix ships with a fixture that fails without it.** Every defect in this
sprint was a timing relationship, and a timing relationship that is not asserted is not
fixed.

Each invariant names the code that enforces it and the fixture that proves it. An invariant
with neither is a wish.

### Wire the docs together

- `README.md` gains a short "Working on this repo" section pointing at `AGENTS.md`.
- The out-of-scope list in `README.md` is stale the moment this sprint lands. Replace it with
  a pointer to `docs/roadmap/README.md` rather than maintaining two lists that will disagree.
- On the API side, add `keevaris-voice` to the workspace layout table in `00-overview.md` and
  a row to `AGENTS.md`'s routing table, since the two repos now sit side by side the way
  `unit-hq-api` and `unit-hq-panel` do.

### CI

`lint`, `typecheck`, `test`. Nothing else, matching the panel's deliberately short CI
surface. Red blocks merge.

## Acceptance criteria

- [ ] `AGENTS.md` exists, routes by task, and defers to the API's invariants for anything
      crossing the delegation boundary.
- [ ] `docs/conventions-and-invariants.md` exists with V1–V7; each names its enforcing code
      and its fixture.
- [ ] V6 is recorded as currently violated, naming V03-01 as the closing task.
- [ ] V5 cross-references the API's invariant 73 rather than restating it independently.
- [ ] `README.md`'s out-of-scope list is replaced by a roadmap pointer.
- [ ] `unit-hq-api/docs/00-overview.md` and `AGENTS.md` know this repo exists.
- [ ] CI runs `lint`, `typecheck`, `test` and blocks merge on red.

## Out of scope

- **Rewriting the API's invariants.** If something here contradicts `09`, the API wins and
  the conflict gets flagged.
- **Numbering these into the API's list.** Separate repo, separate namespace, `V`-prefixed,
  cross-referenced where they touch.
- **A contributing guide, PR template, or commit convention.** One maintainer.
