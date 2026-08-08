import * as path from 'node:path'
import colors from 'picocolors'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { MarkdownStore } from '#shared/models/Store/mod.ts'
import type { StoreError, StoreWarning } from '#shared/models/Store/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  resolve: Flag.string('Test resolving any string (person, org, URL, or time ref)', {
    short: 'r',
    optional: true,
  }),
  year: Flag.number('Year context for time refs (e.g., -y 2025)', {
    short: 'y',
    optional: true,
  }),
  month: Flag.number('Month context for time refs (e.g., -m 1)', {
    short: 'm',
    optional: true,
  }),
  verbose: Flag.bool('Show all loaded names', {
    short: 'v',
    default: false,
  }),
  warnings: Flag.bool('Show warnings (files with issues)', {
    short: 'w',
    default: false,
  }),
}

type Params = InferParams<typeof params>

type Result = {
  people: { total: number; names: number; errors: number; warnings: number }
  orgs: { total: number; names: number; errors: number; warnings: number }
  time: { total: number; errors: number; warnings: number }
  errors: StoreError[]
  warnings: StoreWarning[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'markdown:store:test': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class MarkdownStoreTestTask extends Command {
  static override description: CommandDescription = {
    name: 'markdown:store:test',
    description: 'Test MarkdownStore by loading all people, orgs, and time docs.',
    descriptionLong: [
      'Builds the MarkdownStore by walking people, org, and time directories.',
      'Reports stats on loaded entities and any parse errors encountered.',
      '',
      'Use -r/--resolve to test resolution of any string type:',
      '  - Person names (e.g., "Jane Smith")',
      '  - Organization names (e.g., "Anthropic")',
      '  - URLs (e.g., "https://example.com")',
      '  - Time refs with -y/-m context (e.g., "01-15/meeting" -y 2025)',
    ],
    usage: [
      'sky markdown:store:test                           # Load store, show stats',
      'sky markdown:store:test -r "Jane Smith"        # Resolve a person',
      'sky markdown:store:test -r "https://foo.com"      # Resolve a URL',
      'sky markdown:store:test -r "01-15/meeting" -y 2025 # Resolve a time ref',
      'sky markdown:store:test --warnings                # Show files with issues',
      'sky markdown:store:test --verbose                 # Show all loaded names',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { resolve: resolveName, year, month, verbose, warnings: showWarnings } = args

    output.log(colors.cyan('Building MarkdownStore...\n'))

    const startTime = Date.now()

    const store = await MarkdownStore.build({
      peopleDirs: [config.DIR_PEOPLE as string, config.DIR_PEOPLE_OLD as string],
      orgDirs: [config.DIR_ORGS as string],
      decisionsDir: config.DIR_DECISIONS as string,
      timeDirs: [config.DIR_TIME as string],
    })

    const elapsed = Date.now() - startTime

    // Collect all errors and warnings
    const allErrors = [...store.people.errors, ...store.orgs.errors, ...store.time.errors]
    const allWarnings = [...store.people.warnings, ...store.orgs.warnings, ...store.time.warnings]

    // Gather stats
    const stats: Result = {
      people: {
        total: store.people.size,
        names: store.people.names.length,
        errors: store.people.errors.length,
        warnings: store.people.warnings.length,
      },
      orgs: {
        total: store.orgs.size,
        names: store.orgs.names.length,
        errors: store.orgs.errors.length,
        warnings: store.orgs.warnings.length,
      },
      time: {
        total: store.time.size,
        errors: store.time.errors.length,
        warnings: store.time.warnings.length,
      },
      errors: allErrors,
      warnings: allWarnings,
    }

    // Output stats
    output.log(colors.green(`Loaded in ${elapsed}ms\n`))

    output.log(colors.white('People:'))
    output.log(`  ${colors.gray('Files:')} ${stats.people.total}`)
    output.log(`  ${colors.gray('Names indexed:')} ${stats.people.names} (includes aliases)`)
    if (stats.people.warnings > 0) {
      output.log(`  ${colors.yellow('Warnings:')} ${stats.people.warnings}`)
    }
    if (stats.people.errors > 0) {
      output.log(`  ${colors.red('Errors:')} ${stats.people.errors}`)
    }
    output.log('')

    output.log(colors.white('Organizations:'))
    output.log(`  ${colors.gray('Files:')} ${stats.orgs.total}`)
    output.log(`  ${colors.gray('Names indexed:')} ${stats.orgs.names}`)
    if (stats.orgs.warnings > 0) {
      output.log(`  ${colors.yellow('Warnings:')} ${stats.orgs.warnings}`)
    }
    if (stats.orgs.errors > 0) {
      output.log(`  ${colors.red('Errors:')} ${stats.orgs.errors}`)
    }
    output.log('')

    output.log(colors.white('Time:'))
    output.log(`  ${colors.gray('Files:')} ${stats.time.total}`)
    if (stats.time.warnings > 0) {
      output.log(`  ${colors.yellow('Warnings:')} ${stats.time.warnings}`)
    }
    if (stats.time.errors > 0) {
      output.log(`  ${colors.red('Errors:')} ${stats.time.errors}`)
    }
    output.log('')

    // Output warnings (only if --warnings flag is set)
    if (showWarnings && allWarnings.length > 0) {
      output.log(colors.yellow(`Warnings (${allWarnings.length}):\n`))
      for (const warn of allWarnings) {
        const relativePath = path.relative(config.DIR_BASE as string, warn.path)
        output.log(`  ${colors.yellow(relativePath)}`)
        output.log(`    ${colors.gray(warn.warning)}`)
      }
      output.log('')
    }

    // Output errors
    if (allErrors.length > 0) {
      output.log(colors.red(`Errors (${allErrors.length}):\n`))
      for (const err of allErrors) {
        const relativePath = path.relative(config.DIR_BASE as string, err.path)
        output.log(`  ${colors.red(relativePath)}`)
        output.log(`    ${colors.gray(err.error)}`)
      }
      output.log('')
    }

    // Verbose: show all names
    if (verbose) {
      output.log(colors.cyan('People names:'))
      for (const name of store.people.names.sort()) {
        output.log(`  ${name}`)
      }
      output.log('')

      output.log(colors.cyan('Organization names:'))
      for (const name of store.orgs.names.sort()) {
        output.log(`  ${name}`)
      }
      output.log('')
    }

    // Test resolution if requested
    if (resolveName) {
      output.log(colors.cyan(`Resolving: "${resolveName}"\n`))
      if (year || month) {
        output.log(`  ${colors.gray('Context:')} year=${year ?? 'none'}, month=${month ?? 'none'}`)
      }

      const ref = store.resolve(resolveName, { year, month })

      switch (ref.type) {
        case 'person': {
          output.log(colors.green(`  Type: person`))
          output.log(`  ${colors.gray('Path:')} ${ref.path}`)
          output.log(`  ${colors.gray('Name:')} ${ref.value.name}`)
          output.log(`  ${colors.gray('All names:')} ${ref.value.names.join(', ')}`)
          if (ref.value.org) {
            output.log(`  ${colors.gray('Org:')} ${ref.value.org}`)
          }
          break
        }
        case 'org': {
          output.log(colors.green(`  Type: organization`))
          output.log(`  ${colors.gray('Path:')} ${ref.path}`)
          output.log(`  ${colors.gray('Name:')} ${ref.value.name}`)
          if (ref.value.slug) {
            output.log(`  ${colors.gray('Slug:')} ${ref.value.slug}`)
          }
          break
        }
        case 'url': {
          output.log(colors.blue(`  Type: url`))
          output.log(`  ${colors.gray('Href:')} ${ref.value.href}`)
          output.log(`  ${colors.gray('Host:')} ${ref.value.host}`)
          break
        }
        case 'document': {
          output.log(colors.green(`  Type: document`))
          output.log(`  ${colors.gray('Path:')} ${ref.path}`)
          const title = ref.value.yaml['title'] ?? '(no title)'
          output.log(`  ${colors.gray('Title:')} ${title}`)
          if (ref.value.yaml['who']) {
            output.log(`  ${colors.gray('Who:')} ${ref.value.yaml['who']}`)
          }
          if (ref.value.rel.size > 0) {
            output.log(`  ${colors.gray('Rel:')} ${[...ref.value.rel].join(', ')}`)
          }
          break
        }
        case 'unresolved': {
          output.log(colors.yellow(`  Type: unresolved`))
          output.log(colors.gray(`  Could not resolve "${resolveName}"`))
          break
        }
      }
      output.log('')
    }

    return CommandResult.success(stats)
  }
}
