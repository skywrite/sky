---
created: 2026-09-09
updated: 2026-09-09
---

# Keychain access

Every provider shares `KeychainAccess`: pending reads, a bounded memory cache,
and a queue for reads and writes. Successful mutations invalidate cached values;
a revision file also invalidates other processes. Failed deletes preserve the
index. Secret values only cross anonymous pipes and never enter the state files.

OS calls belong in `keychainWorker.ts`, never in the server. The macOS adapter
uses Security.framework in that disposable Bun process. Its small FFI boundary
preserves OSStatus, disables interaction for background access to the legacy
login Keychain, and leaves existing item ACLs intact. A hung call or native
failure cannot block the server. The parent kills a timed-out helper and waits
for its pipes to close before starting another operation.
Background operations have thirty seconds: macOS can take about twenty seconds
to finish a successful cold read. A shorter deadline can prevent recovery even
when the item is readable without authentication.
An independent kernel alarm also terminates a blocked macOS helper if its parent
exits; it cannot keep a machine lock or an authentication dialog alive forever.

This boundary is necessary for both reads and writes. `cross-keychain` 1.1.0
initialization races can select its CLI fallback while the native module is
still loading. That fallback kills interactive requests after ten seconds.
The native backend instead blocks the caller's thread, and its underlying
binding converts all read failures into a missing value. Wrapping that API in
an async function or increasing its timeout does not supply these guarantees.
Other platforms retain cross-keychain in an isolated helper.

On macOS a kernel file lock serializes access across Sky processes and releases
on helper death. Failure state lives under the user-data state directory, keyed
by a hash of the service/account pair. Before calling the OS, the helper records
a failure reservation so a crash or timeout cannot create an immediate retry
loop in another process. Transient failures back off from approximately thirty
seconds to five minutes. Authentication failures wait for explicit recovery.

Only Settings → Connections → Restore access permits authentication dialogs.
Its requests join one pending recovery; each helper has a two-minute deadline.
Recovery reads and writes the unchanged value to authorize token refreshes too.
The sidebar polls after the previous request settles, keeps its last schedule
on a failed refresh, and exposes the error with a link to Connections.

Tests use fake transports and temporary state directories. Normal test runs
must never retrieve real credentials or generate authentication prompts.
