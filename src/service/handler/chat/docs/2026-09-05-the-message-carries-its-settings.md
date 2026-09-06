---
created: 2026-09-05
updated: 2026-09-05
---

# The message carries its settings

The composer held its selected model, reading budget, and save preference
in browser state. A separate settings request put those choices into the
service's memory. Sending a message sent only its text.

After a service restart, the browser could still display a small model
and a small budget while the service constructed or restored the thread
with its defaults. The reply used a different model than the composer
showed. A discarded chat could likewise become a saving chat.

Every message now carries all three choices, captured once when Send is
pressed and reused on connection retries. The server validates them
before constructing a session, reserves the thread against competing
requests, and applies them before context gathering and model invocation.
New threads receive the choices in their constructor; restored threads
have theirs replaced before starting. Turning saving off also removes an
existing crash snapshot before the model runs.

Merely refreshing the picker after a restart would reveal the changed
defaults without honoring the person's selection. Optional fields would
still let an old browser tab silently use defaults. Missing choices are
therefore an error asking the person to reload. Unknown profiles and
budgets that no longer fit the selected model are errors too. The settings
endpoint still fits a budget when changing models in the composer, where
the person sees that change before sending.

Route tests cover new, live, and restored threads, missing and invalid
choices, removal of snapshots, and competing requests during construction.
The composer waits for settings to load or finish updating before it sends.
