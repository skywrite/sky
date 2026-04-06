import { runCommand } from './command.ts'

export default async function fetchLocalHostName(): Promise<string> {
  const { stdout } = await runCommand('scutil', ['--get', 'LocalHostName'])
  return stdout
}
