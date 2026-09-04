# V03-00 — Numbers and per-site transfer destinations, schema

**Depends on:** nothing — first task of the sprint
**Blocks:** V03-01, V03-03
**Touches:** `unit-hq-api`

## Problem

`VoiceBridgeToken` already scopes one token to one site (`site_id`,
`app/Models/VoiceBridgeToken.php`) — that part of "one number, one site" is
already structurally correct. What's missing:

1. **No phone number on the token.** Nothing connects an inbound Twilio `To`
   number to a specific `VoiceBridgeToken`/site. A deployment with two
   numbers has no way to tell them apart server-side.
2. **No per-site transfer destination numbers.** `config/agents.php`'s
   `approved_destinations` (`main_line`, `voicemail`) are symbolic names the
   backend returns in a delegation response. The actual dialable phone
   numbers behind those names live only in `keevaris-voice`'s
   `TRANSFER_MAIN_LINE_NUMBER`/`TRANSFER_VOICEMAIL_NUMBER` env vars — one
   pair, globally, regardless of site.

## What to build

### `phone_number` on `voice_bridge_tokens`

```php
Schema::table('voice_bridge_tokens', function (Blueprint $table): void {
    $table->string('phone_number')->nullable()->unique()->after('site_id');
});
```

Nullable because existing rows won't have one until backfilled manually;
unique because a number must resolve to exactly one token. E.164 format,
validated at the point it's set (admin action / seeder), not by the column
itself.

Update `VoiceBridgeToken`'s `$fillable` and docblock. Update
`VoiceBridgeTokenFactory` to generate a plausible E.164 number by default so
tests exercising number resolution don't need to set it manually every time.

### Per-site transfer destination numbers

Add two nullable columns to the same table, colocated with `phone_number`
since they're the same "this token's site, dialable" category of data:

```php
$table->string('main_line_number')->nullable()->after('phone_number');
$table->string('voicemail_number')->nullable()->after('main_line_number');
```

Considered and rejected: a new `voice_transfer_destinations` table keyed by
site. Rejected because `approved_destinations` is a fixed two-value enum
(`main_line`, `voicemail`) with no sign of growing, and a token already scopes
to exactly one site — a third table would be normalization for its own sake
where two columns say the same thing plainly. Revisit only if a third
destination type is ever added.

### Model and factory updates

`VoiceBridgeToken`: add all three fields to `$fillable`, add
`@property string|null $phone_number`, `@property string|null
$main_line_number`, `@property string|null $voicemail_number` to the
docblock. No new casts needed — plain nullable strings.

`VoiceBridgeTokenFactory`: default `phone_number` to a Faker-generated E.164
US number (`'+1' . fake()->numerify('##########')`); leave
`main_line_number`/`voicemail_number` null by default so tests opt in
explicitly where they matter, keeping the factory's default row minimal.

## Acceptance criteria

- [ ] Migration adds `phone_number` (nullable, unique), `main_line_number`,
      `voicemail_number` (both nullable) to `voice_bridge_tokens`.
- [ ] `VoiceBridgeToken::$fillable` and its docblock include all three.
- [ ] `VoiceBridgeTokenFactory` generates a default `phone_number`.
- [ ] A test asserts two tokens cannot share the same `phone_number`
      (unique constraint violation).
- [ ] Existing `VoiceBridgeAuth`, `VoiceBridgeAuthTest`, and any test
      constructing a `VoiceBridgeToken` without these fields continue to pass
      unmodified — this is purely additive.

## Out of scope

- **Backfilling `phone_number` for existing tokens.** Manual, operational,
  happens outside this migration.
- **An admin UI for setting these fields.** V03-03.
- **A third transfer destination type.** Not asked for; two nullable columns
  is the right amount of structure for two known destinations.
- **Validating E.164 format at the database layer.** Application-level
  validation belongs wherever the token is created/edited (V03-03's job),
  not the migration.
