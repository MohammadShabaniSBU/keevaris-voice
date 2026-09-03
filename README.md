# keevaris-voice

A media bridge that sits between a call (Twilio phone, or a browser mic) and
Deepgram's Voice Agent API, and delegates every fact-bearing question to the
existing `unit-hq-api` Vocal Bridge endpoint
(`POST /api/voice/bridge/{bridgeToken}`).

It owns the two things the previous Vocal Bridge vendor integration could not
reliably give us: the call/session identifier and the caller's phone number.
Because this service holds the socket itself (Twilio `CallSid`/`From`, or a
minted id for web), those are never lost across turns of the same call.

See [`app/Support/Ai/VoiceBridgeTurn.php`](../unit-hq-api/app/Support/Ai/VoiceBridgeTurn.php)
and [`app/Support/Ai/VoiceBridgeWireFormat.php`](../unit-hq-api/app/Support/Ai/VoiceBridgeWireFormat.php)
in `unit-hq-api` for the backend side of this contract. This service always
speaks the flat HTTP contract (`{query, turn_id, session_id, caller_number}`),
never the A2A one — `VoiceBridgeWireFormat::parse()` auto-detects it from the
absence of a `jsonrpc` key.

## Working on this repo

Read [`AGENTS.md`](AGENTS.md) first. It routes a task to the doc that governs it.
The rules this repo actually needs live in
[`docs/conventions-and-invariants.md`](docs/conventions-and-invariants.md).
Anything crossing the delegation boundary is governed by
`unit-hq-api/docs/09-conventions-and-invariants.md` — this repo does not
reinterpret it.

## Architecture

```
Twilio call ──┐                                    ┌── unit-hq-api
              ├─ Transport ──┐          ┌─ delegate ┤   /api/voice/bridge/{token}
Web mic ──────┘              │          │           └── (AgentRuntime, guardrails,
                              ▼          │               VoiceSession persistence)
                     VoiceSession orchestrator
                              │          ▲
                              ▼          │
                    Deepgram Voice Agent API
                    (STT + fast LLM + TTS, client-side
                     `ask_keevaris` function call)
```

- `src/transport/` — `Transport` interface plus vendor implementations
  (`twilio/`, `web/`). Adding a new call vendor means implementing this one
  interface.
- `src/agent/` — `AgentProvider` interface plus the Deepgram implementation.
  Swapping the fast-conversation vendor means implementing this interface.
- `src/delegation/` — the HTTP client that calls into `unit-hq-api`.
- `src/session/VoiceSession.ts` — the orchestrator that wires the above three
  together for the lifetime of one call.
- `src/transfer/TransferPolicy.ts` — maps the backend's `destination`
  (`main_line` | `voicemail`) onto a transport action.

## Running locally

```bash
cp .env.example .env
# fill in DEEPGRAM_API_KEY, KEEVARIS_BRIDGE_TOKEN, KEEVARIS_BRIDGE_SECRET
pnpm install
pnpm dev
```

- Web transport: open `public/dev.html` in a browser (served at `/dev.html`)
  and grant mic access. This is the fastest way to test end to end without a
  phone number.
- Twilio transport: tunnel this process (e.g. `ngrok http 8787`), set
  `PUBLIC_BASE_URL` to the tunnel's `https://` URL, and point a Twilio number's
  "A call comes in" webhook at `{PUBLIC_BASE_URL}/twilio/voice`.

## What is not in this repo yet

The first-sketch out-of-scope list is gone — it was stale the moment sprint 01
landed. What ships next, what is deliberately later, and what is not on the
roadmap at all live in [`docs/README.md`](docs/README.md).
