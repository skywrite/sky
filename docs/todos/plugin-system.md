---
created: 2026-09-09
updated: 2026-09-09
---

# A plugin system for complete domains

Status: proposed. This describes work to build, not an API Sky already supports.
Names and package layouts below are illustrative.

A plugin should be able to add a complete domain to Sky: commands, tools,
sub-agents, AI providers, UI, document types, Markdown prompts and templates,
connections to services, configuration, and automation. A financial modeling
package is the first example. It should support creating a model, editing assumptions,
importing actuals, calculating scenarios, explaining changes, and exporting
results without ongoing edits to Sky's core.

Sky owns the notebook infrastructure, application shell, command execution,
AI access, connection storage, and job lifecycle. The plugin owns its domain
logic and contributes through explicit, versioned interfaces. This boundary
prevents each domain from growing its own execution, settings, and storage
systems or depending on private application files.

## Existing foundations and gaps

| Area | What exists | What the plugin system needs |
| --- | --- | --- |
| Commands | [External command discovery](../../src/commands/all/cli/_commandsManifest.ts) through configured directories and a cached manifest | Plugin identity, namespaces, dependency resolution, and consistent discovery across consumers |
| Execution | [CommandService](../../src/commands/lib/core/CommandService.ts) and [AI tool discovery](../../src/commands/lib/chat/notebookTools.ts) | Explicit tool and sub-agent contributions, shared operation contracts, and host-managed delegation |
| AI providers | [Roles, profiles, and provider resolution](../../src/_shared-ts/ai/docs/README.md) | An extensible provider registry, connection-aware model discovery, and installation from AI settings |
| Public packages | [Commands](../../packages/commands/src/index.ts) and [core utilities](../../packages/core/package.json) | Independently resolvable, versioned exports; current packages re-export files from the Sky checkout |
| Web app | [Feature hosts and Hono routes](../../src/service/handler/http.ts), [React shell](../../src/service/handler/theme/client/main.tsx), and [Bun asset build](../../src/service/handler/theme/mod.ts) | Registered pages, navigation, settings, document integrations, and namespaced routes |
| Prompts | [Catalog, overrides, preview, and template expansion](../../src/_shared-ts/prompts/docs/README.md) | Namespaced plugin roots; external prompt paths currently bypass the catalog |
| Configuration | [Settings and connections](../../src/service/handler/settings/docs/README.md) | Plugin settings contributions, declared connection requirements, and capability readiness |
| Background work | [Detached process jobs](../../src/lib/jobs/docs/README.md) | Plugin ownership, version-aware lifecycle, and scoped job identities |
| Documents | Existing stores, watcher, Explorer, and [search](../../src/service/handler/search/docs/README.md) | Generic registration of plugin document locations and types |

## Package and manifest

A plugin is a versioned package with a static manifest and optional backend and
browser entrypoints. Start with trusted local packages. A package could contain:

```text
sky-finance/
  sky.plugin.json
  commands/
    model/new.ts
    model/recalculate.ts
    model/compare.ts
    model/export.ts
  domain/                 # Calculation engine, scenarios, validation
  tools/                  # Typed operations available to agents
  agents/                 # Specialist definitions and Markdown instructions
  ui/                     # Model editor, comparisons, configuration
  prompts/                # Assumption review and explanations
  templates/              # New model and report documents
  connections/            # Provider adapters owned by this plugin
```

The manifest declares:

- Stable plugin ID, package version, manifest format version, and supported Sky
  API version range.
- Required and optional plugin dependencies with compatible version ranges.
- Contribution roots and entrypoints for commands, tools, sub-agents, pages,
  document views, actions, settings, prompts, templates, connections, AI
  providers, and background work.
- Public capabilities exported for other plugins, including contract versions.
- Configuration schemas and connection requirements, including which
  capabilities depend on them.
- Intended notebook, connection, network, and action access.

