/**
 * List available Ollama models via direct HTTP API call
 */
export async function listModels(baseURL = 'http://localhost:11434'): Promise<string[]> {
  const response = await fetch(`${baseURL}/api/tags`)

  if (!response.ok) {
    throw new Error(`Failed to list models: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as { models?: Array<{ name: string }> }
  return (data.models || []).map((model) => model.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}
