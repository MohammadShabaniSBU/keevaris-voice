# keevaris-voice — Delivery Roadmap

> **Audience:** the solo maintainer + Cursor.
> **Horizon:** ten one-week sprints, launch gated after V05.
> **Read first:** `docs/conventions-and-invariants.md` in this repo (seeded by V01-05), and
> `unit-hq-api/docs/09-conventions-and-invariants.md` for anything crossing the delegation
> boundary. If a task appears to require breaking one, stop and flag it — do not silently
> comply.

---

## 1. Where we are

`keevaris-voice` replaces the Vocal Bridge vendor integration. It holds the media socket
itself — Twilio `CallSid`/`From`, or a minted id for a browser mic — so session identity and
caller number survive every turn of a call, which is the thing Vocal Bridge could not
reliably give us. Deepgram's Voice Agent API sits in the middle for STT, the fast think
model, and TTS. Every fact-bearing question is delegated to `unit-hq-api`'s
`POST /api/voice/bridge/{bridgeToken}`, where `AgentRuntime` and the outbound guards run.

The first sketch (`82dd161`) has the right seams. `Transport`, `AgentProvider` and
`KeevarisClient` are the three correct boundaries, and `VoiceSession` is 163 lines that
know nothing about Twilio or Deepgram. That is the part not to disturb.

What is missing is everything the service does not yet **own**. The point of leaving Vocal
Bridge was to own four things: session identity, verbatim speech, the transcript, and the
real end-to-end timing. Only the first is done.

Four gaps define this roadmap:

- **The call path is not safe to expose.** Both WebSocket endpoints accept any connection,
  and `customParameters.From` is trusted and flows into `VoiceCallerIdentity::resolve()`,
  which drives the `KnownContacts` / `ExistingTenants` audience gate. That is an
  authentication bypass, not a hardening item.
- **Verbatim is still best-effort.** `FunctionCallResponse` hands our guarded text back to
  the think model, which then generates the spoken reply. Every number can move. S28's
  launch gate was built around this risk under the assumption we could not fix it. We can
  now.
- **The call record does not exist.** `voice_sessions.ended_at` is never written, no row is
  created for a call that never delegates, and the transcript goes to pino and dies. None of
  it is backfillable.
- **A call is not in the product.** An AI-answered call writes into its own silo, invisible
  to the Inbox's three-pane view and to the contact timeline, and it does not thread with
  the Aircall call history for the same tenant.

---

## 2. Sprints

| # | Sprint | Ships | Touches |
|---|---|---|---|
| V01 | `call-path-correctness` | A call path that is safe to point a number at | voice |
| V02 | `verbatim-and-delegation` | Guaranteed verbatim speech; better delegated questions | voice, api (docs) |
| V03 | `numbers-sites-and-config` | Many numbers, many sites, one source of truth | voice, **api schema**, panel |
| V04 | `the-call-record` | Sessions, transcripts, real timings | voice, **api schema** |
| V05 | `deploy-and-operate` | The service runs somewhere and can be watched | voice, infra |
| — | **launch gate** | first live call | |
| V06 | `inbox-and-timeline` | A call is a thread and a timeline entry | api, panel |
| V07 | `transfer-voicemail-after-hours` | Nobody is dropped into a ringing line | voice, api |
| V08 | `panel-web-voice` | Vocal Bridge and LiveKit leave the codebase | voice, panel, api |
| V09 | `outbound-calling` | Voice becomes an automation action | voice, api, panel |
| V10 | `recording-consent-retention` | Compliance closed out | all |

### Cross-repo tasks

V03, V04, V06 and V09 specify migrations and endpoints in `unit-hq-api`. Following the
precedent set by S28, the sprint folder lives here and each task's **Touches** header names
the API files it changes. The sprint is not done until both repos are.

---

### V01 — Call-path correctness

Six ordering and lifecycle defects, and the harness that proves they are fixed. Opens with
the harness rather than a fix: every bug in this sprint is invisible to a manual test call,
and a scripted-call replay is also what lets `AgentProvider` be swapped later without fear.

