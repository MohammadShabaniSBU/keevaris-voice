# V03-03 — Fetch and apply per-call config

**Depends on:** V03-02
**Blocks:** nothing in this sprint
**Touches:** `keevaris-voice`

## Problem

Once V03-02 lands, this service knows *which* site a call belongs to. It
still says the same hardcoded English things regardless: `GREETING_EN` and
`FILLER_EN` in `src/agent/prompt.ts`, `buildSystemPrompt()`'s hand-written
instruction list, and `config.companyName`/`config.transfer.*` all stay
global and static. This task closes `docs/conventions-and-invariants.md` V6
— open since V01-05, and the whole reason `prompt.ts`'s header comment
exists.

## What to build

### A config client

New `src/config/BridgeConfigClient.ts`, sibling to `KeevarisClient`, same
shape: takes `bridgeCredentials`, calls
`GET /api/voice/bridge/{bridgeToken}/config` with the
`X-Voice-Bridge-Secret` header (V03-01's endpoint), returns the parsed
response. Define `BridgeConfig` in `src/config/types.ts` matching V03-01's
response shape exactly:

```ts
export interface BridgeConfig {
  companyName: string
  locale: string
  greeting: string
  filler: string
  promptAdditions: Array<string>
  transfer: { mainLineNumber: string | null; voicemailNumber: string | null }
  maxCallDurationMinutes: number
}
```

On failure (timeout, non-2xx, malformed body) — same posture as
`KeevarisClient.fallback()`: log `bridge_config.fetch_failed` and fall back
to today's English defaults (`GREETING_EN`, `FILLER_EN`, the existing
hardcoded prompt lines, `env.COMPANY_NAME`, the existing global transfer
numbers). This is why `COMPANY_NAME` and the two transfer-number env vars
from `config.ts` **stay** as fallback defaults in this task, even though
V03-02 already removed the credential env vars — losing the ability to say
anything at all if `unit-hq-api` is briefly unreachable is worse than saying
something in English.

### Fetch once per call, not per turn

`handleTransportConnection` in `src/index.ts` fetches the `BridgeConfig`
right after constructing `transport`, before constructing
`DeepgramVoiceAgent`/`VoiceSession` — both need it (greeting, prompt) at
construction time. One fetch per call; nothing in this task re-fetches
mid-call. A config change on the API side takes effect on the *next* call,
not the current one — stated explicitly in the sprint README's non-goals,
restated here since it's this task's direct consequence.

### Wire it through

- `DeepgramVoiceAgent`'s constructor currently takes `companyName: string`
  and calls `buildGreeting(companyName)` internally. Change it to take the
  resolved `greeting: string` directly — the agent shouldn't know how a
  greeting is built, only what to say. Same for `filler`.
- `buildSystemPrompt()` takes `promptAdditions: Array<string>` and appends
  them, rather than hand-writing the "never state a price..." list inline.
  The structural instructions (opening-disclosure handling, "answer in the
  caller's language") stay in `buildSystemPrompt()` itself — those aren't
  content, they're how this service's prompt is put together, and don't
  belong in the API-served config.
- `TransferPolicy.numberFor()` takes the resolved
  `transfer.mainLineNumber`/`voicemailNumber` instead of reading
  `config.transfer.*` — threaded through `VoiceSessionDeps` alongside
  `agent`/`keevaris`/`transport`, the same way `companyName` already is.

### Delete the local copy

`GREETING_EN`, `FILLER_EN`, and the hardcoded instruction array in
`buildSystemPrompt()` are removed from `prompt.ts` once every call site
above is fed from `BridgeConfig` instead. `prompt.ts`'s header comment
("Local copy of the prompt shape... Follow-up, not part of this sketch:
serve this from an API endpoint") is deleted because it's no longer true —
don't leave a stale comment describing a problem that's fixed.

### Update `docs/conventions-and-invariants.md`

V6 gets the same treatment V5 got in V02-04 — not deleted, updated to record
what actually shipped:

> **V6. There is one source of truth for prompt, greeting, and filler, and
> it is `unit-hq-api`.** ... **Closed in V03-03.** `BridgeConfigClient`
> fetches `GET /api/voice/bridge/{token}/config` once per call;
> `prompt.ts`'s `GREETING_EN`/`FILLER_EN` and the hand-written prompt-additions
> list are gone. Enforced by: `BridgeConfigClient`, `handleTransportConnection`
> (`src/index.ts`). Fixture: [name the new fixture(s) below].

`AGENTS.md`'s routing table row pointing at V6 gets updated the same way
V02-04 updated the V5 row.

### Fixtures

`FakeTransport`/the fixture runner need a `BridgeConfigClient` stub —
`tests/support/BridgeConfigClientStub.ts`, same shape as
`KeevarisClientStub`: configurable canned response, configurable failure
mode. New fixture schema field `bridgeConfig` (optional, defaults to today's
English strings so every Sprint 1/2 fixture keeps working unmodified).

New fixtures:
- `bridge-config-drives-greeting-and-prompt.json` — a non-default
  `bridgeConfig` (different greeting text, different `promptAdditions`)
  asserts the spoken greeting and the constructed system prompt reflect it,
  not the old hardcoded English.
- `bridge-config-fetch-failure-falls-back.json` — the config stub configured
  to fail; asserts the call still proceeds using the English defaults and
  `bridge_config.fetch_failed` is logged.

## Acceptance criteria

- [ ] `BridgeConfigClient` fetches once per call; failure logs and falls
      back to hardcoded English, never drops the call.
- [ ] `DeepgramVoiceAgent` and `buildSystemPrompt()` take resolved content as
      parameters; neither reads `GREETING_EN`/`FILLER_EN`/a hardcoded
      instruction list internally.
- [ ] `TransferPolicy` uses the resolved per-call transfer numbers, not
      `config.transfer.*`, when a `BridgeConfig` was successfully fetched.
- [ ] `prompt.ts`'s local-copy header comment and the constants it described
      are deleted.
- [ ] `docs/conventions-and-invariants.md` V6 and `AGENTS.md`'s routing table
      are updated to record closure, citing real fixture names.
- [ ] Both new fixtures pass; all Sprint 1/2 fixtures stay green using the
      default English `bridgeConfig`.

## Out of scope

- **Re-fetching mid-call.** Explicitly deferred — stated above and in the
  sprint README.
- **Caching across calls** (e.g. a short-TTL in-memory cache keyed by
  `bridgeToken` to avoid a fetch on every single call). Worth doing later if
  call volume makes the extra HTTP round-trip per call matter; not proven
  necessary yet.
- **Multi-language `promptAdditions`.** Matches V03-01's own scope boundary
  — the instruction list stays English regardless of site locale.
