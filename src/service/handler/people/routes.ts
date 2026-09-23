import * as path from 'node:path'
import { readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'
import { slugify } from '#lib/string/mod.ts'
import type { ProfileType } from './types.ts'

interface ProfileIdentity {
  type: ProfileType
  id: string
  name: string
  fingerprint: string
}
interface RouteEntry extends Omit<ProfileIdentity, 'name'> {
  slug: string
  active?: boolean
}

/** Local URL reservations keep namesakes and renamed files from changing existing links. */
export async function profileRoutes(stateDir: string, profiles: ProfileIdentity[]): Promise<Map<string, string>> {
  return withProcessLock(path.join(stateDir, 'routes.lock'), async () => {
    const file = path.join(stateDir, 'routes.json')
    const saved = (await readJson<RouteEntry[]>(file)) ?? []
    const before = JSON.stringify(saved)
    const key = (profile: Pick<ProfileIdentity, 'type' | 'id'>) => `${profile.type}:${profile.id}`
    const present = new Set(profiles.map(key))
    const byFile = new Map(saved.filter((entry) => entry.active !== false).map((entry) => [key(entry), entry]))
    const unassigned = profiles.filter((profile) => !byFile.has(key(profile)))
    const missing = saved.filter((entry) => !present.has(key(entry)))
    const result = new Map<string, string>()
    for (const profile of [...profiles].sort((a, b) => a.id.localeCompare(b.id))) {
      let entry = byFile.get(key(profile))
      if (!entry) {
        // A unique unchanged document can be followed through an external file move.
        // Never guess between identical copies, or between simultaneous moves and edits.
        const matches = missing.filter((old) => old.type === profile.type && old.fingerprint === profile.fingerprint)
        const copies = unassigned.filter(
          (other) => other.type === profile.type && other.fingerprint === profile.fingerprint,
        )
        if (matches.length === 1 && copies.length === 1) entry = matches[0]
      }
      if (!entry) {
        const stem = slugify(profile.name).slice(0, 100) || (profile.type === 'person' ? 'person' : 'organization')
        const reserved = new Set(['_api', ...saved.filter((old) => old.type === profile.type).map((old) => old.slug)])
        let slug = stem
        for (let suffix = 2; reserved.has(slug); suffix++) slug = `${stem}-${suffix}`
        entry = { type: profile.type, id: profile.id, fingerprint: profile.fingerprint, slug }
        saved.push(entry)
      }
      entry.id = profile.id
      entry.fingerprint = profile.fingerprint
      entry.active = true
      result.set(key(profile), entry.slug)
    }
    for (const entry of saved) if (!present.has(key(entry))) entry.active = false
    // Deleted profiles retain their reservations so an old link cannot open a different namesake.
    if (JSON.stringify(saved) !== before) await writeJson(file, saved)
    return result
  })
}
