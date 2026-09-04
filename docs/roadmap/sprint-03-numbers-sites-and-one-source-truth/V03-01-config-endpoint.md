# V03-01 — Voice bridge config endpoint

**Depends on:** V03-00
**Blocks:** V03-02
**Touches:** `unit-hq-api`

## Problem

`keevaris-voice` has no way to ask `unit-hq-api` "what should I say, and to
whom should I transfer, for this token." Everything it currently says is
either hardcoded in `src/agent/prompt.ts` (a file whose own header comment
calls itself a local copy) or read from global env
(`COMPANY_NAME`, `TRANSFER_MAIN_LINE_NUMBER`, `TRANSFER_VOICEMAIL_NUMBER`).

I verified the duplication is exact: `keevaris-voice`'s `GREETING_EN`
constant is `'I am an automated assistant for {company}.'`, and
`config/ai-handoff.php`'s `voice_greeting.en` is the identical string,
character for character. The prompt-additions list in
`VoiceBridgeCustomerConfig::payload()` ("Never state a price, rate,
discount...") is near-verbatim the same list `buildSystemPrompt()` hand-writes
in `prompt.ts`.

`VoiceBridgeCustomerConfig` itself can't be reused directly — its `endpoint`
block is Vocal-Bridge-specific (A2A protocol, `message/send`), which
`keevaris-voice` deliberately doesn't speak. This task builds a sibling
endpoint serving the same underlying content in a shape `keevaris-voice`
actually needs.

## What to build

### `GET /api/voice/bridge/{token}/config`

New controller action, reusing `VoiceBridgeAuth::authenticate()` exactly as
`VoiceBridgeController` already does — same path token, same
`X-Voice-Bridge-Secret` header, same 401/404 behavior on failure. This means
the config endpoint is authenticated by, and scoped to, the same credential
that already gates delegation calls — no new auth concept.

Response shape:

```php
[
    'company_name' => $site->legalEntity?->trading_name
        ?? $site->legalEntity?->legal_name
        ?? config('app.name'),
    'locale' => SiteLocale::for($site),
    'greeting' => (string) config("ai-handoff.voice_greeting.{$locale}"),
    'filler' => (string) config('ai-handoff.voice_filler', 'Let me check that for you.'),
    'prompt_additions' => [ /* same content as VoiceBridgeCustomerConfig's
                                agent_prompt_additions, factored into a
                                shared source both classes call */ ],
    'transfer' => [
        'main_line_number' => $token->main_line_number,
        'voicemail_number' => $token->voicemail_number,
    ],
    'max_call_duration_minutes' => (int) config('ai-handoff.session.max_call_duration_minutes', 30),
]
```

`$site` is `$token->site` (already loaded via the existing relation).
`voice_filler` doesn't exist in `config/ai-handoff.php` yet — add it,
defaulting to the English string `keevaris-voice` currently hard-codes, so
the config has somewhere to live before it needs translating.

### Factor out the shared prompt-additions content

Both `VoiceBridgeCustomerConfig::payload()` and this new endpoint need the
same "never state a price..." instruction list. Extract it into a small
shared source — a `VoiceAgentPromptAdditions::lines(): array` static method,
or a `config('ai-handoff.voice_prompt_additions')` array — and have both
call sites read from it. This is the actual fix for the duplication this
sprint exists to close; skipping it would mean this endpoint becomes a
*third* copy of the same text instead of replacing the problem.

### Response resource / caching

A plain array return (or a lightweight `JsonResource`) is enough — this
endpoint is small, low-traffic (fetched once per call, not per turn), and
doesn't need the weight of `VoiceSessionResource`'s conventions. No
server-side caching in this task; `keevaris-voice` does its own per-call
caching in V03-02.

### Tests

`tests/Feature/Ai/VoiceBridgeConfigEndpointTest.php`:
- Valid token returns 200 with the shape above, values matching the token's
  site.
- Two tokens on sites with different `country_id` (one `ES`, one default)
  return different `locale`/`greeting` values — this is the test that
  actually proves per-site locale resolution works end to end.
- A site whose `LegalEntity` has no `trading_name` falls back to
  `legal_name`.
- Invalid token → 404. Wrong secret → 401. Same behavior as the existing
  `VoiceBridgeAuthTest` cases, applied to this endpoint.
- `transfer.main_line_number`/`voicemail_number` reflect whatever's on the
  token, including both null (V03-00's default state for existing/unbackfilled
  tokens).

## Acceptance criteria

- [ ] `GET /api/voice/bridge/{token}/config` returns the shape above,
      authenticated via the existing `VoiceBridgeAuth`.
- [ ] The prompt-additions text is read from one shared source by both this
      endpoint and `VoiceBridgeCustomerConfig::payload()` — not duplicated a
      third time.
- [ ] `config('ai-handoff.voice_filler')` exists with the current English
      default.
- [ ] Locale resolution is delegated to `SiteLocale::for()`, not
      reimplemented.
- [ ] Company name falls back `trading_name` → `legal_name` → `config('app.name')`.
- [ ] All test cases above pass; existing `VoiceBridgeAuthTest` and
      `VoiceBridgeEndpointTest` suites stay green with zero changes.

## Out of scope

- **Multi-language `prompt_additions`.** The instruction list stays English;
  only the greeting is genuinely multilingual today (`en`/`es`/`fr` in
  config). The system prompt in `keevaris-voice` already tells the model to
  answer in the caller's language regardless of what language its own
  instructions are written in — that's unaffected by this task.
- **Consuming this endpoint.** That's V03-02, entirely in `keevaris-voice`.
- **Any change to `VoiceBridgeCustomerConfig`'s own output shape or the
  `agents:export-voice-bridge-config` command.** Only its prompt-additions
  *source* moves to a shared location; its own payload shape for Vocal
  Bridge is unaffected.
