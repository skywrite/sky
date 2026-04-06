import { env } from '#shared/sys/mod.ts'

/**
 * List available Mistral models via direct HTTP API call
 */
export async function listModels(apiKey?: string): Promise<string[]> {
  const key = apiKey || env.get('MISTRAL_API_KEY')
  if (!key) {
    throw new Error('MISTRAL_API_KEY environment variable not set')
  }

  const response = await fetch('https://api.mistral.ai/v1/models', {
    headers: {
      Authorization: `Bearer ${key}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to list models: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as { data: Array<{ id: string }> }
  return data.data.map((model) => model.id).sort()
}
