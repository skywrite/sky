import type { Document } from '#shared/models/Markdown/mod.ts'
import type DomainCollection from '../../mod.ts'
import { matchesContains, matchesExact } from '../filters/mod.ts'
import {
  type ActivityFilter,
  type EntitySpec,
  type InvolvesFilter,
  type NameResolver,
  type TagFilter,
  type TextFilter,
  docBase,
  getOptionalStringField,
  getStringField,
  matchesActivityFilter,
  matchesInvolvesFilter,
  matchesTagFilter,
  matchesTextFilter,
  perRow,
} from './shared.ts'

const PROJECT_OVERVIEW_SUFFIX = '/_project/overview.md'

export interface ProjectFilter extends TagFilter, TextFilter, InvolvesFilter, ActivityFilter {
  name?: string
  nameContains?: string
  status?: string
}

export function matchesProjectFilter(doc: Document, filter: ProjectFilter, resolveNames?: NameResolver): boolean {
  if (filter.name && !matchesExact(doc, 'name', filter.name)) return false
  if (filter.nameContains && !matchesContains(doc, 'name', filter.nameContains)) return false
  if (filter.status && !matchesExact(doc, 'status', filter.status)) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesInvolvesFilter(doc, filter, resolveNames)) return false
  if (!matchesTextFilter(doc, filter)) return false
  if (!matchesActivityFilter(doc, filter)) return false
  return true
}

/** Project folder root for an overview path ('' when not an overview). */
export function projectDirOf(overviewPath: string): string {
  return overviewPath.endsWith(PROJECT_OVERVIEW_SUFFIX) ? overviewPath.slice(0, -PROJECT_OVERVIEW_SUFFIX.length) : ''
}

/** Group every file living under a project folder by that folder, for Project.files. */
function indexProjectFiles(domain: DomainCollection): Map<string, string[]> {
  const filesByProjectDir = new Map<string, string[]>()
  const projectDirs = domain
    .entriesByType('project')
    .map(({ path }) => projectDirOf(path))
    .filter(Boolean)

  for (const p of domain.paths) {
    if (!p.includes('/projects/') || p.endsWith(PROJECT_OVERVIEW_SUFFIX)) continue
    const dir = projectDirs.find((d) => p.startsWith(`${d}/`))
    if (dir) {
      const list = filesByProjectDir.get(dir) ?? []
      list.push(p)
      filesByProjectDir.set(dir, list)
    }
  }
  return filesByProjectDir
}

export function docToProject(doc: Document, path: string, files: string[] = []) {
  return {
    name: getStringField(doc, 'name'),
    status: getStringField(doc, 'status', 'open'),
    closedReason: getOptionalStringField(doc, 'closed-reason'),
    ...docBase(doc, path),
    files,
  }
}

export default {
  type: 'project',
  matches: (doc, filter, path, ctx) => matchesProjectFilter(doc, filter, ctx.resolveNames),
  mapper: (ctx) => {
    // Built once per resolver set (i.e. per store version), like the day index.
    const filesByProjectDir = indexProjectFiles(ctx.domain)
    return perRow((doc, path) => docToProject(doc, path, filesByProjectDir.get(projectDirOf(path)) ?? []))
  },
} satisfies EntitySpec<ProjectFilter, ReturnType<typeof docToProject>>
