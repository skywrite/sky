import process from 'node:process'

// Preloaded into the browser server. An error the server throws outside any
// tool call — a download whose popup closed before the handler finished,
// say — is an unhandled rejection, and Bun ends the process on one. With a
// listener in place it is a line on stderr instead, and the server keeps
// serving. Nothing here changes what the server does; it only refuses to
// let a stray error take the browser down mid-task.

const describe = (reason: unknown): string =>
  reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)

process.on('unhandledRejection', (reason) => {
  process.stderr.write(
    `[sky] the browser server hit an error outside a tool call and carried on: ${describe(reason)}\n`,
  )
})
process.on('uncaughtException', (error) => {
  process.stderr.write(`[sky] the browser server hit an uncaught error and carried on: ${describe(error)}\n`)
})
