---
created: 2026-09-08
updated: 2026-09-08
---

# Detached process jobs

Long operations belong to a worker whose lifetime is independent of the HTTP service. `createProcessJob` provides one active worker per local state directory; callers choose that directory to identify the operation and notebook. A task module exports a default async function with JSON-safe input and output. Environment overrides go directly to process creation and are never copied into the registry.

The launcher persists a run and current-run pointer before spawning a detached process group with ignored standard streams and no IPC or parent-owned abort signal. It records the child PID before acknowledging the request. The worker takes the same short transaction lock before claiming the reservation and importing the task module. If the launcher dies during handoff, the worker can claim the reservation; if a new client has already replaced it, the obsolete worker exits without running task code. This fence prevents a retry from creating a second producer.

`status()` reads durable state and `wait(id)` follows a specific run, so clients can reconnect after service restarts. Task modules persist their own domain progress when needed. Completion and import/task errors are atomically written before the worker exits. A dead worker becomes a failed run on the next read, permitting an explicit retry; its work is never automatically replayed. Old run results remain available after subsequent starts. This survives service restarts, not machine reboots or worker termination.

The lock directory must stay outside synchronized notebook data: PID ownership applies only on this machine. Lock owners appear atomically as symlinks. Released live locks are removed, but dead owners remain immutable and select a common successor lock. Removing a stale lock after checking its owner would allow two reapers to delete a new owner's lock. Successor markers remember confirmed deaths even after PID reuse. These small crash remnants must only be removed when no clients or workers are using the directory.
