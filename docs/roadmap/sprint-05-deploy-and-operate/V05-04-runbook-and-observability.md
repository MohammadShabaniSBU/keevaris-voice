# V05-04 — Runbook and observability

**Depends on:** V05-00, V05-01, V05-02, V05-03
**Blocks:** nothing — last task of the sprint, and of the pre-launch cut
**Touches:** `keevaris-voice` (docs only)

## Problem

No runbook exists. Nobody but whoever built this service knows how to
deploy it, roll it back, read `agents:report-voice-latency-p95`'s output,
or respond when something goes wrong at 2am. This task documents what
V05-00 through V05-03 actually built — not what was planned, what
shipped — the same discipline V01-05 and V02-04 applied to code.

## What to build

### `docs/runbook.md`

Sections, each grounded in a real command or real behavior from this
sprint, not generic advice:

- **Deploy.** The actual `docker compose` commands, which subdomain to
  check afterward, how to confirm the new revision is actually serving
  (checking `/health/ready`, not just that the container started).
  Include V05-01's operational checks — they are not encoded as a repo
  diff and must not be silently skipped:
  - Entrypoint read/write/idle timeouts on the entrypoint serving
    `voice.test2.keevaris.local` exceed `MAX_CALL_SECONDS` (1800s),
    comfortably. Confirm against Traefik's static/dynamic config, do
    not assume defaults.
  - No request-body-size or short-timeout middleware chain written for
    `unit-hq-api`'s JSON routes applies to the `keevaris-voice` router.
  - TLS covers `voice.test2.keevaris.local` the same way
    `test2.keevaris.local` / `ws.test2.keevaris.local` are covered
    (wildcard, or add a SAN/entry).
  - A real `wss://` connection through Traefik completes the upgrade
    (not `curl`).
  - Deployed `.env` has
    `PUBLIC_BASE_URL=https://voice.test2.keevaris.local`, never
    `localhost`.
- **Roll back.** How to revert to the previous image/tag given whatever
  deployment mechanism V05-00/01 actually used.
- **Reading the p95 command.** `agents:report-voice-latency-p95 --since=...`
  — what a healthy number looks like (there's no baseline yet; the first
  entry in this section should be "TBD, establish a baseline in the first
  week of real traffic" rather than a fabricated target), what a rising
  trend probably means (Deepgram-side latency, `unit-hq-api` load, or a
  network path issue — and how to tell which).
- **Call-drop rate.** What signal to actually watch (the fraction of
  `voice_sessions` rows with `end_reason: 'error'` or missing `ended_at`
  entirely, over a rolling window — a query against real V04 schema, not
  an abstract metric) and a rough sense of what rate would be alarming
  versus normal background noise (again: TBD-first-week honesty, not
  invented numbers).
- **Redis unavailable.** What actually happens (V05-02's fail-closed
  design: new connections rejected, existing calls unaffected), how to
  tell it's happening (the specific log line V05-02's error path emits),
  and how to recover.
- **A caller reports a bad experience.** How to actually find that call's
  record — `bridge_session_id`/`CallSid` → `voice_sessions` row → its
  transcript (V04-01) and turns, in that order, with the real query or
  panel path to get there.

### Alerting — scoped honestly

No alerting infrastructure exists in either repo, confirmed by search
during Sprint 4's planning and unchanged since. This task does not build
one. It documents, in the runbook, the three or four signals worth
alerting on once *some* alerting mechanism exists (call-drop rate, p95
latency trend, Redis connection failures, `/health/ready` flapping) so
whoever eventually wires up alerting (Sprint 4's original sketch deferred
this to "V05's observability work," and it's still deferred one more step
— to whoever actually stands up the alerting tool) has a concrete starting
list instead of a blank page.

### Cost-per-call — a query, not a dashboard

Matches V04-02's own precedent (a console command instead of new
dashboard infrastructure). A rough cost-per-call figure is derivable from
existing data: Deepgram's own usage-based billing (external, not in this
schema) divided by call count over the same period (`voice_sessions` count
in a date range, already queryable). Document the query and the caveat
that it's an average, not a per-call figure, since Deepgram doesn't
attribute cost per session in what this service currently captures. Don't
build new instrumentation to get a more precise number unless the rough
average turns out to be insufficient for a real decision.

## Acceptance criteria

- [ ] `docs/runbook.md` exists, and every command/query in it has been run
      for real against this sprint's actual deployment, not copy-pasted
      from a template.
- [ ] The "healthy p95" and "alarming call-drop rate" sections honestly
      say "no baseline yet" rather than inventing numbers, with a note to
      revisit after the first week of real traffic.
- [ ] The Redis-unavailable section names the actual log line to watch
      for, taken from V05-02's real error-handling code.
- [ ] The "find a caller's bad experience" section traces a real path
      through real schema (V04-00/01), not a hypothetical one.

## Out of scope

- **Building alerting infrastructure.** Documenting what to alert on, for
  whenever that infrastructure exists.
- **A precise per-call cost attribution system.** The rough average is
  the target for this sprint; anything more precise is a future,
  deliberately-scoped task if the rough number proves insufficient.
- **On-call rotation or paging policy.** Organizational, not technical —
  outside this task's scope entirely.
