import { runCommand } from '#lib/sys/mod.ts'
import resolveService from '../resolveService.ts'

export default async function start(dirtyService: string) {
  const service = resolveService(dirtyService)
  return runCommand('launchctl', ['start', service.label])
}
