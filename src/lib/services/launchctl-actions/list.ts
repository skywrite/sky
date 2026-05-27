import { runCommand } from '#lib/sys/mod.ts'
import type { ServiceListStatus } from '../types.ts'

export default async function list(): Promise<ServiceListStatus[]> {
  const { stdout } = await runCommand('launchctl', ['list'])

  const output = stdout.trim()

  const lines = output.split('\n')
  // remove first line w/ header: PID	Status	Label
  lines.shift()

  const list: ServiceListStatus[] = lines.map((line) => {
    const [pid, lastCodeStr, label] = line.split('\t')
    return { label, pid, lastCode: parseInt(lastCodeStr) }
  })

  return list
}
