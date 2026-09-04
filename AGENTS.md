# AI Assistant Instructions (Cursor / Claude)

You are working on **keevaris-voice**, the media bridge for Keevaris voice: Twilio / web transports in, Deepgram Voice Agent in the middle, facts delegated to `unit-hq-api`'s Vocal Bridge endpoint.

This repo sits beside `unit-hq-api` and `unit-hq-panel`. It does not get to reinterpret the API's rules.

Before writing code, consult the doc that matches the task:

| Working on… | Read |
|---|---|
| Anything (first time) | `README.md`, then `docs/conventions-and-invariants.md` |
| Transport / vendor / audio format | `docs/conventions-and-invariants.md` (V1, V2) |
| Socket / session lifecycle / close / timers | `docs/conventions-and-invariants.md` (V3) |
| Connection auth / caller identity | `docs/conventions-and-invariants.md` (V4) and `unit-hq-api/docs/09-conventions-and-invariants.md` (invariants 72, 59) |
| What the fast model is allowed to say | `docs/conventions-and-invariants.md` (V5, incl. `happy-path-single-delegation.json` / `two-delegated-answers-one-request.json` fixtures) and `unit-hq-api/docs/09-conventions-and-invariants.md` (invariant 55) |
| Prompt / greeting / filler | `docs/conventions-and-invariants.md` (V6, incl. `bridge-config-drives-greeting-and-prompt.json` / `bridge-config-fetch-failure-falls-back.json` fixtures) |
| Ordering or lifecycle defect | `docs/conventions-and-invariants.md` (V7) |
| Delegation contract, outbound guards, `AgentRuntime` | `unit-hq-api/docs/09-conventions-and-invariants.md` — this repo does not reinterpret it |
| Delivery sequence / later sprints | `docs/README.md` |

## Non-negotiables (summary — full list in `docs/conventions-and-invariants.md`)

- Audio is never resampled. `Transport` declares the format; that format drives `Settings.audio`.
- `VoiceSession` never branches on the vendor. Vendor-specific behaviour belongs behind a `Transport` method.
- Close is emitted exactly once and latched. Late subscribers are told immediately. `teardown` is the only path that closes either socket.
- No session starts from an unauthenticated socket. The caller number comes from the signature-validated webhook via the call registry, never from a client-supplied frame.
- The fast model never speaks a figure that did not come back from a delegated answer. This is the API's invariant 55 applied on this side of the hop.
- There is one source of truth for prompt, greeting, and filler, and it is `unit-hq-api`. A local copy is a defect. Closed in V03-03: `BridgeConfigClient` fetches once per call; `prompt.ts` no longer holds greeting, filler, or the prompt-additions list.
- An ordering fix ships with a fixture that fails without it.

Anything touching the delegation contract, the guards, or the agent runtime is governed by `unit-hq-api/docs/09-conventions-and-invariants.md`. If a request conflicts with that file or with `docs/conventions-and-invariants.md`, flag the conflict instead of silently complying.

## Commands

```bash
pnpm install
pnpm dev          # tsx watch, http://localhost:8787
pnpm run lint
pnpm run typecheck
pnpm test
```

CI is `lint`, `typecheck`, `test`. Red blocks merge. TypeScript arrays are `Array<T>`, never `T[]`.
