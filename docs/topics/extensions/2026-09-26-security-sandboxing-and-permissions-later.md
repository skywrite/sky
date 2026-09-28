---
created: 2026-09-26
updated: 2026-09-26
---

# Extensions: security, sandboxing, networking and permissions, later

## Where this stands

Extensions v1 is ruled: an extension runs inside Sky, can do whatever it
wants, and nobody but its author uses it. The format evolves once other
people use these things. This doc records what was considered and set
aside, with the facts that were measured, so nothing has to be worked out
twice on the day it matters.

The trigger for building any of it is one of two events: the first
extension written by someone else, or the first time an extension is
handed to someone else. Until then, nothing here is built.

## What an extension can reach today

The honest map. In v1 an extension has Sky's own access:

- The service process. A hang or crash inside it is a hang or crash of Sky.
- Every file the user can write, the notebook included.
- The keychain. Its process is the same Bun binary Sky runs, so the OS
  trusts it exactly as it trusts Sky. It can read every entry Sky stores.
- The environment. Today the service's environment carries the model keys
  from `src/.env`, and a worker that inherits it carries them too.
- The network, anywhere.
- The browser page. Client code compiles into Sky's bundle, so it sees the
  page, the local API, and everything the page holds.
- Install scripts of its dependencies. Bun runs lifecycle scripts only
  for packages on its default trusted list or the project's
  `trustedDependencies`, which blunts this one already.

Nothing above is a bug. It is the DOS era: every program owns the machine,
and protection arrives when there are other people's programs.

## Two tiers, when they come

- **App.** The default. Runs outside the service process under an OS
  sandbox generated from its manifest. Its UI is either blocks Sky draws
  from data or frames it serves itself. Cannot reach the keychain, only
  the folders it declared, only the network it declared.
- **Kernel.** Declares `trust: full`. Loads in-process, exactly v1. The
  person switches it on behind a warning, the way macOS asks before
  allowing a system extension.

Both tiers keep boot isolation: a throw during registration marks the
extension failed on its row instead of keeping the service down. That one
guard is worth having in v1 already.

## Enforcement that is known to work

Measured 2026-09-26 on macOS 27.0 with `/usr/bin/sandbox-exec`, Apple's
per-process sandbox. Apple has marked the tool deprecated for years. It is
still present, and Sky is macOS-only.

| Profile rule | Result |
|---|---|
| Deny `file-write*` outside named subpaths | A write elsewhere fails, "Operation not permitted" |
| Deny `network*` | The host cannot even be resolved |
| Deny `mach-lookup` for `com.apple.securityd` and `com.apple.SecurityServer` | A keychain search cannot be created at all |
| Bun inside the profile | Runs normally, fetch present |

Children inherit the profile, so an extension cannot shell out around it.

What the sandbox cannot express: a per-host network list. It filters by
port, not by name. Per-host means a small local proxy in front of the
worker, with the worker allowed to reach only that proxy. Until a proxy
exists, network is on or off.

The runtime is no help here. Bun has no permission flags. Deno has them.
Node's are file-system only. While Sky runs on Bun, the OS is the route.

If the deprecated tool ever disappears, the same rules move to Apple's
current sandbox API. The rules are the asset, not the tool.

The process itself already exists in Sky: automations run their pass in a
detached worker through `createProcessJob`, with durable state and a
restart that a service restart cannot lose. An app-tier extension is one
such worker, spawned under its profile, one per extension, warm.

## Secrets and the keychain

- The worker never touches the keychain. The host reads the extension's
  own category before spawning and hands the entries in.
- Inside a command, the secrets object is a scoped view: get and set
  within the extension's category, no list, no other category.
- The worker starts with a clean environment. No model keys, nothing
  inherited from the service.
- The `.env` model keys move into the keychain. This is the open rung from
  2026-08-30 and it matters more once anything else runs on the machine.
