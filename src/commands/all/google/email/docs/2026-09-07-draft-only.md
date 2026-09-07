---
created: 2026-09-07
updated: 2026-09-07
---

# Gmail stays draft-only

The voice Sent-mail lookup reads messages the user already sent. It adds no
send capability. Voice mail writes remain draft creation and draft updates.

A separate workstream delivery implementation had added a Google client method
that could bypass the ordinary Gmail send-endpoint guard after an authorization
callback. The user's current restriction is broader than a tool allowlist:
Gmail must only create drafts for outgoing messages, regardless of a saved send
grant or an approval callback.

The send bypass and its production caller are removed. The real report transport
rejects Gmail sends before account access or authorization. Workstream email
grants are effectively review-only, new email send grants are refused, and
email reports remain in Outbox review. The email reporting UI does not offer
automatic or manual sending. Native Gmail draft creation and update keep their
existing behavior; saving a draft does not record a delivery receipt.

Historical sent records and read-only reconciliation remain valid evidence.
An older grant cannot authorize a new send. Slack delivery retains its existing
separate behavior. The generic transport tests use Slack for actual-send
scenarios, and specific Gmail regressions enforce the draft-only boundary.

Verification: 257 focused unit and integration tests passed, covering Gmail
draft creation, read-only voice mail search, delivery policy, transport refusal,
and legacy grant recovery. The synthetic browser workflow confirmed that email
settings stay in review mode, preparing a report creates an Outbox review, no
email send controls appear, and opening the review reaches Outbox. The full
`bun run dev:check` gate passed. Tests used synthetic providers and sent no real
messages.
