/**
 * List available LM Studio models via OpenAI-compatible API
 */
export async function listModels(baseURL = 'http://localhost:1234/v1'): Promise<string[]> {
  const response = await fetch(`${baseURL}/models`)

  if (!response.ok) {
    throw new Error(`Failed to list models: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as { data: Array<{ id: string }> }
  return data.data.map((model) => model.id).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}