`V01-00` harness · `V01-01` connection auth and the caller-number trust boundary ·
`V01-02` socket lifecycle · `V01-03` audio buffering across the handshake ·
`V01-04` turn ordering · `V01-05` repo conventions

**Exit:** an unauthenticated socket is refused; a call held silent for three minutes stays
up; a hangup mid-handshake leaks nothing; the caller's first word during the greeting is
transcribed; the full transfer sentence plays before the line moves.

### V02 — Verbatim and delegation quality

The reason for owning the pipeline. `InjectAgentMessage` speaks text without a think-model
pass, so the delegated answer reaches the caller exactly as `GroundingGuard` validated it,
and `FunctionCallResponse` carries only a short context stub. Invariant 73 stops being
aspirational.

Also: send the caller's verbatim utterance from `ConversationText` alongside `query`, since
`query` today is the think model's paraphrase of a question our guards then ground an answer
to. Mint our own `turn_id` rather than reusing Deepgram's function-call id, because that id
is the idempotency key on `voice_session_turns` and should not depend on a vendor's id
generation. Give delegation failure a policy that respects office hours instead of always
transferring to `main_line`.

`V02-00` verbatim speech path · `V02-01` utterance passthrough · `V02-02` turn identity and
idempotency · `V02-03` delegation failure policy · `V02-04` invariants and docs

**Exit:** a spoken answer is byte-identical to the `agent_conversation_messages` row for the
same turn, verified by listening and by transcript diff.

### V03 — Numbers, sites, and one source of truth

`prompt.ts` carries a comment admitting it is a copy of the API's config, and `COMPANY_NAME`
lives in env in direct contradiction of the S28 launch-gate rule that the operator's
registered name is never baked in. Both go away behind
`GET /api/voice/bridge/{token}/config`, which serves greeting per site locale, prompt,
filler phrases, transfer destinations, and the duration cap.

On the API side: `phone_number` on `voice_bridge_tokens` or a `voice_numbers` table, and
per-site transfer destinations as data. `TRANSFER_MAIN_LINE_NUMBER` in process env is wrong
for an operator with four sites. Number resolution moves into the `/twilio/voice` webhook by
`To`.

The non-configurable disclosure line per locale ships here, which is the half of S28-05 that
gates launch.

`V03-00` voice numbers schema · `V03-01` config endpoint · `V03-02` number resolution ·
`V03-03` locale and disclosure · `V03-04` panel settings surface

**Exit:** two numbers on two sites answer with their own greeting, in their own locale, and
transfer to their own destinations, with nothing site-specific in env.

### V04 — The call record

Not needed for a call to work, and before launch anyway: none of it is backfillable, and the
first month is the month worth looking at.

Session open and end endpoints so `ended_at` and `end_reason` are written and a row exists
for calls that never delegate. A `voice_transcript_segments` table for the full transcript,
written from `ConversationText`. Deliberately **not** `agent_conversation_messages`: the
guarantee that everything in that table passed the outbound guards is worth more than
one-table convenience. Merge them in the UI instead.

Service-side turn timing, because `voice_session_turns.latency_ms` measures our runtime's own
turn and the caller experiences endpointing plus think-model decision plus HTTP round trip
plus time to first audio. S28-04 makes measured p95 an acceptance criterion and only this
service can produce the number.

`V04-00` session lifecycle API · `V04-01` transcript store · `V04-02` turn telemetry ·
`V04-03` observability and the p95 report

**Exit:** every call, including hangups and immediate transfers, has a complete session row,
a full transcript, and end-to-end timings.

### V05 — Deploy and operate

Dockerfile and compose alongside the API's Traefik setup, WebSocket routing, readiness split
from liveness (a `/health` that returns ok while Deepgram is unreachable is a lie), graceful
drain that finally uses `server_shutdown`, and the call registry moved behind a Redis
implementation so the single-instance assumption is a deployment choice rather than a
structural one. Runbook, alerts on call-drop rate, cost per call.

