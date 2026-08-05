import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { exists, outputFile, readTextFile, walk } from '#shared/fs/mod.ts'
import PersonDocument from '#shared/models/Person/mod.ts'
import { generatePersonHierarchyPath } from '../new.ts'

const params = {
  search: ArgOrFlag.string('Person filename or path to search for (case-insensitive)', {
    short: 's',
    required: true,
  }),
  year: Flag.number('Year for the new hierarchy (defaults to met year or current year)', { short: 'y' }),
}

type Params = InferParams<typeof params>
type Result = { source: string; destination: string; personName: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'person:move': { params: Params; result: Result }
  }
}

export default class PersonMoveTask extends Command {
  static override description: CommandDescription = {
    name: 'person:move',
    description: 'Move person from people-old/ to people/ directory structure.',
    usage: [
      'sky person:move "John Smith"              # Search by name',
      'sky person:move --search "2023/"          # Search by path pattern',
      'sky person:move "Jane" --year 2024        # Override destination year',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { search, year } = args

    if (!search) {
      output.error('No search term provided')
      return CommandResult.fail('Search term is required')
    }

    // Normalize search term - remove .md extension, convert spaces to hyphens, normalize path separators
    const searchTerm = search.replace(/\.md$/i, '').replace(/\s+/g, '-').toLowerCase()
    const peopleOldDir = <string>config.DIR_PEOPLE_OLD
    const peopleDir = <string>config.DIR_PEOPLE

    output.log(`Searching for "${search}" in ${peopleOldDir}...`)

    const matches = await searchPersonFiles(searchTerm, peopleOldDir)
    if (matches.length === 0) {
      output.error(`No person files found matching "${search}"`)
      return CommandResult.fail('No matching files found')
    }

    if (matches.length > 1) {
      output.log('\nMultiple matches found:')
      matches.forEach((match, index) => {
        const relativePath = path.relative(peopleOldDir, match)
        output.log(`  ${index + 1}. ${relativePath}`)
      })
      output.error('\nPlease be more specific with your search term')
      return CommandResult.fail('Multiple matches found')
    }

    const sourceFile = matches[0]
    const relativePath = path.relative(peopleOldDir, sourceFile)
    output.log(`Found: ${relativePath}`)

    const fileContent = await readTextFile(sourceFile)
    const personData = PersonDocument.fromMarkdown(fileContent)

    // Generate the new directory path based on person's name
    // Fallback to filename if person has no name
    const personName = personData.name || path.basename(sourceFile, '.md')
    // Use provided year, or fall back to met date year if available
    const effectiveYear = year ?? personData.met?.year
    const hierarchyPath = generatePersonHierarchyPath(personName, effectiveYear)
    const destDir = path.join(peopleDir, hierarchyPath)

    // Prefer keeping the original filename if no collision
    const originalFilename = path.basename(sourceFile)
    const slugFilename = `${personData.slugPreserveCase}.md`

    let destFile: string
    const originalDest = path.join(destDir, originalFilename)
    const slugDest = path.join(destDir, slugFilename)

    if (!(await exists(originalDest))) {
      // Original filename works - use it
      destFile = originalDest
    } else if (originalFilename !== slugFilename && !(await exists(slugDest))) {
      // Original exists, but slug-based name is available
      destFile = slugDest
    } else {
      // Both exist - add counter to slug-based name
      destFile = slugDest
      let fileCounter = 2
      while (await exists(destFile)) {
        destFile = path.join(destDir, `${personData.slugPreserveCase}-${fileCounter}.md`)
        fileCounter++
      }
    }

    // Write the person model to new location
    const updatedPerson = personData.ensureUpdated()
    const markdown = updatedPerson.toMarkdown()
    await outputFile(destFile, markdown)

    // Delete the original file
    await rm(sourceFile)

    openEditor([{ file: destFile }])
    await delay(500)

    const newRelativePath = path.relative(peopleDir, destFile)
    output.log(`\n  Successfully moved to: people/${newRelativePath}\n`)
    return CommandResult.success({
      source: sourceFile,
      destination: destFile,
      personName,
    })
  }
}

async function searchPersonFiles(searchTerm: string, peopleDir: string): Promise<string[]> {
  const matches: string[] = []

  for await (const entry of walk(peopleDir, {
    exts: ['.md'],
    includeDirs: false,
  })) {
    const relativePath = path.relative(peopleDir, entry.path)
    const normalizedPath = relativePath.toLowerCase()

    if (normalizedPath.includes(searchTerm) || path.basename(normalizedPath, '.md').includes(searchTerm)) {
      matches.push(entry.path)
    }
  }

  return matches
}
