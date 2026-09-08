---
created: 2026-09-07
updated: 2026-09-07
---

# Existing tabs can branch

The first [branch identity fix](2026-09-07-branching-after-an-interrupted-reply.md)
made its new key mandatory. That broke the original `{ turn }` API used by
already-open tabs, including pages whose conversation matched the server
exactly. Deploying the service change therefore left those pages unable to
branch until their JavaScript was replaced.

The key is now optional for compatibility. A turn-only request retains the
original meaning and succeeds when the requested completed exchange exists.
Updated pages continue to supply the key, and any supplied key must match
the selected reply's history. An absent turn or mismatched key still fails;
the route never clamps an unavailable turn to another reply.

The regression test starts a chat, restores it from disk into a new HTTP
host, and sends the original `{ turn: 2 }` request. The branch inherits the
exact four messages. A request for a missing third turn remains refused.
