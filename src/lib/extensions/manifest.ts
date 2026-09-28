/**
 * An extension's manifest is its package.json: the standard fields mean what
 * npm says they mean, and Sky's few own fields sit in a `sky` block. This is
 * the required set for manifest 1; a missing or wrong field is refused by
 * name, never guessed.
 */

import { z } from 'zod'

export const MANIFEST_VERSION = 1

/** The fixed vocabulary a gallery shelves extensions by. The first is the shelf. */
export const EXTENSION_CATEGORIES = [
  'CRM',
  'Messaging',
  'Email',
  'Calendar',
  'Documents',
  'Finance',
  'AI',
  'Utilities',
] as const
export type ExtensionCategory = (typeof EXTENSION_CATEGORIES)[number]

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes, starting with a letter or digit')

export const ExtensionManifestSchema = z.object({
  name: slug,
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'a semantic version like 0.1.0'),
  description: z.string().trim().min(1, 'one line about the extension'),
  author: z.object({
    name: z.string().trim().min(1),
    email: z.string().email(),
    url: z.string().url(),
  }),
  repository: z.union([z.string(), z.object({ url: z.string(), directory: z.string().optional() })]).optional(),
  sky: z.object({
    manifest: z.literal(MANIFEST_VERSION),
    name: z.string().trim().min(1, 'the display name'),
    categories: z.array(z.enum(EXTENSION_CATEGORIES)).min(1, 'at least one category'),
  }),
})

export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>

export type ManifestReading = { ok: true; manifest: ExtensionManifest } | { ok: false; reason: string }

/** Parse a package.json's text as an extension manifest; a refusal names the field. */
export function readManifest(text: string): ManifestReading {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'package.json is not valid JSON' }
  }
  if (!json || typeof json !== 'object') return { ok: false, reason: 'package.json is not an object' }
  if (!('sky' in json))
    return { ok: false, reason: 'package.json has no "sky" block, so this folder is not a Sky extension' }
  const parsed = ExtensionManifestSchema.safeParse(json)
  if (parsed.success) return { ok: true, manifest: parsed.data }
  const issue = parsed.error.issues[0]
  const field = issue.path.join('.') || 'package.json'
  const manifestVersion = (json as { sky?: { manifest?: unknown } }).sky?.manifest
  if (field === 'sky.manifest' && manifestVersion !== undefined) {
    return {
      ok: false,
      reason: `manifest ${String(manifestVersion)} is newer than this Sky understands (${MANIFEST_VERSION})`,
    }
  }
  return { ok: false, reason: `${field}: ${issue.message}` }
}

/**
 * The author's handle, the first half of an extension's `author/slug`
 * identity: the GitHub profile in the author URL, else the owner of the
 * repository URL.
 */
export function authorHandle(manifest: ExtensionManifest): string | null {
  const fromUrl = handleFromGitHubUrl(manifest.author.url)
  if (fromUrl) return fromUrl
  const repo = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
  return repo ? handleFromGitHubUrl(repo) : null
}

function handleFromGitHubUrl(url: string): string | null {
  try {
    const parsed = new URL(url.includes('://') ? url : `https://${url}`)
    if (!/(^|\.)github\.com$/i.test(parsed.hostname)) return null
    const [owner] = parsed.pathname.split('/').filter(Boolean)
    return owner && /^[A-Za-z0-9-]+$/.test(owner) ? owner.toLowerCase() : null
  } catch {
    return null
  }
}
