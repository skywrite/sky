/** Shared wire types for the prompt library; safe to import in the browser. */
export interface PromptUsage {
  label: string
  file: string
  line?: number
  promptId?: string
}

export interface PromptEntry {
  id: string
  name: string
  description: string
  customized: boolean
  custom: boolean
  uses: PromptUsage[]
  includes: Array<{ id: string; name: string }>
  error?: string
}

export interface PromptDocument extends PromptEntry {
  content: string
  version: string
}

export interface PreviewVariable {
  name: string
  description: string
  kind: 'text' | 'boolean' | 'number' | 'json'
  conditional: boolean
  sample: string | boolean | number
}

export interface PromptPreview {
  output: string
  variables: PreviewVariable[]
  empty: string[]
  includes: Array<{ id: string; name: string }>
}
