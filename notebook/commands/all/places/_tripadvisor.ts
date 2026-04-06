// https://tripadvisor-content-api.readme.io/reference/searchforlocations
export async function fetchTripadvisorTextSearch(query: string, apiKey: string): Promise<Record<string, any>> {
  const q = encodeURIComponent(query)

  const url = `https://api.content.tripadvisor.com/api/v1/location/search?key=${apiKey}&searchQuery=${q}&language=en`

  const res = await fetch(url)
  return await res.json()
}

// https://tripadvisor-content-api.readme.io/reference/getlocationdetails
export async function fetchTripadvisorPlaceDetails(locationId: string, apiKey: string): Promise<Record<string, any>> {
  const url = `https://api.content.tripadvisor.com/api/v1/location/${locationId}/details?key=${apiKey}&language=en&currency=USD`

  const res = await fetch(url)
  return await res.json()
}