Read manifests without executing backend or browser code. Command parameter
definitions remain their source of truth; generate discoverable metadata from
them during an explicit build or trusted linking step. The current command
scanner imports modules to inspect them, so it is not a safe metadata reader for
unknown packages.

Keep plugin code outside notebook content. Merely syncing a Markdown document
or a directory into the notebook must not install or execute a plugin.

## One registry and one operation implementation

Add a plugin registry that owns the effective set of installed and enabled
contributions. CLI lookup, AI tools, automation catalogs, HTTP handlers, and the
web client consume that same resolved set. Plugin commands use names such as
`finance:model:recalculate`; reject duplicate identities rather than silently
shadowing another plugin or a core command. Preserve existing personal-command
override behavior separately from plugin registration. Namespace routes, prompts,
settings, and other contribution IDs too; reject conflicting ownership.

Implement each domain operation once behind a shared execution contract. A
button, a CLI invocation, an AI tool call, and an automation reach the same
operation through that contract. Reuse the existing command runner for
command-backed operations; tools can also contribute operations without a CLI
command. Adapters format results for their caller; they do not independently
implement model creation or calculation.

Each operation declares validated inputs, structured results, and its supported
surfaces: CLI, UI, AI, or external API. Installation does not automatically expose
every operation to AI or remote callers. The host carries caller identity,
authorization, cancellation, progress, and errors through execution. Existing
AI approval metadata is a foundation, but approval in chat does not substitute
for authorization at other entrypoints.

## Tools and sub-agents

Plugins can extend what Sky's agents can do and which specialists they can
delegate to. Tools and sub-agents are named contributions with public contracts,
not instructions that merely mention functions the host cannot execute.

### Tools

A tool declares a namespaced ID, purpose and selection guidance, input and result
schemas, execution handler or existing operation reference, required connections,
and its effects and authorization requirements. For example,
`finance:model:recalculate` can expose the same operation as the CLI command,
while `finance:assumptions:inspect` might be an agent-only utility.

Generate command-backed tool schemas from the command contract rather than
maintaining parallel definitions. Standalone tools use the same host validation,
authorization, cancellation, progress, and structured-error behavior. Wrappers
for provider APIs or external tool servers must also pass through this contract;
their transport does not establish permission to use them.

Keep a discoverable catalog of tool descriptions and availability. Offer relevant
tools to the current task and enforce the selected agent's allowed tool set at
execution time. Installing a plugin does not inject every tool or its full prompt
content into every conversation. A missing connection produces the same setup
requirement as the corresponding UI action.

### Sub-agent definitions

A plugin can contribute a specialist such as `finance:model-reviewer` or
`finance:scenario-analyst`. Each definition declares:

- Stable identity, description, and guidance for when to delegate to it.
- Markdown instructions resolved through the plugin prompt catalog, with user
  overrides and template includes following the existing prompt rules.
- Validated task input and structured results, including findings, source
  references, assumptions, and links to produced artifacts where appropriate.
- An allowed tool set, explicit context requirements, and any permitted child
  agents, including capabilities supplied by declared plugin dependencies.
- A default AI profile or model requirements, configurable through Sky's model
  settings, plus run limits for time, steps, tokens/cost, and concurrency.

User-configured model choices and host budget ceilings take precedence over
plugin defaults. Editing Markdown instructions cannot expand tool access,
account permissions, or execution limits.

Sky's main agent or another authorized caller can discover and invoke the
specialist through the host. A sub-agent owns a bounded model-driven task; a tool
performs an operation. An explicit delegation tool can bridge the two, while
preserving the specialist's identity and run lifecycle.

Pass the task and selected notebook context explicitly. Do not implicitly give
every specialist the entire parent conversation or notebook. Resolve readiness
for its model, tools, and connections before starting affected work, and surface
configuration through the owning plugin's settings.

### Delegation and shared runtime

