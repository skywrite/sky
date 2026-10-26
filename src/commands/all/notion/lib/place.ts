import type { NotionClient, NotionParent } from '#lib/notion/mod.ts'

/** Where a new page goes, said in words for the report, and the title column when it is a table's row. */
export type Place = { parent?: NotionParent; where: string; titleColumn?: string }

/** What placing needs of the client: what a link points at, and the teamspaces by name. */
export type Finder = Pick<NotionClient, 'target' | 'teamspaces'>

const REF = /^(https?|collection):\/\/|^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether the words are a Notion link or id, rather than a teamspace's name. */
export const isNotionRef = (text: string): boolean => REF.test(text.trim())

/**
 * Where a new page goes. A page's link or id makes it a sub-page, a table's
 * link makes it a row, and other words name the teamspace whose top it goes
 * at. Nothing makes it a private page. A failure is a sentence for the person.
 */
export async function placeFor(notion: Finder, parent: string | undefined): Promise<Place | string> {
  const text = parent?.trim()
  if (!text) return { where: 'as a private page' }
  if (!isNotionRef(text)) return teamspacePlace(notion, text)

  const target = await notion.target(text)
  if (target.kind === 'page') return { parent: { page: target.id }, where: `under “${target.title ?? 'the page'}”` }
  if (target.kind === 'other')
    return `That link is not a Notion page or table${target.title ? ` (“${target.title}”)` : ''}.`

  const name = target.title ?? 'the table'
  const [source, ...more] = target.dataSources
  if (!source) return `Notion did not say where rows of “${name}” go.`
  if (more.length > 0) {
    const sources = target.dataSources.map((one) => `collection://${one.id}`).join(', ')
    return `“${name}” has more than one data source. Pass the one the row belongs in: ${sources}.`
  }
  return {
    parent: { dataSource: source.id },
    where: `as a row in “${name}”`,
    ...(source.titleColumn ? { titleColumn: source.titleColumn } : {}),
  }
}

/** The top of the teamspace the words name: an exact name over a partial one, the person's own over others. */
async function teamspacePlace(notion: Finder, name: string): Promise<Place | string> {
  const found = await notion.teamspaces(name)
  const exact = found.filter((team) => team.name.toLowerCase() === name.toLowerCase())
  const candidates = exact.length > 0 ? exact : found
  const joined = candidates.filter((team) => team.joined)
  const picks = joined.length > 0 ? joined : candidates
  const [team] = picks
  if (team && picks.length === 1)
    return { parent: { teamspace: team.id }, where: `at the top of the ${team.name} teamspace` }
  if (picks.length > 1)
    return `More than one teamspace matches “${name}”: ${picks.map((one) => one.name).join(', ')}. Say which one.`

  const yours = (await notion.teamspaces()).filter((one) => one.joined).map((one) => one.name)
  const listed = yours.length > 0 ? ` Teamspaces you are in include ${yours.join(', ')}.` : ''
  return `No teamspace is named “${name}”.${listed} To put it under a page instead, pass the page’s link.`
}
