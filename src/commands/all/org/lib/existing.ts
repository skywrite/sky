import OrgStore, { altNames } from '#shared/models/Store/OrgStore/mod.ts'
import { orgNameKey } from './name.ts'

/** The file of the organization that already goes by `name`, as its name or an alternate one. */
export async function existingOrganization(orgsDir: string, name: string): Promise<string | undefined> {
  const key = orgNameKey(name)
  for (const { doc, path } of (await OrgStore.build([orgsDir])).getAll().toArray())
    if ([doc.name, ...altNames(doc)].some((other) => orgNameKey(other) === key)) return path
  return undefined
}
