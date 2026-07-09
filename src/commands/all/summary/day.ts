import * as path from 'node:path'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { Command, CommandResult, dayNoFutureArg, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import openEditor from '#lib/shell/openEditor.ts'
import { stringify } from '#shared/yaml/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { gatherHealthData, type HealthData } from './_health.ts'
import { type DayPriceData, gatherDayPriceData } from './_prices.ts'
import { DayDocument } from '#shared/models/Day/mod.ts'

import { env } from '#shared/sys/mod.ts'

const PROMPT_FILE = new URL('./prompts/day.prompt.md', import.meta.url).pathname

const params = {
  day: dayNoFutureArg(),
  model: Flag.string('Claude model to use', { short: 'm', default: () => 'claude-opus-4-6' }),
  force: Flag.boolean('Overwrite existing summary file', { short: 'f', default: false }),
  dryRun: Flag.boolean('Show prompt without calling AI', { default: false }),
  stdout: Flag.boolean('Output summary to stdout instead of file', { default: false }),
  open: Flag.boolean('Open summary in editor after creation', { short: 'o', default: false }),
  export: Flag.boolean('Export summary as PDF to ~/Desktop', { short: 'e', default: false }),
}

type Params = InferParams<typeof params>
type Result = { path?: string; pdfPath?: string; dryRun?: boolean; stdout?: boolean }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'summary:day': { params: Params; result: Result }
  }
}

