import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import { exists, outputFile } from '#shared/fs/mod.ts'
import { slugify } from '#lib/string/mod.ts'
import latinize from '#lib/string/latinize.ts'
import PersonDocument from '#shared/models/Person/mod.ts'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { parsePartialDate } from '#commands/lib/args/parsePartialDate.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

// -----------------------------------------------------------------------------
// Exported Helpers
// -----------------------------------------------------------------------------

/**
 * Generate the directory path for a person based on their first name
 * Uses year/first-two-letters-of-first-name pattern with underscore padding
 */
export function generatePersonHierarchyPath(personName: string, year?: number): string {
  const currentYear = year ?? new Date().getFullYear()

  // Parse the name to get the first name
  const nameParts = personName.trim().split(/\s+/)
  const firstName = nameParts[0] || ''

  // Latinize and create directory path
  const firstNameLatin = latinize(firstName).toLowerCase()

  // Create 2-letter directory name with underscore padding if needed
  let dirName: string
  if (firstNameLatin.length >= 2) {
    dirName = firstNameLatin.substring(0, 2)
  } else if (firstNameLatin.length === 1) {
    dirName = firstNameLatin + '_'
  } else {
    dirName = '__' // Fallback for empty names
  }

  // Build the directory path: year/first-two-letters/
  return path.join(String(currentYear), dirName)
}

const params = {
  name: ArgOrFlag.string("Person's full name", { short: 'n', required: true }),
  met: Flag.plainDate('Date met (partial or full: 27, 8-27, 2025-08-27)', {
    short: 'm',
    parse: (input) => parsePartialDate(input),
    default: () => new PlainDate(),
  }),
  org: Flag.string('Organization (sets orgs.current)', { short: 'o' }),
  year: Flag.number('Year folder to place the file in (e.g., 2025)', { short: 'y' }),
  path: Flag.string('Path to place file (overrides auto-generated path)', { short: 'p' }),
}

type Params = InferParams<typeof params>
type Result = { filePath: string; personName: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'person:new': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class PersonNewTask extends Command {
  static override description: CommandDescription = {
    name: 'person:new',
    description: 'Create new person.',
    descriptionLong: [
      'Creates a new person file in the people/ directory.',
      'Files are organized by year and first two letters of the first name.',
    ],
    usage: [
      'sky person:new "John Smith"              # Create with default met date (today)',
      'sky person:new "Jane Doe" --met 15       # Met on 15th of current month',
      'sky person:new "Bob Lee" --org "Acme"    # Set current organization',
      'sky person:new "Amy Wu" --year 2024      # Place in 2024/ directory',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { name, met, org, year, path: pathStr } = args

    if (!name) {
      return CommandResult.fail('Name is required')
    }

    const personName = name
    const personSlug = slugify(personName, { preserveCase: true })

    // Generate the hierarchy path using the extracted function
    const hierarchyPath = generatePersonHierarchyPath(personName, year)

    // Use custom path if provided, otherwise use the generated hierarchy
    const finalPath = pathStr ?? hierarchyPath

    const peopleDir = <string>config.DIR_PEOPLE
    let personFile = path.join(peopleDir, finalPath, `${personSlug}.md`)

    // Handle collisions
    let fileCounter = 2
    const baseFile = personFile
    while (await exists(personFile)) {
      const baseName = path.basename(baseFile, '.md')
      const dir = path.dirname(baseFile)
      personFile = path.join(dir, `${baseName}-${fileCounter}.md`)
      fileCounter++
    }

    // Build YAML in preferred field order: name, location, orgs, email, sites, created, updated, met, tags
    const personYaml: Record<string, unknown> = {
      name: personName,
      location: null,
    }

    if (org) {
      personYaml.orgs = { current: [org] }
    }

    personYaml.email = { personal: null, business: null }
    personYaml.sites = null
    // created/updated are added by PersonDocument.create()
    personYaml.met = met.ymd
    personYaml.tags = null

    const person = PersonDocument.create(personYaml)
    const personMarkdown = person.toMarkdown()

    await outputFile(personFile, personMarkdown)

    openEditor([{ file: personFile, line: personMarkdown.split('\n').length }])
    await delay(500)

    output.log(`\n  Successfully created ${personFile}.\n`)

    return CommandResult.success({ filePath: personFile, personName })
  }
}
