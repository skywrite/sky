import localServicesStatus from './localServicesStatus.ts'
import resolveService from './resolveService.ts'

export default async function doesServiceExistAndInstalled(dirtyService: string): Promise<boolean> {
  const serviceToCheck = resolveService(dirtyService)

  const notebookServices = await localServicesStatus()

  for (const service of notebookServices) {
    if (serviceToCheck.label === service.label) {
      if (service.installed) return true
    }
  }

  return false
}
