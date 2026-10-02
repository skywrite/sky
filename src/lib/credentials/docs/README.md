---
created: 2026-09-27
updated: 2026-10-02
---

# Credential providers

This library sits alongside `lib/secrets`. Existing commands, integration setup,
token refreshes and browser runners continue using their existing interfaces.
The [Browser automation settings page](../../../service/handler/settings/docs/README.md)
uses account discovery and explicit vault inspection only. It has no item
inventory, credential reads, OTP responses, or generic provider writes.
Importing this module does not connect an account, read a credential, prompt for
authorization, or write configuration. The
[private browser worker](../../browser/docs/README.md#credential-backed-tasks)
uses the 1Password adapter only after independent native approval; Settings
cannot invoke that sign-in flow.

## Items, fields and references

`CredentialService` routes an `ItemRef` to exactly one configured connection.
The connection identifies one provider account; container and item IDs retain
the provider's identity. Titles and categories are display metadata, not lookup
keys. A missing, locked or excluded source never falls through to another source.
API keys are secret fields, optionally grouped with a key ID. Native categories
remain intact. Field IDs include their section when the provider has sections.

Search returns metadata and an explicit issue for every provider/vault it could
not read. A successful empty result and incomplete discovery are different.
Website filtering honors exact, subdomain and never-fill rules, requires the
same scheme and port, and rejects lookalike domain suffixes. Search is discovery,
not permission to fill credentials into an arbitrary page.

Inspect returns field descriptions, never values, notes, computed OTPs or opaque
native payloads. Explicit field reads and OTP requests return `SensitiveValue`:
JSON, string conversion and log inspection show `[redacted]`; `use` releases the
value at its consumption boundary. This is accidental-disclosure protection,
not a sandbox: a caller that receives plaintext must keep it out of logs, model
context and persistent state. Native provider errors are sanitized for the same
reason. Provider capabilities describe implemented operations, not current vault
permissions; the provider still enforces its grants on every request.

`CredentialBindings` saves only purpose-to-field references to a host-supplied
local path, using atomic writes and a process lock. Strict validation rejects
unexpected value fields and malformed state is never silently replaced. Unlink
removes a binding; deleting a provider item is a separate explicit operation.

## 1Password

Connect discovers accounts from the local desktop app using the official CLI's
`account list`; the SDK requires an account identifier and cannot discover one.
`onePasswordDesktop.ts` reuses an installed, signed CLI or downloads a pinned
vendor archive into Sky's private helper directory on the explicit Connect action.
It checks the archive hash and Apple's vendor signature before running it.
CLI discovery reads account metadata only, with other authentication modes removed
from the child environment. An empty environment value does not disable those modes.
Both **Integrate with 1Password CLI** and **Integrate with 1Password SDKs** must be
enabled in the desktop app's developer settings. MCP is not required.

`connectOnePassword` then authenticates the SDK through the desktop app, which
owns approval and verification. Discovered UUIDs identify new connections;
existing named connections keep their saved references. Multiple accounts connect
sequentially so native prompts do not compete. Successful accounts survive a later
declined approval, and retry continues with the remaining accounts. All
accessible vaults participate by default; optional exclusions also apply to
direct reads, writes and OTP requests. New vaults appear on the next search.
Creation requires a destination vault ID. There is no implicit fallback vault.
Source management can list all vault names separately from included containers
and update exclusions on an existing session; it does not read excluded items.

The adapter lists SDK overviews, and obtains a full item only for inspection or
use. It exposes native category names and maps ordinary/concealed fields plus
TOTP setup fields on creation. Other native types can be inspected and their
existing values updated except fields marked unsupported by the SDK.

Every desktop SDK exchange, including client creation, goes through the shared
`onePasswordRequest` queue across all accounts. With SDK 0.5.0 and desktop app
8.12.36, concurrent account listings reproducibly returned `IPC operation failed: -4`;
the same listings succeeded before and after when serialized. A lock per account
or a sequential loop in one HTTP request is insufficient: other tabs, refreshes
and field operations can overlap. Queue individual SDK calls, not adapter methods
that call each other, to avoid reentrant deadlocks. Rejected requests release the
queue. Never automatically retry writes whose outcome may be unknown.

Library listings preserve items from successful vaults and report partial
availability. Settings never performs an item listing; it reads saved setup
metadata and contacts the provider only for an explicit Connect or Refresh.

Field edits use the complete native SDK item and its version, preserving
unrelated fields, sections, files and SDK-managed data such as passkeys. Never
replace this with a CLI JSON-template round trip: those templates can remove a
passkey. Updates are serialized within the adapter, check the caller's revision,
and pass the native version back to the SDK. Deletes check the revision before
calling the SDK, but the SDK has no atomic conditional-delete operation.
The SDK's native timestamp objects remain inside this adapter; they are not
exposed through the application model.

`readLogin` revalidates a Login item's exact HTTPS origin and obtains the built-in
username and password from the same native revision. It is consumed only by the
private browser worker after approval; never expose this through a Settings route.
When the item has exactly one TOTP field, `readLogin` also returns a field/revision
binding without its code or seed. `readLoginOtp` revalidates that binding and the
exact origin on a fresh native item read. The browser owns the short-lived,
single-use [verification continuation](../../browser/docs/README.md#verification-continuation).

The adapter obtains TOTP codes from the SDK's computed OTP field details. That
API supplies no expiry, so the result leaves it unspecified. An expired desktop
authorization reports `access-required`; reconnecting is an explicit host action.

References: [SDK setup](https://www.1password.dev/sdks),
[CLI desktop integration](https://www.1password.dev/cli/app-integration),
[item operations](https://www.1password.dev/sdks/manage-items),
[SDK passkey-preserving edits](https://releases.1password.com/developers/sdks/).

## Keychain compatibility

`connectKeychain` wraps `KeychainSecretsProvider`, keeping its worker isolation,
cache, mutation behavior and explicit recovery UI. It covers **Sky's indexed
Keychain entries**, not the user's entire Apple Passwords/iCloud vault.
The original `category/name` pair becomes `containerId/itemId` unchanged.
Existing login entries expose `username` and `password`; single secrets expose
`value`. Updates preserve their wire format, notes and creation timestamp.

New flexible items use the reserved `credentials` category (`sky-credentials` in
the OS Keychain), with a versioned `sky.credentials` document inside the existing
secret wrapper. Existing consumers' categories and values are never migrated.
The document stores title, native category, websites and typed fields together
inside Keychain. The old index cannot supply this metadata, so listing these
new records reads their encrypted documents through the existing background
access path. Legacy categories can be listed without reading secret bodies.

New local IDs use UTC creation time and a case-preserving title slug:
`YYYY-MM-DD_HHMMSS_Title`. Allocation checks case-insensitive collisions under a
shared process lock and adds numeric suffixes. Every adapter over the same store
must use the same lock directory; `connectKeychain` supplies the common path.
Field edits/delete compare opaque, connection-local content revisions under that
lock. Reinspect after reconnecting. A randomly keyed digest keeps low-entropy
passwords out of public revision hashes. Comparison ignores timestamps because
the legacy provider gives raw strings a fresh timestamp wrapper on each read.
Persisted update timestamps remain monotonic. Legacy callers do not share
this higher-level lock, so the wrapper cannot promise transactional editing
against independent legacy writers; the underlying Keychain cache/index behavior
remains owned by `lib/secrets`.

Keychain OTP generation requires an explicit `otpauth://totp` field value. It
supports SHA1/256/512, six/eight digits and custom periods, with expiry calculated
from an nbdt instant. Tests use the public [RFC 6238 vectors](https://www.rfc-editor.org/rfc/rfc6238).
This does not read authenticator entries from Apple Passwords.

## Use from a host

```typescript
import { CredentialService, connectKeychain, connectOnePassword } from '#lib/credentials/mod.ts'

const credentials = new CredentialService([
  await connectKeychain(),
  await connectOnePassword({ id: 'personal', account: '<1password-account-id>' }),
])

const { items, issues } = await credentials.search({ website: 'https://example.com' })
// Surface issues and select the intended item; duplicate titles are allowed.
const item = await credentials.inspect(items[0].ref)
const values = await credentials.readFields(item.ref, [{ id: 'password' }])
// Consume values[0].value.use(...) inside the integration that needs the password.
```

Constructors accept fake stores/SDK clients so tests never unlock a vault or read
real credentials. The public factories are the only connection entry points.

## Passkeys and browser sign-in

`PasskeyAuthenticator` is a separate registration/authentication contract, using
WebAuthn JSON types and a host-supplied origin/session binding. It can report
completion, required user interaction, cancellation or lack of support.
Neither storage adapter implements it or claims that a passkey's presence means
Sky can authenticate with it. Production passkeys use the browser’s actual
WebAuthn and macOS AutoFill flow, including Apple Passwords and 1Password; they do
not pass through a storage adapter. Apple password filling, native browser setup,
SSO, and the saved-code continuation are owned by the
[private browser](../../browser/docs/README.md#apple-passwords-passkeys-and-sso).
