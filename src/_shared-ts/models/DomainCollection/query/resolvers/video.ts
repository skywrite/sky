import type { Document } from '#shared/models/Markdown/mod.ts'
import VideoDocument from '#shared/models/Video/mod.ts'
import { matchesContains, matchesExact } from '../filters/mod.ts'
import {
  type DatedFilter,
  type EntitySpec,
  type InvolvesFilter,
  type MappedDay,
  type NameResolver,
  type TagFilter,
  type TextFilter,
  docBase,
  getDateForDocument,
  getOptionalStringField,
  getStringField,
  matchesDatedFilter,
  matchesInvolvesFilter,
  matchesTagFilter,
  matchesTextFilter,
  perRow,
} from './shared.ts'

export interface VideoFilter extends DatedFilter, TagFilter, TextFilter, InvolvesFilter {
  from?: string
  fromNot?: string
  fromContains?: string
  to?: string
  toNot?: string
  toContains?: string
  toNotContains?: string
  medium?: string
  summaryContains?: string
}

export function matchesVideoFilter(
  doc: Document,
  filter: VideoFilter,
  path?: string,
  resolveNames?: NameResolver,
): boolean {
  if (!matchesDatedFilter(doc, filter, path)) return false
  // Exact from/to mirror MessageFilter: the selector transpiler turns `video[from="X"]`
  // into `from:` (and `:not([from="X"])` into `fromNot:`), so these must exist or the
  // generated query fails schema validation before it ever runs.
  if (filter.from && !matchesExact(doc, 'from', filter.from)) return false
  if (filter.fromNot && matchesExact(doc, 'from', filter.fromNot)) return false
  if (filter.fromContains && !matchesContains(doc, 'from', filter.fromContains)) return false
  if (filter.to && !matchesExact(doc, 'to', filter.to)) return false
  if (filter.toNot && matchesExact(doc, 'to', filter.toNot)) return false
  if (filter.toContains && !matchesContains(doc, 'to', filter.toContains)) return false
  if (filter.toNotContains && matchesContains(doc, 'to', filter.toNotContains)) return false
  if (filter.medium && !matchesExact(doc, 'medium', filter.medium)) return false
  if (filter.summaryContains && !matchesContains(doc, 'summary', filter.summaryContains)) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesTextFilter(doc, filter)) return false
  if (!matchesInvolvesFilter(doc, filter, resolveNames)) return false
  return true
}

export function docToVideo(doc: Document, path: string, day: MappedDay | null = null) {
  // The scanner yields plain Documents, so re-wrap to read the nested `video.url`
  // shape through the model rather than duplicating its layout here.
  const url = new VideoDocument(doc.yaml, doc.markdown).videoUrl

  return {
    from: getOptionalStringField(doc, 'from'),
    to: getOptionalStringField(doc, 'to'),
    when: getStringField(doc, 'when'),
    medium: getStringField(doc, 'medium', 'Video'),
    summary: getOptionalStringField(doc, 'summary'),
    url: url ?? null,
    date: getDateForDocument(doc, path) ?? '',
    day,
    ...docBase(doc, path),
  }
}

export default {
  type: 'video',
  sortByDate: true,
  matches: (doc, filter, path, ctx) => matchesVideoFilter(doc, filter, path, ctx.resolveNames),
  mapper: (ctx) => perRow((doc, path) => docToVideo(doc, path, ctx.dayFor(doc, path))),
} satisfies EntitySpec<VideoFilter, ReturnType<typeof docToVideo>>
