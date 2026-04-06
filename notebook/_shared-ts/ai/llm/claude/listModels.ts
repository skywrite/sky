import { env } from '#shared/sys/mod.ts'

/**
 * List available Claude/Anthropic models via direct HTTP API call
 */
export async function listModels(apiKey?: string): Promise<string[]> {
  const key = apiKey || env.get('ANTHROPIC_API_KEY')
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY environment variable not set')
  }

  const response = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to list models: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as { data: Array<{ id: string }> }
  return data.data.map((model) => model.id)
}