export default class SummaryDayTask extends Command {
  static override description: CommandDescription = {
    name: 'summary:day',
    description: "Generate AI-powered daily summary - what got done, what didn't",
    descriptionLong: [
      'Creates a summary.md file in the day directory.',
      'Facts-first mirror: Done, Not Done, Commitments Made, Health, Signals.',
      'Feeds into weekly summary for planning.',
    ],
    usage: [
      'sky summary:day                    # Summarize today',
      'sky summary:day 27                 # Summarize 27th of current month',
      'sky summary:day 2025-12-27         # Summarize specific day',
      'sky summary:day --dry-run          # Preview prompt without calling AI',
      'sky summary:day --force            # Overwrite existing summary',
      'sky summary:day --stdout           # Output to stdout instead of file',
      'sky summary:day --export           # Export existing summary as PDF to ~/Desktop',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { day, model, force, dryRun, stdout, open } = args
    const exportPdf = args.export

    const timeDir = <string>config.DIR_TIME
    const dayDirPath = path.join(timeDir, dayDir(day))
    const summaryPath = path.join(dayDirPath, 'summary.md')

    // --export: export existing summary as PDF (no AI generation)
    if (exportPdf) {
      if (!(await exists(summaryPath))) {
        return CommandResult.fail('No summary.md found. Run summary:day first to generate one.')
      }
      const pdfPath = this.pdfPath(day)
      output.log(`Exporting existing summary to PDF...`)
      const result = await tasks.run<{ pdfPath: string }>('markdown:pdf', {
        file: summaryPath,
        output: pdfPath,
        title: `Daily Summary – ${day.ymd}`,
      })
      if (result.status !== 'success') {
        return CommandResult.fail(result.message || 'PDF export failed')
      }
      return CommandResult.success({ path: summaryPath, pdfPath })
    }

    // Check if summary already exists (skip if outputting to stdout or dry-run)
    if (!stdout && !dryRun && !force && (await exists(summaryPath))) {
      return CommandResult.fail('Summary already exists. Use --force to overwrite.')
    }

    output.log(`Generating Daily Summary for ${day.ymd}...`)

    // 1. Get all files for the day via markdown:filter
    //
    // CONSIDERATION: Could use DayDocument.allDocumentRefs instead, which parses
    // day.md and extracts linked meetings/messages/notes. That would be cleaner
    // than grabbing everything by directory. However, journals (journal/*.md)
    // are NOT linked from day.md - they're just in the subdirectory. So we'd
    // miss them. Sticking with markdown:filter for now to get everything.
    //
    const filterResult = await tasks.run<{ files: string[] }>('markdown:filter', {
      day,
      raw: true,
    })

    if (filterResult.status !== 'success') {
      return CommandResult.error(new Error('Failed to filter files'), 'Failed to get day files')
    }

    const files = filterResult.data?.files || []

    // Filter out summary.md from the file list
    const dayFiles = files.filter((f) => !f.endsWith('summary.md'))

    if (dayFiles.length === 0) {
      return CommandResult.fail('No files found for this day')
    }

    // 2. Build the MarkdownStore for entity resolution
    output.log('Building entity store...')
    const store = await MarkdownStore.build({
      peopleDirs: [<string>config.DIR_PEOPLE, <string>config.DIR_PEOPLE_OLD],
      orgDirs: [<string>config.DIR_ORGS],
      projectsDir: <string>config.DIR_PROJECTS,
      decisionsDir: <string>config.DIR_DECISIONS,
      timeDirs: [timeDir],
    })

    // 3. Load all day files as documents
    output.log('Loading day documents...')
    const docs: Array<{ doc: Document; path: string }> = []

    for (const file of dayFiles) {
      try {
        const content = await readTextFile(file)
        // Skip empty or very short files
        if (content.length < 50) continue
        const doc = Document.fromMarkdown(content)
        docs.push({ doc, path: file })
      } catch {
        // Skip files that can't be read
      }
    }

    if (docs.length === 0) {
      return CommandResult.fail('No readable documents found for this day')
    }

    // 4. Build DomainCollection - this resolves relationships to people, orgs, projects
    output.log('Building domain collection with resolved relationships...')
    const collection = DomainCollection.fromDocuments(docs, store)

    const healthData = await gatherHealthData(day, timeDir)
    const priceData = await gatherDayPriceData(day, <string>config.DIR_TRACKING)

    // Load day document for location metadata
    const dayMdPath = path.join(dayDirPath, 'day.md')
    let location: string | undefined
    try {
      const dayContent = await readTextFile(dayMdPath)
      const dayDoc = DayDocument.fromMarkdown(dayContent)
      location = dayDoc.location
    } catch {
      // Day file may not exist or be readable
    }

    // 5. Generate collated markdown input for Claude
    const collatedMarkdown = collection.toMarkdown({
      relativeTo: timeDir,
      delimited: true,
    })

    // 6. Extract rel for output file metadata
    const rel: string[] = [
      ...collection.orgs.map((o) => o.name),
      ...collection.people.map((p) => p.name),
      ...collection.projects.map((p) => `projects/${p.name}`),
    ]

    // 7. Load prompt template
    const promptTemplate = await this.loadPromptTemplate()

    // 8. Build user prompt (date context + collated markdown + health data + prices + location)
    const userPrompt = this.buildUserPrompt(day, collatedMarkdown, healthData, priceData, location)

    output.log(`Collection: ${collection.size} documents`)
    output.log(`  - Orgs: ${collection.orgs.length}`)
    output.log(`  - People: ${collection.people.length}`)
    output.log(`  - Projects: ${collection.projects.length}`)

    if (dryRun) {
      output.log('\n=== SYSTEM PROMPT ===')
      output.log(promptTemplate)
      output.log('\n=== USER PROMPT ===')
      output.log(userPrompt)
      return CommandResult.success({ dryRun: true })
    }

    // 9. Call Claude
    output.log('Calling Claude...')
    let response: string
    try {
      // Temperature 0 = greedy decoding (always pick highest probability token).
      // This makes output nearly deterministic, which is appropriate for a factual
      // summary. It also helps when iterating on prompts—you can tell if output
      // changes are from prompt edits vs random variation.
      const result = await generateText({
        model: anthropic(model),
        instructions: promptTemplate,
        prompt: userPrompt,
        temperature: 0,
      })
      response = result.text
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to call Claude API')
    }

    // 10. Build output file
    const yamlHeader: Record<string, unknown> = {
      title: 'Daily Summary',
      day: day.ymd,
      generated: new Date().toISOString(),
      model,
      tags: 'Summary/Daily',
    }

    // Add rel if there are any orgs, people, or projects
    if (rel.length > 0) {
      yamlHeader.rel = rel
    }

    let outputContent = ['---', stringify(yamlHeader).trim(), '---', '', response].join('\n')

    // Append context file paths as hidden comment (same pattern as ai:chat)
    const contextPaths = collection.paths
    const baseDir = <string>config.DIR_BASE
    if (contextPaths.length > 0) {
      const relativePaths = contextPaths
        .map((p) => {
          if (p.startsWith(timeDir)) return p.slice(timeDir.length + 1)
          if (p.startsWith(baseDir)) return p.slice(baseDir.length + 1)
          return p
        })
        .sort()
      const pathLines = relativePaths.map((p) => ` - ${p}`).join('\n')
      outputContent += '\n\n\n<!--\nCONTEXT:\n\n' + pathLines + '\n\nEND\n-->\n'
    }

    // 11. Output
    if (stdout) {
      output.log(outputContent)
      return CommandResult.success({ stdout: true })
    }

    // Write file
    await writeTextFile(summaryPath, outputContent)
    output.log(`Daily Summary written to ${summaryPath}`)

    // 12. Open in editor if requested
    if (open) {
      await openEditor([{ file: summaryPath }])
    }

    return CommandResult.success({ path: summaryPath })
  }

  private async loadPromptTemplate(): Promise<string> {
    const content = await readTextFile(PROMPT_FILE)
    const { output } = renderPromptFile(content, 'day.prompt.md')
    return output
  }

  private buildUserPrompt(
    day: PlainDate,
    collatedMarkdown: string,
    healthData: HealthData,
    priceData: DayPriceData,
    location?: string,
  ): string {
    const parts: string[] = []

    // Header with date context
    parts.push(`# Daily Input for ${day.ymd} (${day.dayShort})`)
    parts.push('')
    if (location) {
      parts.push(`**Location**: ${location}`)
      parts.push('')
    }
    parts.push('Below is the collated input for this day. Generate the Daily Intelligence Brief.')
    parts.push('')

    // Price data section
    if (priceData.prices.length > 0) {
      parts.push('## Prices')
      parts.push('')
      for (const p of priceData.prices) {
        const formatted =
          p.value >= 1000 ? p.value.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p.value.toFixed(2)
        parts.push(`- **${p.symbol}**: $${formatted}`)
      }
      parts.push('')
    }

    // Health data section (if any data exists)
    if (healthData.sleep || healthData.weight || healthData.strength || healthData.distance || healthData.work) {
      parts.push('## Health Data')
      parts.push('')

      if (healthData.sleep) {
        parts.push(`- **Sleep**: ${healthData.sleep.range} (${healthData.sleep.duration} hrs)`)
      }

      if (healthData.weight) {
        parts.push(`- **Weight**: ${healthData.weight} lbs`)
      }

      if (healthData.strength) {
        for (const s of healthData.strength) {
          const durationPart = s.duration ? `, ${s.duration} mins` : ''
          const notesPart = s.notes ? ` - ${s.notes}` : ''
          parts.push(`- **Strength**: ${s.time}, ${s.lbs} lbs${durationPart}${notesPart}`)
        }
      }

      if (healthData.distance) {
        const totalMiles = healthData.distance.reduce((sum, d) => sum + (parseFloat(d.miles) || 0), 0)
        const totalMins = healthData.distance.reduce((sum, d) => sum + (parseFloat(d.duration) || 0), 0)
        const pace = totalMiles > 0 ? (totalMins / totalMiles).toFixed(1) : null
        const pacePart = pace ? `, ${pace} min/mi avg` : ''
        parts.push(`- **Distance**: ${totalMiles.toFixed(1)} mi, ${Math.round(totalMins)} mins${pacePart}`)
      }

      if (healthData.work) {
        const notesPart = healthData.work.notes ? ` - ${healthData.work.notes}` : ''
        parts.push(`- **Work**: ${healthData.work.duration} hrs${notesPart}`)
      }

      parts.push('')
    }

    parts.push('---')
    parts.push('')

    // The collated markdown from DomainCollection
    parts.push(collatedMarkdown)

    return parts.join('\n')
  }

  private pdfPath(day: PlainDate): string {
    const home = env.get('HOME') ?? '/tmp'
    return path.join(home, 'Desktop', `${day.ymd}_summary.pdf`)
  }
}
