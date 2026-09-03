# V02-03 — Make delegation failure observable and distinct

**Depends on:** V01 (merged)
**Blocks:** nothing in this sprint
**Touches:** `keevaris-voice`

## Problem, corrected from the original task doc

The sprint README this task was scoped from originally asked for "delegation
failure policy that respects office hours instead of always transferring to
`main_line`." Tracing the real code changes that:

`KeevarisClient.ask()` already handles every failure mode gracefully. HTTP
error, malformed response body, network failure, and timeout (via
`AbortController` on `config.keevaris.timeoutMs`) all funnel through a single
`catch`/`if` structure into `fallback()`, which returns
`{ text: FALLBACK_HANDOFF_TEXT, transfer: true, destination: 'main_line' }`.
Nothing in `handleFunctionCalls` needs a new catch block — there's nowhere
for an exception to escape from.

Office-hours logic already exists, on the other side of the hop:
`VoiceBridgeTurn::outsideHoursInbox()` and `OutsideHoursPolicy` decide what
happens when a call arrives outside a site's hours, using `SiteClock`.
Rebuilding that here — this service would need to know every site's hours, which
it currently has zero concept of — would be a second source of truth for a
decision `unit-hq-api` already owns, the same category of mistake
`docs/conventions-and-invariants.md` V6 flags for the prompt.

**The actual gap:** the fallback response is indistinguishable from a
legitimate one. If `unit-hq-api`'s `VoiceBridgeTurn::handle()` decides to
transfer a call — a real, backend-directed handoff — the shape returned is
`{ text, transfer: true, destination }`. If this service's own HTTP client
gives up because the API is unreachable, the shape returned is
`{ text: FALLBACK_HANDOFF_TEXT, transfer: true, destination: 'main_line' }`.
Both look identical to `handleFunctionCalls`, to the transfer machinery, and
to anyone reading a log line downstream. There's no way to tell "the backend
routed this call to the front desk" apart from "our client couldn't reach the
backend at all" — and that distinction matters: a spike in the second case
means this service's network or the API itself is unhealthy, which is an
alert-worthy fact the current code has no way to surface.

## What to build

### Tag the fallback distinctly

`DelegationResponse` gains an optional discriminator:

```ts
export interface DelegationResponse {
  text: string
  transfer: boolean
  destination?: string
  /** Set only by KeevarisClient.fallback() — never present in a real
   *  backend response. Distinguishes "our client gave up" from a
   *  legitimate backend-directed transfer. */
  clientFallback?: true
}
```

`fallback()` sets it; every real return path from `ask()` (the `response.ok`
success path) omits it. Callers of `DelegationClient.ask()` — the test stub
included — must never set this field on a non-fallback response, since its
entire value is being reliably absent otherwise.

### Log it distinctly

`fallback()` currently logs nothing itself — the three call sites
(`http_error`, `malformed_response`, `request_failed`) each log before
calling it, which is fine and stays. Add one more log line inside `fallback()`
itself: `delegation.fallback_engaged`, with `sessionId`/`turnId` if available
from the caller context (thread them through if not already reachable at that
point). This is the one log line an alert can be built on regardless of which
of the three failure paths triggered it.

### Surface it in `VoiceSession`

`handleFunctionCalls` already logs `session.delegation_result` with
`transfer`/`destination`. Add `clientFallback: result.clientFallback === true`
to that same log line, so a single log line tells you both "this call is
being transferred" and "was that this service's decision or the backend's."

### Do not change behaviour

The caller still hears the same fallback text, still gets transferred to
`main_line` the same way, still goes through the same `SpeechKind`/transfer
machinery. This task is entirely about making an existing, already-correct
behaviour *legible* — nothing about what the caller experiences changes.

## Acceptance criteria

- [ ] `DelegationResponse.clientFallback` exists, is set only by
      `KeevarisClient.fallback()`, and is never present on a genuine backend
      response.
- [ ] `fallback()` logs `delegation.fallback_engaged` exactly once per
      invocation, regardless of which of the three failure branches called
      it.
- [ ] `session.delegation_result` includes `clientFallback` on every log line.
- [ ] A fixture using the delegation stub configured to reject (or return a
      malformed body) asserts the resulting `session.delegation_result` log
      carries `clientFallback: true`; the existing happy-path fixture asserts
      it's absent or `false`.
- [ ] No change to what the caller hears or which destination is dialled —
      confirmed by every existing transfer-related fixture from Sprint 1
      staying green with zero changes to its `expect`/`forbid` assertions.

## Out of scope

- **Office-hours-aware fallback routing.** That decision belongs to
  `unit-hq-api`'s `OutsideHoursPolicy`/`SiteClock`. If this service ever needs
  to route the fallback differently by time of day, that's an argument for
  serving fallback routing from the same config endpoint V03-01 builds for
  the prompt and greeting — not for this service computing office hours
  itself.
- **Alerting infrastructure.** `delegation.fallback_engaged` is the log line
  an alert would be built on; building the alert is V05's observability work.
- **Retrying before falling back.** `KeevarisClient.ask()` makes one attempt
  per call today. Whether a retry-with-backoff belongs here is a separate,
  deliberate decision — not a side effect of making the existing fallback
  observable.
