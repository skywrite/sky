import { settingsHref } from '../settingsRoutes.ts'

export const assignmentsHref = settingsHref('models')
export const libraryHref = `${assignmentsHref}/presets`
export const roleHref = (role: string) => `${assignmentsHref}/roles/${encodeURIComponent(role)}`
export const presetHref = (name: string) => `${libraryHref}/edit/${encodeURIComponent(name)}`

type Detail = { kind: 'role' | 'preset'; name: string } | { kind: 'decisions' | 'new' }

export function modelsRoute(path: string): { library: boolean; detail: Detail | null } {
  const clean = path.replace(/\/$/, '')
  const library = clean === libraryHref || clean.startsWith(`${libraryHref}/`)
  if (
    [
      '/settings/decisions',
      '/settings/ai/decisions',
      `${assignmentsHref}/decisions`,
      `${libraryHref}/decisions`,
    ].includes(clean)
  )
    return { library, detail: { kind: 'decisions' } }
  if (clean === `${libraryHref}/new`) return { library, detail: { kind: 'new' } }
  const prefix = library ? `${libraryHref}/edit/` : `${assignmentsHref}/roles/`
  if (clean.startsWith(prefix)) {
    try {
      return {
        library,
        detail: { kind: library ? 'preset' : 'role', name: decodeURIComponent(clean.slice(prefix.length)) },
      }
    } catch {
      // A malformed bookmark can still open its assignments or library.
    }
  }
  return { library, detail: null }
}
