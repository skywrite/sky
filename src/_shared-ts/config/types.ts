export interface AiProfileConfig {
  provider: string
  model: string
  baseUrl?: string
  options?: Record<string, unknown>
}

export interface SkyConfig {
  version: number
  dir: string
  userDataDir: string
  codeDir: string
  editor: string | undefined
  categories: string[]
  commands: {
    dirs: string[]
    day: {
      start: string[]
      end: string[]
    }
  }
  bins: Record<string, string>
  ai: {
    models: {
      strong: string
      fast: string
      transcription: string
    }
    profiles?: Record<string, AiProfileConfig>
  }
  server: {
    port: number
  }
}
