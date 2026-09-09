---
created: 2026-09-08
updated: 2026-09-08
---

# Checks survive service restarts

The original manual check returned HTTP 202 while its scan continued as a promise
inside the service. Source changes requested an automatic reload, but that promise
had no activity hold. The service could exit mid-check, losing the execution and
leaving progress marked as interrupted.

Manual checks now use the shared detached process job. The worker owns the scan
and its automation completion stamp; a new service instance reads the same worker
and progress files. The browser retains the last progress during a connection
failure and retries until it can reconnect. It does not need to submit another
check. The [process-job contract](../../jobs/docs/README.md) owns the details of
deduplication, worker liveness, startup recovery, and persisted results.

Detaching the execution still leaves a short interval in the HTTP process: saving
the selected range and registering the worker. The scan route takes an
`outbox check startup` activity hold before reading the request and releases it in
`finally`. Automatic reloads wait through that handoff, including a failed startup.
After registration, the service can reload while the worker continues. The
existing explicit restart override is unchanged.

Regression coverage kills the launching process group and reconnects from another
process, exercises death during worker registration, and verifies a pending
automatic reload stays deferred until the HTTP handoff succeeds or fails. The
browser regression uses synthetic conversations to check progress across page
reloads, server host recreation, connection loss, and reconnection.
