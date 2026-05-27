import * as path from 'node:path'
import * as config from '#config'
import readDir from '#shared/fs/readDir.ts'

export default async function localServicesFiles(): Promise<Record<string, string>> {
  const services: Record<string, string> = {}

  for await (const entry of readDir(<string>config.DIR_CODE_SERVICES)) {
    services[path.basename(entry.name, '.plist')] = path.join(config.DIR_USER_SERVICES, entry.name)
  }

  return services
}
