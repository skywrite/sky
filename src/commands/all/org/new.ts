import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { webFetch } from './_webFetch.ts'
import { getWikipediaArticleAI } from './_wikipedia.ts'
import { categorizeOrganization } from './_categorize.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import openEditor from 'open-editor'
import { setTimeout as delay } from 'node:timers/promises'
import { DIR_ORGS } from '#config'
import colors from 'picocolors'
import OrganizationDocument from '#shared/models/Organization/mod.ts'
import outputFile from '#shared/fs/outputFile.ts'

const params = {
  name: Arg.string('Organization name to use (not auto-detected)', { required: true }),
  site: Flag.string('Organization website for enrichment'),
  wikipedia: Flag.string('Wikipedia search query or exact article title', { short: 'p' }),
  noWikipedia: Flag.boolean('Skip Wikipedia enrichment'),
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
    const { name, site, noWikipedia } = args
    const wikipediaQueryArg = args.wikipedia
    const forcedSector = args.sector
    const forcedSubcategory = args.subcategory

    // Use Wikipedia flag if provided, otherwise default to org name (unless --no-wikipedia is set)
    const wikipediaQuery = noWikipedia ? undefined : (wikipediaQueryArg ?? name)

    output.log(`Creating organization: ${name}`)

    let sector: string
    let subcategory: string
    let normalizedSite: string | undefined
    let description: string | undefined
    let ticker: string | undefined
    let kind: 'company' | 'government' | 'nonprofit' | 'unknown' = 'unknown'
    let wikipediaResult: Awaited<ReturnType<typeof import('./_wikipedia.ts').getWikipediaArticleAI>> | undefined

    // Normalize site URL if provided (always, regardless of forced categorization)
    if (site) {
      const { normalizeUrl } = await import('#shared/universal/urls/normalize.ts')
      normalizedSite = normalizeUrl(site)
    }

    // If both sector and subcategory are forced, skip AI categorization
    if (forcedSector && forcedSubcategory) {
      sector = forcedSector
      subcategory = forcedSubcategory
      output.log(`Using forced categorization: ${sector}/${subcategory}`)
    } else {
      // Fetch from multiple sources and categorize using AI
      try {
        let webFetchResult

        // Fetch site if provided
        if (site) {
          output.log(`Fetching site: ${site}`)
          webFetchResult = await webFetch(site)
          normalizedSite = webFetchResult.website
          output.log(`Site summary: ${webFetchResult.summary}`)
        }

        // Fetch Wikipedia (skip if --no-wikipedia flag is set)
        if (wikipediaQuery) {
          output.log(`Fetching Wikipedia: ${wikipediaQuery}`)
          try {
            wikipediaResult = await getWikipediaArticleAI(wikipediaQuery, {
              orgName: name,
              website: normalizedSite,
              fullContent: true, // Get full article content for better categorization and ticker extraction
            })
            output.log(`Wikipedia article: ${wikipediaResult.article.title}`)
            output.log(`Wikipedia confidence: ${wikipediaResult.confidence}`)
            output.log(`Selection reasoning: ${wikipediaResult.reasoning}`)
          } catch (wikiError) {
            output.log(`Wikipedia not found for "${wikipediaQuery}", continuing without it`)
          }
        } else {
          output.log('Skipping Wikipedia enrichment (--no-wikipedia flag set)')
        }

        // Load taxonomy
        const taxonomyPath = new URL('./_taxonomy.md', import.meta.url).pathname
        const taxonomyInfo = await readFile(taxonomyPath, 'utf-8')

        // Categorize with all available sources
        output.log('Categorizing with AI...')
        const categorization = await categorizeOrganization(taxonomyInfo, {
          webFetch: webFetchResult,
          wikipedia: wikipediaResult,
        })

        sector = forcedSector || categorization.sector
        subcategory = forcedSubcategory || categorization.subcategory
        kind = categorization.kind
        ticker = categorization.ticker
        description = categorization.description

        // Use website from categorizer if not already set
        if (!normalizedSite && categorization.website) {
          const { normalizeUrl } = await import('#shared/universal/urls/normalize.ts')
          normalizedSite = normalizeUrl(categorization.website)
          output.log(`${colors.bold('Website:')} ${normalizedSite}`)
        }

        // Highlight new category suggestions
        if (categorization.isNewCategory) {
          output.log(`${colors.bold(colors.yellow('✨ NEW CATEGORY SUGGESTED:'))} ${sector}/${subcategory}`)
          if (categorization.categoryReasoning) {
            output.log(`${colors.bold(colors.yellow('Reasoning:'))} ${categorization.categoryReasoning}`)
          }
        } else {
          output.log(`${colors.bold('Categorized as:')} ${sector}/${subcategory}`)
        }

        output.log(`${colors.bold('Confidence:')} ${categorization.confidence}`)
        output.log(`${colors.bold('Kind:')} ${kind}`)
        if (ticker) {
          output.log(`${colors.bold('Ticker:')} ${ticker}`)
        }
        if (description) {
          output.log(`${colors.bold('Description:')} ${description}`)
        }
      } catch (error) {
        output.error(`Failed to fetch/categorize: ${(error as Error).message}`)
        return CommandResult.error(error as Error)
      }
    }

    // Generate slug and filename from name
    const slug = name
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    const filename =
      name
        .replace(/&/g, 'and')
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-') + '.md'

    // Create organization (include description temporarily for template generation)
    const yamlData: Record<string, unknown> = {
      name,
      slug,
      site: normalizedSite,
      sector,
      subcategory,
      description, // Used for markdown template, will be removed from YAML
    }

    // Add ticker if available
    if (ticker) {
      yamlData.ticker = ticker
    }

    // Create organization and set kind
    let org = OrganizationDocument.create(yamlData)
    org = org.setKind(kind)

    // Add Wikipedia article URL to rel if available
    if (wikipediaResult) {
      org = org.addRel(wikipediaResult.article.url)
    }

    // Remove description from YAML (keep it only in markdown)
    // We need to reconstruct the org with the filtered yaml
    const finalYaml = { ...org.yaml }
    delete finalYaml.description
    org = new OrganizationDocument(finalYaml, org.markdown)

    const filePath = join(DIR_ORGS, sector, subcategory, filename)

    // Write file (outputFile handles directory creation)
    const content = org.toMarkdown()
    await outputFile(filePath, content)

    output.log('\n' + colors.bold(colors.magenta('Name:')) + ' ' + name)
    output.log(colors.bold(colors.magenta('Slug:')) + ' ' + slug)
    output.log(colors.bold(colors.magenta('Sector:')) + ' ' + sector)
    output.log(colors.bold(colors.magenta('Subcategory:')) + ' ' + subcategory)
    if (normalizedSite) {
      output.log(colors.bold(colors.magenta('Site:')) + ' ' + normalizedSite)
    }
    output.log(colors.bold(colors.magenta('File:')) + ' ' + filePath)
    output.log('')

    // Open in editor
    openEditor([{ file: filePath }])
    await delay(500)

    return CommandResult.success({ filePath })
  }
}
