/**
 * Same role as ./ws.ts: out-of-src consumers (the vscode extension) import
 * yaml through here so the single audited copy in src/node_modules is used.
 */
export * from 'yaml'
