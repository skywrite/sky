import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { CommandResult } from '#commands/mod.ts'

/**
 * Row structure for the day_files table in Supabase
 */
export interface DayFileRow {
  id: string
  user_id: string
  file_date: string
  started?: string | null
  file_path: string
  content: string
  content_hash: string
  updated_at: string
  synced_from: string
}

/**
 * Environment variables needed for Supabase operations
 */
export interface SupabaseEnv {
  projectUrl: string
  secretKey: string
  userId: string
}

/**
 * Result of getSupabaseEnv - either success with env vars or failure with CommandResult
 */
export type SupabaseEnvResult = { ok: true; env: SupabaseEnv } | { ok: false; result: CommandResult }

/**
 * Extract and validate Supabase environment variables.
 * Returns a CommandResult.fail if any required env vars are missing.
 */
export function getSupabaseEnv(env: Record<string, string>): SupabaseEnvResult {
  const projectUrl = env.SUPABASE_PROJECT_URL
  const secretKey = env.SUPABASE_SECRET_KEY
  const userId = env.SUPABASE_USER_JP_ID

  if (!projectUrl) {
    return { ok: false, result: CommandResult.fail('SUPABASE_PROJECT_URL not set') }
  }

  if (!secretKey) {
    return { ok: false, result: CommandResult.fail('SUPABASE_SECRET_KEY not set') }
  }

  if (!userId) {
    return { ok: false, result: CommandResult.fail('SUPABASE_USER_JP_ID not set') }
  }

  return { ok: true, env: { projectUrl, secretKey, userId } }
}

/**
 * Create a Supabase client using the secret key (bypasses RLS)
 */
export function createSupabaseClient(env: SupabaseEnv): SupabaseClient {
  return createClient(env.projectUrl, env.secretKey)
}
