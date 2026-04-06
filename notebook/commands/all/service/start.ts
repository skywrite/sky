import run from '#service/run.ts'

// This program does not use the standard
// Task interface
// this is because this is ran with the Deno --watch flag
// which needs static importing and the task interface dynamicaly imports

// TODO: figure out why this isn't called
globalThis.addEventListener('beforeunload', (_event) => {
  console.log('Notebook service is exiting...')
})

run().catch((err) => {
  console.error(err)
})
