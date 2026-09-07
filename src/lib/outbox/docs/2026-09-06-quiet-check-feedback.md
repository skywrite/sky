---
created: 2026-09-06
updated: 2026-09-06
---

# A quiet check still needs a result

Check now successfully ran the automation, but the browser discarded its response and only refreshed the item list. When an example pass assessed three conversations and none needed a reply, the list remained empty. A changed timestamp and a brief button spinner did not explain whether anything had happened. Failure messages could also appear above the current scroll position.

The control now retains and displays the command's result where the check was requested, announces a checking state during the request, and explains quiet passes as well as new drafts. A shared summary turns persisted counts into the same explanation after a reload, including whether more saved conversations remain to check. The request is guarded against duplicate clicks while it is in flight. Losing the connection is reported as an unconfirmed check rather than claiming that the background work stopped.
