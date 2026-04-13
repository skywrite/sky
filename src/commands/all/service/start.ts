if (import.meta.main) {
  const { default: run } = await import('#service/run.ts')

  // TODO: figure out why this isn't called
  globalThis.addEventListener('beforeunload', (_event) => {
    console.log('Notebook service is exiting...')
  })

  run().catch((err) => {
    console.error(err)
  })
}
