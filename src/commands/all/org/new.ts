import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_ORGS } from '#config'
import { createNumberedFile } from '#lib/nbfs/createNumberedFile.ts'
import { nameToFileStem, organizationDir, organizationDocument, pathHostileCategory } from './lib/document.ts'
import type { OrganizationDraft } from './lib/document.ts'
import { draftOrganization } from './lib/draft.ts'
import { existingOrganization } from './lib/existing.ts'
import { webFetch, type WebFetchResult } from './lib/webFetch.ts'

const params = {
  name: Arg.string('Organization name (optional with --site: detected from the website)', { optional: true }),
  site: Flag.string('Organization website for enrichment; the name source when no name is given'),
  wikipedia: Flag.string('Wikipedia search query or exact article title', { short: 'p' }),
  noWikipedia: Flag.bool('Skip Wikipedia enrichment'),
  sector: Flag.string('Force specific sector', { short: 's' }),
  subcategory: Flag.string('Force specific subcategory', { short: 'c' }),
}

type Params = InferParams<typeof params>
type Result = { filePath: string }

export default class OrgNewTask extends Command {
  static override description: CommandDescription = {
    name: 'org:new',
    description: 'Create new organization with AI-assisted categorization',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { site, noWikipedia } = args

    // Fetched up front when the site must yield the name; reused for
    // categorization below so the site is never fetched twice.
    let prefetchedSite: WebFetchResult | undefined

    let name = args.name
    if (!name) {
      if (!site) {
        output.error('Provide an organization name, or --site to detect the name from the website')
        return CommandResult.error(new Error('missing name: pass a name argument or --site'))
      }
      output.log(`Detecting organization name from site: ${site}`)
      try {
        prefetchedSite = await webFetch(site)
      } catch (error) {
        // Unlike the enrichment fetch below, there is no name to fall back on
        output.error(`Site fetch failed: ${(error as Error).message}`)
        return CommandResult.error(error as Error)
      }
      name = prefetchedSite.name
      output.log(`${colors.bold('Detected name:')} ${name}`)
    }

    output.log(`Creating organization: ${name}`)

    // Generate slug and filename from name
    const stem = nameToFileStem(name)
    const slug = stem.toLowerCase().replace(/^-|-$/g, '')

    // Two organizations never share a name, as a name or an alternate one. Check as soon
    // as the name is known, before spending on further enrichment calls.
    const existing = await existingOrganization(DIR_ORGS, name)
    if (existing) {
      output.error(`An organization named ${name} already exists: ${existing}`)
      output.error('Open it, or give the new one a name of its own.')
      return CommandResult.error(new Error(`organization already exists: ${existing}`))
    }

    // Fetch from multiple sources and categorize using AI (skipped when both are forced)
    let draft: OrganizationDraft
    try {
      draft = await draftOrganization(DIR_ORGS, {
        name,
        site,
        // Use Wikipedia flag if provided, otherwise default to org name (unless --no-wikipedia is set)
        wikipedia: noWikipedia ? false : args.wikipedia,
        sector: args.sector,
        subcategory: args.subcategory,
        prefetchedSite,
        log: (line) => output.log(line),
      })
    } catch (error) {
      output.error(`Failed to fetch/categorize: ${(error as Error).message}`)
      return CommandResult.error(error as Error)
    }

    // Sector and subcategory become directory names — refuse anything path-hostile
    const hostile = pathHostileCategory(draft)
    if (hostile) {
      output.error(`Invalid ${hostile.label} "${hostile.value}" — expected letters, digits, and hyphens`)
      return CommandResult.error(new Error(`invalid ${hostile.label}: ${hostile.value}`))
    }

    // A file of that name for another organization gets -2, -3…; nothing is overwritten
    const content = organizationDocument(draft).toMarkdown()
    const filePath = await createNumberedFile(organizationDir(DIR_ORGS, draft), stem, content)

    output.log('\n' + colors.bold(colors.magenta('Name:')) + ' ' + name)
    output.log(colors.bold(colors.magenta('Slug:')) + ' ' + slug)
    output.log(colors.bold(colors.magenta('Sector:')) + ' ' + draft.sector)
    output.log(colors.bold(colors.magenta('Subcategory:')) + ' ' + draft.subcategory)
    if (draft.site) {
      output.log(colors.bold(colors.magenta('Site:')) + ' ' + draft.site)
    }
    output.log(colors.bold(colors.magenta('File:')) + ' ' + filePath)
    output.log('')

    // Open in editor
    openEditor([{ file: filePath }])
    await delay(500)

    return CommandResult.success({ filePath })
  }
}
