import load from './load.ts'
import unload from './unload.ts'

export default async function reload(dirtyService: string): Promise<boolean> {
  const unloadResult = await unload(dirtyService)
  if (!unloadResult.success) return false

  const loadResult = await load(dirtyService)
  if (!loadResult.success) return false

  return true
}
