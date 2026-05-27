import { runCommand } from '#lib/sys/mod.ts'
import resolveService from '../resolveService.ts'

export default async function load(dirtyService: string) {
  const service = resolveService(dirtyService)
  return runCommand('launchctl', ['load', '-w', service.plistFilePath])
}
