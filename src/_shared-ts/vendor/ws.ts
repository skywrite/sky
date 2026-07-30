/**
 * Re-export for consumers whose files live outside src/ (the vscode
 * extension): a bare `import 'ws'` there resolves from the importer's own
 * node_modules, forking the dependency into a second install that can drift.
 * Importing via #shared/vendor keeps every consumer on the single audited
 * copy in src/node_modules.
 */
export { default as WebSocket } from 'ws'