- An audit line per secret read, with the extension's handle, in Sky's log.
- Rotation and removal stay on Settings › Connections, where every key
  already lives.

What this stops: accidents, and quiet reach. An extension that wants
another category has to ask the host and there is nowhere else to get it.
What it does not stop on its own: hostile code in a kernel extension. That
one runs as the user and could read the keychain the way any script on
the Mac could. Only the sandbox rule above stops it, and only for the app
tier.

## Network

- Declared hosts in the manifest are informational until the proxy exists.
  Shown at switch-on, logged when exceeded, not blocked.
- On or off is enforceable now through the sandbox.
- One egress log per extension: host, method, count, bytes. Cheap, and it
  is what answers "what did this thing send".
- The proxy, when it comes, also gives per-extension rate limits and a
  place to refuse plain HTTP.

## The notebook and other files

- Writes go through the public helpers, which carry the day write lock and
  the file conventions, and every write is logged under the extension's
  handle.
- Folders come from location types. An extension declares which it writes,
  and the sandbox turns that into subpaths: its own state folder plus
  those notebook folders, nothing else.
- Code never lives in the notebook. A synced notebook must not be able to
  install or run anything. Extensions live under Sky's data directory.
- Frontmatter keys an extension writes are prefixed with its handle, so
  two extensions never fight over a field and a removed extension's marks
  are findable.

## The browser side

Kernel client code is Sky's client code. It sees the page. Two shapes for
the app tier, both used by VS Code:

- **Blocks.** The extension returns data, a card, a table, a form, and Sky
  draws it. Consistent look for free, no code in the page, covers most
  cards and pages.
- **Frames.** The extension serves its own HTML and Sky embeds it in an
  iframe with the sandbox attribute, proxied under Sky's origin with a
  token the extension server requires. Freedom, at the cost of feeling
  foreign unless Sky serves a design kit: its CSS variables, fonts, theme,
  and a message vocabulary for resize, navigate and toast.

Trap to remember: a same-origin iframe without the sandbox attribute can
reach the parent page. An opaque-origin iframe cannot call Sky's API
directly, which is the point. It talks to its own server.

## The permissions block

When the first outside extension arrives, the `sky` block in package.json
grows a `permissions` object:

```jsonc
"sky": {
  "manifest": 2,
  "trust": "app",
  "permissions": {
    "notebook": { "write": ["people", "orgs", "meetings"] },
    "secrets": "own",
    "network": ["api.hubapi.com"],
    "browser": "blocks"
  }
}
```

- Least privilege by default. A missing key means none.
- The Extensions page turns it into one sentence at switch-on: "HubSpot
  writes people, orgs and meetings, uses its own key, and talks to
  api.hubapi.com."
- The sandbox profile is generated from it at spawn. Declaration and
  enforcement arrive in the same change, never one without the other.
- An update that asks for more re-asks the person before it runs.
- `trust: full` shows the kernel warning instead of the sentence.

## Supply chain and updates

- Each extension has its own lockfile and its own install. No shared tree,
  no conflict picking.
- Bun's script blocking stays on. An extension that needs a package with
  an install script names it in `trustedDependencies`, which is visible.
- A downloaded folder is checked against the hash the registry index
  carries before anything runs.
- Review is a pull request into the registry monorepo. Merging is the
  trust decision. This is how Homebrew and Obsidian make "do anything"
  survivable and it costs no code.
- Updates notify and wait for a press. An update is code execution.
- Signing extensions comes only with a second registry or a marketplace.

## Open questions

- Whether the app tier's default UI is blocks or frames. Blocks are safer
  and consistent; frames are what an author with a real page wants.
- Whether one warm worker per extension is fast enough for a card render,
  or whether cards need a cached answer. Measure, then decide.
- How the audit lines surface. A page per extension, or the existing log.
- Whether the kernel tier should exist at all once the app tier covers
  every extension that exists. Decide when there is a candidate.