Sky owns agent execution, model access, progress, cancellation, and accounting.
The effective authority is the intersection of the initiating caller's grants,
the plugin's access, and the agent's declared scope. Neither a tool allowlist nor
delegation grants new authority. Approval requests return through the host's
existing user interaction path; unattended callers receive an actionable blocked
result when required authority is absent.

Nested delegation consumes a shared budget and obeys depth and concurrency
limits; a child cannot reset its parent's limits by spawning another agent.
Parent cancellation stops child work by default. Work intended to continue
independently needs explicit ownership through the background-job contract.

Record parent/child run IDs, owning plugin versions, effective instruction
versions and model settings, tool activity, usage, results, and artifacts. The UI
can show which specialist is working and let the user inspect its outputs and
source material. Long agent runs follow the same restart and failure rules as
other jobs; do not promise automatic resumption of an in-memory model loop.

For example, Model Reviewer reads a saved model and uses calculation and input
inspection tools to return findings with evidence. Scenario Analyst can compare
requested assumptions and produce a report through the same domain operations
used by the UI. Any write or external action remains subject to caller authority.

## AI provider plugins

Adding an AI service should be a plugin installation followed by any required
account setup. Sky could ship with a small set such as Anthropic, OpenAI,
Cerebras, and LM Studio, while a user adds Venice from AI settings with one
click. This is a product target, not the current provider inventory: the existing
registry also includes Ollama.

A provider-only plugin need not contribute commands, pages, or agents. It adds
the service to Sky's shared AI infrastructure so chat, commands, automations,
and sub-agents can select its supported models through the same settings.
Finance should normally request model capabilities and use the user's profile,
rather than require a particular vendor. An integration that genuinely depends
on a vendor-specific feature can declare that provider plugin as a dependency.

### Provider contract and model selection

Keep four identities separate: the provider plugin, a configured connection or
account, a model offered by that service, and a saved model profile. A profile
selects a provider, connection, model, and options; a role selects a profile.
Several providers and accounts can be active at once. A conversation and its
specialists may use different profiles while keeping their actual provider,
model, and usage visible.

Each provider contribution supplies:

- Stable provider ID, display metadata, connection requirements, and setup links.
- A versioned adapter that constructs host-compatible model clients, or a
  declarative configuration for a compatible adapter supplied by Sky.
- Model discovery when supported, optional suggested profiles, and a way to
  enter an explicit model ID when discovery is unavailable. Discovered models
  do not automatically become defaults or replace saved profiles.
- Model capability metadata: modalities, streaming, tool calling, structured
  output, context/output limits, and supported settings. Unknown support is
  represented as unknown rather than assumed from protocol compatibility.
- Validated provider-specific options and request/response normalization,
  including usage, errors, and rate-limit information where available.

Start with a reusable adapter for compatible chat-completions services and an
adapter interface for services that need custom code. Specify the wire protocol
explicitly; a configurable base URL alone is insufficient. Keep vendor-specific
options and message transformations in the adapter. Text generation, embeddings,
images, speech, and realtime voice are distinct capability contracts; a working
chat adapter does not imply support for every modality or every model feature.

