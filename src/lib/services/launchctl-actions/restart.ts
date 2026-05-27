import start from './start.ts'
import stop from './stop.ts'

export default async function restart(dirtyService: string): Promise<boolean> {
  const stopResult = await stop(dirtyService)
  if (!stopResult.success) return false

  const startResult = await start(dirtyService)
  if (!startResult.success) return false

  return true
}
