# Sprint 03 — Numbers, sites, and one source of truth

**Sprint 2 status:** merged, all five tasks. `pnpm test` is 60/60 green, lint
and typecheck clean. `docs/conventions-and-invariants.md` V5 now describes a
real, fixture-proven mechanism instead of a forward reference. One process
note: the V02-03 commit also deleted `.github/workflows/ci.yml`, confirmed
deliberate — CI is intentionally absent on `dev` right now and will be
rebuilt properly as part of V05, not restored ad hoc here.

**This sprint's origin:** `keevaris-voice` currently runs as exactly one
process holding exactly one `KEEVARIS_BRIDGE_TOKEN`, one `COMPANY_NAME`, one
pair of transfer numbers — all read once at boot from env
(`src/config.ts`). A storage operator with two sites, or one site with two
numbers, cannot be served by one deployment today. Worse: `prompt.ts`'s
header comment admits it's a hand-copied duplicate of
`unit-hq-api`'s `ai-handoff.voice_greeting.en`, and I verified the two files
word-for-word identical — `'I am an automated assistant for {company}.'`
appears in both, and `COMPANY_NAME` in env is a placeholder standing in for
whatever `Site`'s `LegalEntity` actually says the operator's registered name
is. That's `docs/conventions-and-invariants.md` V6, open since V01-05.

Tracing the API side changed the shape of this sprint from what the original
roadmap sketch assumed. Three things were already there, not missing:

- **Site scoping already exists at the token level.** `VoiceBridgeToken` has
  a `site_id` today (`app/Models/VoiceBridgeToken.php`). One token already
  means one site. What it doesn't have is a phone number — nothing connects
  an inbound `To` number to a specific token.
- **Locale resolution already exists.** `SiteLocale::for(Site)`
  (`app/Support/Communications/SiteLocale.php`) maps a site's country to
  `en`/`es`/`fr`, and `config('ai-handoff.voice_greeting.*')` already has
  greeting text in all three. The greeting-locale problem this sprint was
  scoped to solve is mostly already solved on the API side; it just isn't
  wired to this service.
- **`VoiceBridgeCustomerConfig::payload()` cannot be reused as-is.** It's the
  Vocal-Bridge-dashboard paste config — its `endpoint` block hardcodes the
  A2A protocol Vocal Bridge needed and `keevaris-voice` deliberately doesn't
  use (`KeevarisClient`'s own header comment: "there is no reason to use the
  A2A envelope that exists only to work around Vocal Bridge"). The new
  config endpoint this sprint builds is a sibling to that class, sharing its
  greeting/prompt source material, not a wrapper around it.

What's genuinely missing, confirmed by reading the actual schema and code:
a phone number on the token, a way to reach the operator's real registered
name (`Site->legalEntity->trading_name`, falling back to `legal_name`), and
per-site transfer destination numbers — `main_line`/`voicemail` are symbolic
names in `config/agents.php` on the API side; the actual dialable numbers are
this service's sole responsibility today, and only one pair exists.

## Findings → tasks

| # | Finding | Evidence | Task |
|---|---|---|---|
| 1 | `voice_bridge_tokens` has no phone number; nothing resolves an inbound `To` to a token. Transfer destination numbers exist only as a single global pair in this service's env, with no per-site concept anywhere | `VoiceBridgeToken` model, `src/config.ts` `TRANSFER_MAIN_LINE_NUMBER`/`TRANSFER_VOICEMAIL_NUMBER` | V03-00 |
| 2 | No endpoint serves this service its own config. `prompt.ts` is a hand copy (verified word-for-word against `config/ai-handoff.php`); `COMPANY_NAME` is a placeholder env var | `src/agent/prompt.ts`, `config/ai-handoff.php` `voice_greeting.en` | V03-01 |
| 3 | Even authenticating to `unit-hq-api` is a single global credential: `KeevarisClient`/`VoiceBridgeAuth` need a per-site `bridgeToken`/`bridgeSecret` pair, but `keevaris-voice` only holds one, read from env once at boot. `handleTwilioVoiceWebhook` never looks at `params.To` | `src/index.ts`, `src/delegation/KeevarisClient.ts` | V03-02 |
| 4 | Once the right credentials are resolved, nothing fetches or applies the config they unlock: `TransferPolicy`, `DeepgramVoiceAgent`'s greeting, and `prompt.ts` all still read the *global* `config` object or a hardcoded local copy | `src/transfer/TransferPolicy.ts`, `src/agent/prompt.ts` | V03-03 |
| 5 | Nothing in `unit-hq-panel` (unverified — outside this session's access) surfaces bridge tokens, phone numbers, or transfer destinations for an operator to manage | not directly inspected this sprint | V03-04 |

## Sequencing

```
V03-00 (schema) ── V03-01 (config endpoint) ── V03-02 (credential resolution) ── V03-03 (config fetch + apply)
                                                          │
V03-04 (panel surface) ───────────────────────────────────┘ (reads what V03-00 writes; not blocked on V03-02/03)
```

V03-00 must land first — V03-01's endpoint has nothing to serve without the
new columns. V03-02 and V03-03 are split because they're genuinely different
kinds of change: V03-02 is structural — it changes *when in the connection
lifecycle* a bridge token is known, which touches the webhook, the call
registry, and every place that currently assumes one global token. V03-03 is
additive — given a resolved token, fetch its config and use it instead of
env/prompt.ts. Building them as one task risks a half-working intermediate
state where credentials resolve per-number but content still doesn't.
V03-04 only needs the schema, not the endpoint or the voice-service changes,
so it can run in parallel with V03-01 through V03-03 once V03-00 is in.

## Departure from the original roadmap sketch

The roadmap's `README.md` originally split this into five tasks including a
standalone "locale and disclosure" task. Grounding this sprint in the real
API code folded that in: locale resolution is `SiteLocale::for()`, already
built, and the disclosure line is already the non-configurable
`agent.greeting` `keevaris-voice` has spoken since V01 (Deepgram-native, not
LLM-routed — S28-05's verbatim requirement was already satisfied
structurally). What was missing was never a *disclosure mechanism*, only
*site-scoped text* to feed it. That's V03-01's job, not a separate task.

## Definition of done

1. Two Twilio numbers pointing at two different sites answer with each
   site's own greeting, in that site's resolved locale, using that site's
   registered trading name, and transfer to that site's own numbers — with
   nothing site-specific left in `keevaris-voice`'s env.
2. `prompt.ts`'s header comment admitting it's a local copy is deleted
   because it's no longer true.
3. `docs/conventions-and-invariants.md` V6 is updated to record closure, the
   same way V5 was updated in V02-04 — not just deleted.
4. All Sprint 1 and Sprint 2 fixtures stay green. New fixtures cover
   multi-number resolution and per-call config fetch/cache behavior.
5. `pnpm lint`, `pnpm typecheck`, `pnpm test` clean in `keevaris-voice`; the
   equivalent PHPUnit suite clean in `unit-hq-api` for touched files.

## Not in this sprint

- **Bilingual sites / mid-call locale switching.** `SiteLocale::for()`
  returns one locale per site; a market needing two languages needs two
  numbers, per the existing comment in `VoiceBridgeCustomerConfig::payload()`
  — that's a product decision already made, not something this sprint
  revisits.
- **Recording, consent, retention.** V10.
- **Outbound calling.** V09.
- **Config hot-reload mid-call.** V03-02 caches the fetched config per call;
  a config change takes effect on the next call, not the current one.
