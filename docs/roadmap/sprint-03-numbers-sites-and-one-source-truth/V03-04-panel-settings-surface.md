# V03-04 — Panel settings surface for voice numbers

**Depends on:** V03-00
**Blocks:** nothing
**Touches:** `unit-hq-panel` (not inspected this sprint — see note below)

## Honesty check before scoping

Every other task in this sprint was written against code actually read in
this session. `unit-hq-panel` was not — this session has no access to that
repository. What follows is scoped from what V03-00 produces and what a
reasonable settings surface for it looks like, not from panel conventions,
existing component patterns, or routing structure actually observed. Whoever
picks this up should read the panel's existing settings pages (site
settings, communication account settings are the likely siblings) before
writing anything, and should expect this task's shape to change once that's
done. Treat everything below as a starting brief, not a locked spec.

## Problem

V03-00 adds `phone_number`, `main_line_number`, `voicemail_number` to
`voice_bridge_tokens`. Nothing currently lets an operator see or set these
short of a database console. `VoiceBridgeToken` rows are presumably created
today the way most credential-bearing rows in this system are — a factory in
tests, and manually or via a console command in production, per
`ExportVoiceBridgeConfigCommand`'s existence as the closest analog. That's
fine for a single-number bootstrap; it doesn't scale to an operator adding a
second site's number.

## What to build (starting shape, expect revision)

A settings page, likely under whatever section already houses per-site
configuration (site details, communication accounts), listing this site's
`VoiceBridgeToken` rows with:

- Phone number (editable, validated E.164 client-side, uniqueness enforced
  server-side by V03-00's migration).
- Main line / voicemail transfer numbers (editable).
- The bridge secret itself: **never displayed** after creation, matching
  `VoiceBridgeToken`'s existing `$hidden = ['secret', 'secret_previous']` —
  the panel should offer "regenerate secret" as an action, not a way to view
  the current one. This mirrors how API keys are conventionally handled
  everywhere else in this kind of product; confirm the panel already has a
  pattern for this (a payment provider account's API key field is a likely
  precedent) and follow it rather than inventing a new one.
- Revoke action, setting `revoked_at` — `VoiceBridgeToken::isRevoked()`
  already exists to support this.

Read-only display of what a token's `config` endpoint (V03-01) currently
resolves to — greeting text, locale — so an operator can confirm what a
caller will actually hear without placing a test call. This is a nice-to-have
if it fits naturally into whatever V03-01's response looks like by the time
this is built; don't force it if the panel's data-fetching conventions make
it awkward.

## Acceptance criteria

- [ ] An operator can view, create, edit, and revoke `VoiceBridgeToken` rows
      for a site they administer, without database access.
- [ ] The bridge secret is never rendered after creation; only a
      regenerate action is exposed.
- [ ] Phone number uniqueness violations (V03-00's constraint) surface as a
      clear validation error, not a raw 500.
- [ ] Whatever authorization gate already governs site settings in the panel
      is applied here too — this task does not introduce a new permission
      model.

## Out of scope

- **Anything about how a call actually behaves.** This is a settings CRUD
  surface, not a test-call tool.
- **Multi-site bulk management.** One site's numbers at a time, matching
  however the panel already scopes site settings.
- **Designing this task's real shape.** As stated above, this needs
  panel-repo research before it's buildable as written.
