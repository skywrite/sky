import exists from '#shared/fs/exists.ts'
import localServicesFiles from './localServicesFiles.ts'

export default async function localServicesInstalled(): Promise<Record<string, boolean>> {
  const serviceFiles = await localServicesFiles()
  const servicesInstalled: Record<string, boolean> = {}

  for (const [serviceName, serviceFile] of Object.entries(serviceFiles)) {
    servicesInstalled[serviceName] = await exists(serviceFile)
  }

  return servicesInstalled
}
