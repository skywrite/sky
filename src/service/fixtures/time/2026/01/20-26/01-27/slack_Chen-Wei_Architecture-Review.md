---
from: Chen Wei
when: 09:30
medium: Slack
summary: Architecture Review Questions
created: 2026-01-27
rel:
  - Acme Corp
tags: Work/Engineering
---

# Message

Chen Wei asked about the architecture review for the new API gateway design. Needs input on rate limiting strategy before the team meeting tomorrow.

Key points:
- Token bucket vs leaky bucket
- Per-user vs per-org limits
- Redis vs in-memory counters
