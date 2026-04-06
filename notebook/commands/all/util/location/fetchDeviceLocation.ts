import { isCommandAvailable, runCommandJSON } from '#lib/sys/mod.ts'

export type Location = {
  latitude: number
  longitude: number
}

/**
 * Fetch location using the device-location command
 * This is faster and doesn't require QR code/mobile phone
 *
 * @returns Location data or null if command not available or fails
 */
export async function fetchDeviceLocation(): Promise<Location | null> {
  // Check if device-location command is available
  const isAvailable = await isCommandAvailable('device-location')

  if (!isAvailable) {
    return null
  }

  // Run device-location command and parse JSON output
  // The command outputs: {"latitude":60.102,"longitude":-149.436,...}
  const locationData = await runCommandJSON<Location>('device-location', ['--json'])

  if (!locationData || typeof locationData.latitude !== 'number' || typeof locationData.longitude !== 'number') {
    return null
  }

  return {
    latitude: locationData.latitude,
    longitude: locationData.longitude,
  }
}

export default fetchDeviceLocation
