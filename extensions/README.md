---
created: 2025-11-12
updated: 2026-07-22
---

# Extensions

Editor and browser extensions for the Notebook system.

## Structure

```
extensions/
├── vscode/   # VS Code extension — no build step, loads TypeScript directly
├── browser/  # Browser extension (Chrome) — webpack era, untracked in git
└── shared/   # Config shared by webpack-era extensions
    ├── tsconfig.base.json
    └── paths.js
```

## VS Code Extension (`vscode/`)

Completions for notebook entities (people, projects, tags, organizations, places, day items, notes), day-file handlers (checkbox/reminder/todo gutters), Editor integration, and Claude-powered summarize commands.

There is no bundler and no compile step. The package declares `"type": "module"`, `main` points at `src/extension.ts`, and VS Code's Node extension host (VS Code ≥ 1.100) strips the types at load. Shared notebook code is reached through committed symlinks plus the package.json `imports` map. See `vscode/README.md` for the constraints this puts on the import graph.

```bash
cd vscode
npm install      # dependencies only — nothing to build
npm run check    # typecheck + strip/dep-parity guards
npm test         # integration test in a real VS Code host
```

## Browser Extension (`browser/`)

Chrome extension for capturing web content to the notebook (untracked in git). Still on the old pattern: webpack + ts-loader driven by `shared/paths.js` and `shared/tsconfig.base.json`, resolving build tooling from the global npm modules of an nvm-managed Node 22 install rather than a local `node_modules/`. Its build is currently broken — `terser-webpack-plugin` is missing from that global install; giving the project its own `node_modules` is the pending fix.

## Shared Configuration (`shared/`)

- **`tsconfig.base.json`** — base compiler options. Only `browser/` extends it now.
- **`paths.js`** — webpack aliases (`#shared`, `#universal`, `#config` → `src/_shared-ts`) and the loader trio (ts-loader, strip-`.ts`-extensions, replace-`import.meta.url`) that webpack-era builds need to consume the shared TypeScript.

The VS Code extension used both until it dropped webpack; its TypeScript config is now self-contained, and the loaders' jobs are handled by the runtime (explicit `.ts` specifiers, real `import.meta.url`).
