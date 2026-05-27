import type { ServiceStatus } from './types.ts'
import localServicesInstalled from './localServicesInstalled.ts'
import listNb from './listNb.ts'

export default async function localServicesStatus(): Promise<ServiceStatus[]> {
  const servicesInstalled = await localServicesInstalled()
  const nbServicesActive = await listNb()

  const serviceMap: Record<string, ServiceStatus> = {}

  nbServicesActive.forEach((service) => {
    serviceMap[service.label] = {
      label: service.label,
      installed: servicesInstalled[service.label],
      loaded: true,
      running: service.pid !== '-',
      pid: service.pid,
      lastError: service.lastCode !== 0,
    }
  })

  // for services not in the list output, put them here
  Object.entries(servicesInstalled).forEach(([serviceLabel, serviceInstalled]) => {
    if (serviceMap[serviceLabel]) return // already in the map

    serviceMap[serviceLabel] = {
      label: serviceLabel,
      installed: serviceInstalled,
      loaded: false,
      running: false,
      pid: '-',
      lastError: false,
    }
  })

  return Object.values(serviceMap)
}
