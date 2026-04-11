import * as path from 'node:path'
import colors from 'picocolors'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { MarkdownStore } from '#shared/models/Store/mod.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  warnings: Flag.boolean('Show warning details', { short: 'w', default: false }),
}

type Params = InferParams<typeof params>

type Result = {
  loadTimeMs: number
  people: number
  orgs: number
  time: number
  errors: number
  warnings: number
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'markdown:store-performance': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class MarkdownStorePerformanceTask extends Command {
  static override description: CommandDescription = {
    name: 'markdown:store-performance',
    description: 'Measure MarkdownStore load time.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { warnings: showWarnings } = args

    output.log(colors.cyan('Loading MarkdownStore...'))

    const startTime = performance.now()

    const store = await MarkdownStore.buildFromAll()

    const loadTimeMs = performance.now() - startTime

    const allErrors = [...store.people.errors, ...store.orgs.errors, ...store.time.errors]
    const allWarnings = [...store.people.warnings, ...store.orgs.warnings, ...store.time.warnings]

    output.log(colors.green(`\nLoaded in ${loadTimeMs.toFixed(1)}ms`))
    output.log(colors.gray(`  People:   ${store.people.size}`))
    output.log(colors.gray(`  Orgs:     ${store.orgs.size}`))
    output.log(colors.gray(`  Time:     ${store.time.size}`))
    if (allErrors.length > 0) {
      output.log(colors.red(`  Errors:   ${allErrors.length}`))
    }
    if (allWarnings.length > 0) {
      output.log(colors.yellow(`  Warnings: ${allWarnings.length}`))
    }

    if (allErrors.length > 0) {
      output.log(colors.red(`\nErrors:`))
      for (const err of allErrors) {
        const relativePath = path.relative(config.DIR_BASE as string, err.path)
        output.log(`  ${colors.red(relativePath)}`)
        output.log(`    ${colors.gray(err.error)}`)
      }
    }

    if (showWarnings && allWarnings.length > 0) {
      output.log(colors.yellow(`\nWarnings:`))
      for (const warn of allWarnings) {
        const relativePath = path.relative(config.DIR_BASE as string, warn.path)
        output.log(`  ${colors.yellow(relativePath)}`)
        output.log(`    ${colors.gray(warn.warning)}`)
      }
    }

    // -----------------------------------------------------------------
    // DomainCollection depth comparison
    // -----------------------------------------------------------------
    output.log(colors.cyan('\nDomainCollection depth comparison...'))

    const allDocs = store.time.getAll().toArray()
    output.log(colors.gray(`  All time documents: ${allDocs.length}`))

    for (const depth of [1, 2, Infinity]) {
      const t0 = performance.now()
      const collection = DomainCollection.fromDocuments(allDocs, store, { depth })
      const ms = performance.now() - t0
      const label = depth === Infinity ? '∞' : String(depth)
      output.log(colors.gray(`  depth ${label}: ${collection.size} items in ${ms.toFixed(1)}ms`))
    }

    return CommandResult.success({
      loadTimeMs,
      people: store.people.size,
      orgs: store.orgs.size,
      time: store.time.size,
      errors: allErrors.length,
      warnings: allWarnings.length,
    })
  }
}
