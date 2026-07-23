---
updated: 2026-07-22
---

# VSCode Extension

Notebook helper extension: entity completions (people, projects, tags, organizations, places, day items, notes), day-file handlers (checkbox/reminder/todo gutters), Typora integration (Cmd+T), and Claude-powered summarize commands.

## No build step

VS Code loads `src/extension.ts` directly: the package is `"type": "module"`, `main` points at the TypeScript entry, and the Node extension host strips types at load (VS Code ≥ 1.100; Node per `.nvmrc`). Edit a file, reload the window, done. `.prompt.md` templates are read at call time via `import.meta.url`, so editing them takes effect without a reload.

## Install

Symlink the extension into VS Code's extensions folder, install deps, then fully restart VS Code (restart, not window reload — the extension scanner only reads the folder at startup):

```bash
ln -s /path/to/sky-oss/extensions/vscode ~/.vscode/extensions/sky-ext
cd /path/to/sky-oss/extensions/vscode && npm install
```

After that it runs from the repo in place; edits take effect on the next window reload. If a fresh machine ever fails to register the symlink, the fallback is launching with `code --extensionDevelopmentPath=/path/to/sky-oss/extensions/vscode`.

## Layout

- `src/` — extension source
- `shared` → `../../src/_shared-ts` (symlink) — notebook shared code, addressed as `#shared/*`, `#universal/*`, `#config` via the package.json `imports` map
- `lib` → `../../src/lib` (symlink) — `#lib/*`
- `resources/` — gutter icons
- `scripts/` — guards (see below)

The symlinks exist because Node forbids `imports` targets outside the package directory. Resolution realpaths through them, so shared code's own `#`-imports keep resolving against `src/package.json`. Consequence: the extension cannot be packaged with vsce — it only runs installed in place, per Install above.

## Constraints on the import graph

Node's stripper erases types only — it rejects non-erasable syntax at load, which would surface as an activation crash. The rules, and what enforces each:

| rule | enforced by |
|---|---|
| no parameter properties, enums, or runtime namespaces | `erasableSyntaxOnly` (tsconfig) |
| no angle-bracket assertions — `x as T`, never `<T>x` | `scripts/stripcheck.ts` (tsc cannot catch these) |
| type-only imports marked `import type` | `verbatimModuleSyntax` (tsconfig) |
| import specifiers explicit: `./x.ts`, `#shared/y/mod.ts` | resolution fails fast otherwise |

Dependencies: imports in extension source resolve from `node_modules/` here — so the manifest declares only what extension source itself imports (`ws`, `yaml`). Imports inside shared code resolve from `src/node_modules` on both sides: at runtime via the symlinks' realpath, at typecheck via the tsconfig `paths` block that maps `#`-imports to their real locations — no mirror copies needed here. `scripts/depparity.ts` asserts version parity for any declared overlap and that the runtime (`imports`) and typecheck (`paths`) maps stay equivalent.

## Scripts

```bash
npm run typecheck  # tsc --noEmit over src plus all reachable shared code
npm run check      # typecheck + stripcheck + depparity
npm test           # runs the *_test.ts suite in a real VS Code host
```