Venice documents API-key authentication and an OpenAI-compatible API. Its model
listing is publicly readable, so fetching a model list alone cannot prove that
the user's credentials work. These documented properties suggest a compatible
chat adapter plus Venice metadata, options, and connection validation as the
starting implementation. Verify the supported model features against the actual
adapter before advertising them. See the [Venice API reference](https://docs.venice.ai/api-reference/api-spec).

### Add a provider from Settings

The user-facing path is:

1. Open AI settings, choose Add provider, and click Install on Venice. A small
   curated catalog identifies the package, publisher, version, and requirements.
   Sky resolves dependencies and installs/enables the provider contribution.
2. If setup is needed, connect an existing account or enter a key through Sky's
   connection UI. Provide a direct link to obtain a key and explain any service
   account or billing prerequisite. If a usable connection already exists, reuse
   it by selection without asking the user to enter the same secret again.
3. Test authorized inference access, discover available models, and choose a
   profile for a conversation, role, or specialist. Keep existing defaults until
   the user chooses to change them.

One click installs support; required credentials or provider account setup still
have a guided next step. The normal path requires no source edits, package-manager
commands, manual endpoints, or raw JSON. The provider can supply advanced
configuration UI using the existing settings contribution contract.

Use a provider-specific authenticated check for validation, or an explicitly
triggered small inference check using synthetic content when necessary. Explain
when that check may incur usage. Do not send notebook content merely to test a
connection. Cache the last successful model catalog and distinguish catalog
availability from connection readiness and access to a particular model.

### Runtime integration and lifecycle

Replace the closed provider union, model-construction switch, option-namespace
map, and known-provider validation in [models.ts](../../src/_shared-ts/ai/models.ts)
with registered descriptors and resolvers. Settings provider labels, selectors,
profile validation, and credential status must use that registry as well.
Preserve existing profile identities and the host's shared prompt normalization,
usage metering, cancellation, and execution attribution around every adapter.
Initialize registered providers before resolving saved profiles in the CLI,
service, and workers. Invalidate profile/client caches when relevant registry or
connection configuration changes.

Audit generic text-generation paths that instantiate a provider directly and
route them through the shared resolver. Provider-specific image, transcription,
and voice paths need their own capability adapters before they can use a newly
installed service. Surface unsupported features before starting the operation;
do not silently discard tool schemas or change its requested modality.

Keep credentials scoped to the chosen provider connection and resolve them on
the backend. Profiles store a connection reference, never the key itself.
Installation does not change where existing tasks send data. Switching profiles
is explicit; a failed or unavailable provider does not silently send the request
to another service. Any configured fallback follows the user's routing choice
and the same model capability requirements.

Provider removal follows dependency and active-run rules. Preserve saved profiles
and model references, mark affected ones unavailable, and link to reinstall or
select a replacement. A changed remote model catalog similarly must not silently
rewrite an existing profile's model identity.

## Public SDK and API access

Provide a small, versioned SDK for notebook reads and writes, command execution,
tool invocation, agent delegation, prompt resolution, AI calls, configuration,
connections, jobs, and logging.
Inject these services into the plugin host. External packages use public exports,
not Sky's private `#` imports or relative paths into the application checkout.
Shared date utilities continue to follow Sky's nbdt conventions.

There are two separate API needs:

- Calling external providers: backend adapters use declared connection handles
  and Sky-managed credentials. The browser receives data and connection status.
- Letting other software call the plugin: expose explicitly selected operations
  under namespaced endpoints, for example `/plugins/finance/api/...`, with
  centralized authentication, authorization, and request validation.

The existing local HTTP service is not already a scoped external developer API.
Build its authorization boundary before exposing plugin operations to other
applications. Keep browser-origin protections in the host as well.

Use existing core queries through the SDK. Defer extensions to the generated
core GraphQL schema: its entity types and resolver composition are currently
fixed, and a new domain should not require adding a core GraphQL type.

## UI contributions

Start with a small set of explicit extension points:

- Navigation entries and full pages inside Sky's shell.
- Document views and contextual actions selected by document type.
- Plugin configuration pages within Settings.
- Declared actions that invoke registered operations.

A finance plugin can provide a substantial interactive editor, tables, and
charts. Reuse Sky's React/Mantine components, tokens, typography, navigation,
and responsive behavior. Export the shared rendered-HTML component so plugin
prose preserves browser text selection through unrelated refreshes.

Initially, generate a client entrypoint from enabled contributions and include
it in the existing Bun build. Resolve React and shared UI dependencies to the
host's copies. Include the resolved plugin versions and sources in asset cache
invalidation. Build replacement assets before activating an updated plugin set;
a failed build should leave the previous set usable. A service restart and page
reload are acceptable for the first version.

Use per-contribution loading/error states so a failed page can name its owning
plugin. These states do not isolate arbitrary native browser code.

## Configuration, keys, and setup

Configuration is a first-class contribution. A plugin must be able to provide
its own configuration UI within Sky Settings, with stable links from features
that need setup. Offer schema-generated forms for ordinary settings and custom
components for workflows such as mapping accounting categories into a model.
Both use host validation and persistence.

For finance, configuration may include connections, currency and fiscal-year
defaults, forecast periods, agent model profiles and run limits, prompt
customizations, and refresh schedules. Give settings explicit ownership and
scope: user preferences belong in namespaced user configuration;
notebook-specific mappings belong to that notebook. Connection selections
reference stored accounts rather than copying credentials. Validate on the
server even when a custom form validates locally.

### Declared connection requirements

Each connection declares a readable name, its purpose, supported authentication
method, required access, setup instructions or provider links, and a backend
validation operation. State which capabilities require it and whether there is
an alternative such as manual input. Explain any known provider account or paid
plan prerequisite where the user starts setup.

The plugin owns provider-specific instructions and validation. Sky owns secure
credential entry/storage and reusable connection controls. Use the existing
secret store behind a facade scoped to declared connection slots. Stored values
are never returned whole in settings responses, injected into prompts, or written
to ordinary config, notebook files, or logs. Custom configuration components
receive masked identifiers and status, while backend provider calls use the
credential handle.

Show meaningful states: not connected, connected, insufficient access, and needs
reconnection. A test checks the access needed for the operation, not just whether
a key is present. Distinguish a temporary provider failure from an invalid key.
Support selecting, replacing, and disconnecting accounts; propagate changed
readiness to every dependent feature.

### Setup at the point of use

Installation, activation, and readiness are different states. Allow someone to
create a model and enter assumptions before connecting a data provider. When
they choose Import actuals, explain the missing connection, open its setup, then
return them to the import with their input preserved.

Represent readiness per capability. Backend operations check it too, so CLI,
AI, and scheduled work return a structured setup requirement with a useful next
action. Unattended work records the unmet prerequisite and waits for a later
explicit or scheduled attempt; it does not open an interactive setup flow or
silently retry a potentially completed write. Setup completion resumes the user
flow without implicitly repeating an external side effect.

## Dependencies between plugins

A plugin can require another plugin or optionally integrate with it. For example,
Finance could require Accounting Connector `^1.0.0` and optionally use Spreadsheet
Export `^2.0.0`. These are plugin runtime dependencies, separate from ordinary
library dependencies in the package manager.

Use one active version per plugin ID in a host. Resolve the entire enabled graph
before changing the active set, including transitive dependencies and supported
Sky API versions. Pin exact resolved versions and package sources for reproducible
activation. Start with local packages; fetching published packages can come later.

Required dependencies must be present and compatible before activation. Optional
dependencies enable only the features that use them. If an optional dependency
is absent or incompatible, make that integration unavailable with a clear reason
while leaving the rest of the plugin usable. Reject cycles in the active
dependency graph with the dependency path that caused them.

Activate dependencies first and dispose dependents first. Explain the graph
changes before installation or update. Refuse a conflicting version change
without damaging the active installation. Prevent disabling or removing a
required dependency while enabled plugins need it; allow an explicit operation
to disable the affected dependents together. Shared dependencies remain installed
when one consumer is removed.

### Public contracts and authority

Plugins communicate through declared, typed capabilities: commands, tools,
sub-agents, services, or exported UI components. Finance might call Accounting
Connector's actuals service. It should not read the connector's private files or
import its internal modules. Validate public contract compatibility as well as
package versions.
Resolve referenced tools and specialists through the dependency graph too;
unavailable optional contributions affect only the agents or features using them.

A dependency relationship does not grant access to another plugin's secrets,
accounts, or operations. Enforce the selected account and allowed action through
the host, retaining the initiating caller when one plugin calls another. The
connector owns authentication and supplies authorized data to its consumers.
Multiple domain plugins can reuse that connection without collecting the same
credentials independently.

### Dependency readiness and configuration

An installed dependency may still need configuration or reconnection. Finance
should report that Import actuals needs an account connected in Accounting
Connector, link directly to that plugin's configuration, and return to the
original workflow afterward. Do not duplicate the dependency's configuration
form or turn a connection problem into a package installation error.

Reserve required dependencies for services essential to the plugin itself. If
Finance can work without an accounting integration, declare that dependency
optional and make readiness specific to Import actuals.

## Prompts, templates, and portable documents

Extend the existing prompt catalog with namespaced plugin roots. A stable ID
such as `plugins/finance/review-assumptions.prompt.md` resolves to its installed
default or a notebook override under `ai/prompts/plugins/finance/`. Keep IDs
independent of installation paths and versions.

Use the current editor, validation, preview, include expansion, and conflict
handling. Resolve effective content when an operation loads its prompt. Sibling
includes stay in the plugin namespace; cross-plugin includes use qualified IDs
and declared dependencies. Package updates replace defaults and preserve user
overrides. Report overrides that no longer satisfy a changed prompt contract.

Document templates create ordinary notebook documents. A model could carry
`type: finance/model` and `schemaVersion: 1` in YAML frontmatter, with assumptions
and explanations in Markdown and larger numerical inputs/results in companion
CSV or JSON files. Spreadsheet exports are artifacts, not a requirement to read
the model's assumptions.

Register plugin document locations with the generic store, watcher, search, and
Explorer access rules together. A new top-level directory is not automatically
indexed today. An initial finance slice can use an existing indexed location,
such as `library/finance/`, before generalizing root registration. Preserve
generic document access when a plugin is disabled; its custom view may disappear,
but its files remain readable. Computed indexes must be rebuildable.

Keep the financial calculation engine deterministic and test its numerical
behavior. AI can propose assumptions and explain results. Record input sources,
effective assumptions, and engine versions so saved results can be traced to
what produced them. Version and validate document schemas; migrations must be
explicit, preserve source data, and define whether downgrade remains possible.

## Jobs, lifecycle, and trust

Use Sky's background jobs for imports and long calculations. Namespace job
identities by notebook, plugin, and operation/model. Reuse automations for
scheduling instead of starting independent plugin timers.

Track the plugin version that owns each job, including agent runs and their
children. Defer updates and removal until affected running jobs finish, or
explicitly stop them before switching versions.
Current jobs survive service restarts, not machine reboots or worker termination;
do not promise automatic replay or exactly-once external effects. Operations that
support retry must define their own idempotency and progress behavior.

Activation returns owned registrations and cleanup handles. Disabling releases
listeners and registrations and removes scheduled entrypoints, disposing
dependents before their dependencies and respecting active jobs. Uninstalling
preserves notebook documents, user prompt overrides, and configuration. Credential
deletion is a separate action, especially when a connection has other consumers.
Retain the previous package set for activation rollback, while recognizing that
rolling back executable code cannot undo a data migration.

The first version runs trusted local plugins. In-process modules, native browser
components, and ordinary subprocesses have substantial ambient access. SDK scopes
govern cooperative use of host services; manifest permissions and AI approval
flags do not sandbox hostile code. Untrusted third-party distribution needs a
separate design for backend isolation and browser isolation.

## Implementation sequence

1. Add the manifest, local package linking, dependency resolver, version pins,
   and registry. Adapt existing command discovery and define the first public
   SDK surface. Validate discovery and graph changes before activation.
2. Add native page/navigation and settings contributions, namespaced routes,
   and client build integration. Implement declared connections, custom
   configuration UI, and readiness shared by UI and backend callers.
3. Extend the prompt catalog and document/template integration. Build a thin
   finance workflow: create a model, edit assumptions, calculate, explain, and
   export, all through shared domain operations. Register calculation and
   inspection tools plus a Model Reviewer specialist with configurable Markdown
   instructions, explicit tool access, and host-managed execution.
4. Exercise required and optional dependencies with a separate connector and
   exporter. Verify shared configuration, account selection, compatibility,
   cross-plugin calls, and setup handoff, including tools and agents exported by
   dependencies. Add scheduled refresh using host jobs.
5. Add provider contributions to the shared model registry and AI settings.
   Validate the contract with a separate Venice provider package, including
   connections, discovery, model capabilities, and use by a plugin specialist.
   Once local versioning, upgrades, and recovery work, deliver Add provider from
   a small curated package catalog; a full marketplace is not needed for this.
6. Validate the SDK with a second domain plugin before expanding extension
   points or opening broader third-party package distribution.

## Acceptance criteria

- A finance package delivers the end-to-end workflow without further changes
  to Sky core once the initial extension points exist.
- CLI, UI, AI, automation, and external API callers reach the same operation
  and validation, with caller-appropriate authorization and explicit exposure
  rules.
- A plugin contributes both command-backed and standalone tools plus a
  discoverable specialist without editing core prompts or agent dispatch code.
  The specialist runs through Sky and returns structured findings and sources.
- Agent instruction customizations and model/run settings affect subsequent
  runs. Missing tool connections route to the owning configuration screen.
- Delegation preserves caller authority, enforces tool access and a shared run
  budget, and propagates cancellation. Dependent plugins can invoke a public
  specialist without importing its implementation or obtaining its credentials.
- A user installs Venice from AI settings, connects it, and selects a supported
  model for chat or a plugin specialist without source edits or manual config.
  Multiple providers remain usable, and installation preserves existing defaults.
- New providers appear in the shared profile/role selectors. Connection testing
  verifies authorized access rather than only public model discovery; unsupported
  tool or modality requirements produce a clear readiness failure.
- Removing a provider preserves its saved profiles and reports them unavailable.
  Failures never silently switch a request to another provider, and active runs
  retain their provider and plugin ownership through updates.
- With no keys or accounts configured, manual modeling works and importing
  actuals explains its prerequisite and leads to working setup.
- A plugin supplies both ordinary settings and a custom configuration screen
  in Sky's existing theme. Invalid input is rejected by the backend.
- Connection tests distinguish missing credentials, missing access, and
  temporary provider failures. Saved credentials do not appear in ordinary
  settings responses, logs, prompt content, or notebook artifacts.
- A configured connector can serve two plugins through authorized public
  calls; dependency installation does not grant either consumer secret access.
- Missing/incompatible required dependencies, conflicting upgrades, and
  cycles report actionable errors and preserve the active set. Missing optional
  dependencies affect only the declared integration.
- Configuration handoff into a dependency returns to the initiating workflow;
  CLI and unattended callers receive equivalent structured readiness failures.
- Updating preserves custom prompts and documents. Disabling a plugin leaves
  those documents accessible, and removing a shared dependency respects its
  remaining consumers.
- A running calculation reconnects after a service restart. Updating its
  plugin respects job ownership and does not silently replay external writes.
- An invalid plugin client build leaves the previous working assets available.
  Public SDK imports resolve without a sibling Sky source checkout.

## Deliberate limits of the first version

Accept rebuilding assets and restarting to change the active plugin set, with
Sky handling any required restart as part of installation. The target includes
a curated provider catalog with one-click installation and guided connection
setup. Defer hot unloading, an open marketplace, multiple active versions of the
same plugin, arbitrary injection into app internals, and dynamic core GraphQL
types. A trusted
local package with explicit contributions is enough to establish the contracts;
curated provider installation follows that foundation, while broader distribution
and isolation follow working domain and provider implementations.