`V05-00` container and compose · `V05-01` Traefik and WebSockets · `V05-02` shared state and
scale posture · `V05-03` health and graceful shutdown · `V05-04` runbook

**Exit:** the service is deployed, watched, and can be restarted mid-day without dropping a
live call.

---

## Launch gate — first live call

Not a task. A checklist, re-checked before the first live call. Most of S28's launch gate was
settings in someone else's dashboard; the point of this repo is that they are now code and
config we own, so the list is shorter and enforceable.

| Item | Where it lives now | Was |
|---|---|---|
| Verbatim response | `V02-00`, enforced in code | Vocal Bridge dropdown, best-effort |
| External TTS | not applicable — we hold the TTS socket | dashboard toggle |
| Per-query timeout above the 8s turn budget | `KEEVARIS_BRIDGE_TIMEOUT_MS` | dashboard field |
| Late response behaviour: store, never speak | structural — we discard after timeout | dashboard field |
| Filler audio | `V01-04`, one per request, locale-aware in `V03-03` | dashboard toggle |
| Max characters per turn: 600 | `ChannelProfile::Voice`, unchanged | dashboard field |
| Transfer destinations restricted to approved | `V03-00`, per site, in the DB | dashboard config |
| Disclosure line spoken first, non-configurable | `V03-03` | dashboard greeting |
| Endpoint auth | `V01-01` plus the existing bridge secret | custom header only |
| Recording decision, written down | `V10`, decided before launch | — |
| One number, one site | `V03-02` enforces it | a rule nobody could enforce |

**Before the first live call:** place a real call and diff the spoken audio against
`agent_conversation_messages` for the same turn. Under V02 this should be an exact match
rather than a judgement call, and if it is not, `V02-00` is not done.

---

## Post-launch

### V06 — Inbox and timeline

The 360 seam, and the one that matters most for the product rather than the service. Per
`06-communications.md` every communication writes one `messages` row and one `Interaction`,
and `message_threads` already keys call threads by `(contact, number)`. Today an AI-answered
call does none of that, so it is invisible to the Inbox and does not thread with the Aircall
history for the same tenant. Unknown callers go to `comms_triage` rather than silently
creating a Contact.

### V07 — Transfer, voicemail, after-hours

Cold transfer to the main line works. What is missing: an explicit `callerId`, a `<Dial>`
timeout with an action fallback so a caller does not reach a line nobody answers, voicemail
capture with transcription into triage, and a policy for when the backend is unreachable
outside office hours. `KeevarisClient.fallback()` currently hardcodes `main_line` and ignores
the outside-hours-to-voicemail rule the backend owns.

### V08 — Panel web voice

Retires the last Vocal Bridge dependency. The panel copilot still goes through the LiveKit
token flow in `CopilotVoiceController`; it moves onto `/web/media` with a server-minted
token, and `copilot_voice_sessions` reconciles with `voice_sessions`.

### V09 — Outbound calling

An outbound leg via the Twilio REST API, exposed as an automation-engine node and a Playbook
step so debt process and lead chase can place calls. Consent and `channel_suppressions` are
checked before dialling, and the call outcome lands back on the enrolment.

### V10 — Recording, consent, retention

Code last, decision first: whether calls are recorded at all has to be settled before launch
because the greeting must match the answer. The recommendation from S28-05 stands — do not
record in milestone one. Retention, the processor position, and whether `voice_sessions` and
any audio are reachable by `contacts:redact` (AR-03) are the work here.

---

## Not on this roadmap

- **Tier 2**, realtime speech-to-speech with tools called directly. It deletes every outbound
  guard. Revisit only against the V04 p95 measurement.
- **Voice OTP.** Caller ID stays at `channel_asserted`; account questions are transfers.
- **Multi-site numbers.** One number, one site, enforced in V03. A number serving several
  sites must establish which site before quoting, and that logic does not exist.
- **Replacing Deepgram.** `AgentProvider` exists so this is possible; nothing on this roadmap
  assumes it will happen.
