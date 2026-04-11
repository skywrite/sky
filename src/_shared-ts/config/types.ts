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
  }
  server: {
    port: number
  }
}
