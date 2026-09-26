import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import { parsePartialDate } from '#commands/lib/args/parsePartialDate.ts'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { createNumberedFile } from '#lib/nbfs/createNumberedFile.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { generatePersonHierarchyPath, newPersonMarkdown, personFileStem } from './lib/create.ts'

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

    // Use custom path if provided, otherwise year/first-two-letters of the first name
    const finalPath = pathStr ?? generatePersonHierarchyPath(personName, year)
    const peopleDir = <string>config.DIR_PEOPLE

    const personMarkdown = newPersonMarkdown({
      name: personName,
      met: met.ymd,
      created: new PlainDate().ymd,
      orgs: org ? { current: [org] } : undefined,
    })

    // A namesake gets -2, -3…; an existing file is never overwritten
    const personFile = await createNumberedFile(
      path.join(peopleDir, finalPath),
      personFileStem(personName),
      personMarkdown,
    )

    openEditor([{ file: personFile, line: personMarkdown.split('\n').length }])
    await delay(500)

    output.log(`\n  Successfully created ${personFile}.\n`)

    return CommandResult.success({ filePath: personFile, personName })
  }
}
