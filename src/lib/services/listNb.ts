import type { ServiceListStatus } from './types.ts'
import servicesListAll from './launchctl-actions/list.ts'
import localServicesFiles from './localServicesFiles.ts'

export default async function servicesListNb(): Promise<ServiceListStatus[]> {
  const allServices = await servicesListAll()
  const localServices = await localServicesFiles()

  return allServices.filter((serviceStatus) => localServices[serviceStatus.label])
}
