import { FILE_NOTEBOOK_CODE_ENV } from '../config.ts'
import process from 'node:process'

declare const Bun: unknown

// Load .env file if not already loaded
if (!process.env.ENV_FILE_LOADED) {
  if (typeof Bun !== 'undefined') {
    console.warn('Bun does not support process.loadEnvFile(). Use --env-file=.env flag.')
  } else if (typeof (process as any).loadEnvFile === 'function') {
    // deno-lint-ignore no-explicit-any
    try {
      ;(process as any).loadEnvFile(FILE_NOTEBOOK_CODE_ENV) // deno-lint-ignore no-explicit-any
    } catch {
      console.warn(`Could not load .env file: ${FILE_NOTEBOOK_CODE_ENV}`)
    }
  }
}

function get(name: string): string | undefined {
  return process.env[name]
}

function toObject(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}

const env = { get, toObject }
export default env
