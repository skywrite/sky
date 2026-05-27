import { runCommand } from '#lib/sys/mod.ts'
import resolveService from '../resolveService.ts'

export default async function unload(dirtyService: string) {
  const service = resolveService(dirtyService)
  return runCommand('launchctl', ['unload', '-w', service.plistFilePath])
}
