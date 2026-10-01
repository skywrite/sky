import * as path from 'node:path'
import type { TranscriptRun } from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import { CommandPlatform, CommandResult } from '#commands/mod.ts'
import type { CommandArgs } from '#commands/mod.ts'
import { createDayFile } from '#lib/nbfs/createDayFile.ts'
import { copyToDayAttachments } from '#lib/notebook/attachments.ts'
import { autoRelMessage, mergeRel, scopeRel } from '#lib/notebook/enrich/autoRel.ts'
import { autoTagMessage } from '#lib/notebook/enrich/autoTag.ts'
import { readOptional, withLock } from '#lib/outbox/files.ts'
import openEditor from '#lib/shell/openEditor.ts'
import slugify from '#lib/string/slugify.ts'
import JournalDocument from '#shared/models/Journal/document/mod.ts'
import { JournalTypes } from '#shared/models/Journal/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import dayDir from '#shared/nbfs/dayDir.ts'
import { Instant, instantNow, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { groupByType, groupIntoBuckets, journalTypeMenu } from './groupSections.ts'
import { organizeRecording, type RecordingSections } from './recordedSections.ts'
import { buildEntryMarkdown, type EntryGroup, mergeGroupsByType, validateGroups } from './splitSections.ts'
import { summarizeJournals } from './summaries.ts'

const ENRICH = { mediums: ['journal'], kind: 'journal entry', maxTags: 5 }

/** Kept with the transcription until all entries have been published. Never stored in journal frontmatter. */
export interface RecordedJournalState {
  kind: 'Audio' | 'Video'
  when: string
  stamp: string
  recording: RecordingSections
  menu?: { name: string; count: number }[]
  suggested?: EntryGroup[]
  selected?: string[]
  groups?: EntryGroup[]
  named?: boolean
  attachment?: string
  entries?: { file: string; content: string; written: boolean }[]
}

export interface RecordedJournalOptions {
  kind: 'Audio' | 'Video'
  source: string
  cleanedText: string
  rel: string[]
  when: PlainDateTime
  run: TranscriptRun
  context: CommandArgs['context']
  split?: string
  types?: string[]
  reviewTypes?: boolean
  noAutoTag?: boolean
  noAutoRel?: boolean
}

const defaults = {
  now: () => Instant.from(instantNow()),
  organize: organizeRecording,
  menu: journalTypeMenu,
  suggest: groupByType,
  group: groupIntoBuckets,
  name: summarizeJournals,
  tags: autoTagMessage,
  rel: autoRelMessage,
  scope: scopeRel,
}

/** New notebooks have a useful menu; existing notebooks retain their custom types. */
export function recordingTypeMenu(observed: { name: string; count: number }[]) {
  const menu = observed.filter(({ name }) => !['audio', 'video', 'misc'].includes(name.toLowerCase()))
  const key = (name: string) => name.replaceAll(' ', '-').toLowerCase()
  const known = new Set(menu.map(({ name }) => key(name)))
  return [
    ...menu,
    ...JournalTypes.filter((name) => name !== 'Misc' && !known.has(key(name))).map((name) => ({ name, count: 0 })),
  ]
}

function validGroups(groups: EntryGroup[], count: number) {
  const error = validateGroups(groups, count)
  if (error) throw new Error(`The journal split could not be used (${error}). Retry to organize it again.`)
  return [...groups].sort((a, b) => Math.min(...a.sections) - Math.min(...b.sections))
}

export function recordedJournalPlan(kind: 'Audio' | 'Video', split?: string) {
  return [
    ...(kind === 'Video' ? [{ id: 'extract-audio', label: 'Extracting audio' }] : []),
    { id: 'transcribe', label: 'Transcribing' },
    { id: 'names', label: 'Checking names' },
    { id: 'sections', label: 'Organizing the journal' },
    ...(split ? [{ id: 'journal-types', label: 'Choosing journal types' }] : []),
    { id: 'journal-summary', label: 'Naming the journal entries' },
    { id: 'file', label: 'Saving journals and recording' },
  ]
}

/** Audio and video share the corrected-text → types → entries → retained recording pipeline. */
export async function fileRecordedJournal(
  options: RecordedJournalOptions,
  dependencies = defaults,
): Promise<CommandResult<{ files: string[] }>> {
  const { context, run } = options
  const { output, config, signal } = context
  let state: RecordedJournalState | undefined
  try {
    return await withLock(
      `${run.dir}.journal.lock`,
      async () => {
        signal?.throwIfAborted()
        state = (await run.get('journal'))?.data
        if (state && state.kind !== options.kind)
          throw new Error('This recording has an unfinished journal import of another kind. Finish it or Start over.')
        if (!state) {
          output.stage('sections', 'Organizing the journal')
          const recording = await dependencies.organize(options.cleanedText, signal)
          // Allocate the attachment's timestamp once, independently of the filing date.
          const created = dependencies
            .now()
            .toZonedDateTimeISO(context.notebookNow.timezone)
            .toPlainDateTime()
            .toString({ smallestUnit: 'second' })
          state = {
            kind: options.kind,
            when: options.when.toString(),
            stamp: created.replace('T', '_').replaceAll(':', ''),
            recording,
          }
          await run.put('journal', state)
        }
        const capture = state
        const persist = () => run.put('journal', capture)
        const { sections } = capture.recording
        const allSections = sections.map((_, index) => index)
        const whole = (type?: string): EntryGroup[] => [
          {
            title: capture.recording.title,
            summary: capture.recording.summary,
            sections: allSections,
            journalType: type,
          },
        ]
        if (!capture.groups) {
          if (options.split) {
            output.stage('journal-types', 'Choosing journal types')
            capture.menu ??= recordingTypeMenu(await dependencies.menu())
            if (!capture.suggested) {
              const suggestion = await dependencies.suggest(
                sections,
                capture.menu,
                sections.reduce((sum, section) => sum + section.words, 0),
              )
              if (suggestion.error) throw new Error(suggestion.error)
              capture.suggested = mergeGroupsByType(validGroups(suggestion.groups, sections.length))
              await persist()
            }
            if (!capture.selected) {
              const initial =
                options.split === 'auto'
                  ? [...new Set(capture.suggested.flatMap((group) => (group.journalType ? [group.journalType] : [])))]
                  : options.split
                      .split(',')
                      .map((type) => type.trim())
                      .filter(Boolean)
              if (options.reviewTypes && context.prompt.interactive) {
                const suggested = new Set(initial)
                const choices = [...capture.menu].sort(
                  (a, b) => Number(suggested.has(b.name)) - Number(suggested.has(a.name)),
                )
                const selected = await context.prompt.multiselect({
                  message: 'Choose journal types',
                  initial,
                  options: choices.map(({ name }) => ({
                    value: name,
                    label: name.replaceAll('-', ' '),
                    hint: capture.suggested!.find((group) => group.journalType === name)?.summary,
                  })),
                })
                signal?.throwIfAborted()
                if (selected === null) throw new Error('Journal type selection was cancelled. Start again to continue.')
                const allowed = new Set(choices.map(({ name }) => name))
                if (!Array.isArray(selected) || selected.some((type) => !allowed.has(type)))
                  throw new Error('Choose journal types from the list.')
                capture.selected = [...new Set(selected)]
              } else capture.selected = initial
              await persist()
            }
            const detected = [
              ...new Set(capture.suggested.flatMap((group) => (group.journalType ? [group.journalType] : []))),
            ]
            if (!capture.selected.length) capture.groups = whole('Misc')
            else if (
              capture.selected.length === detected.length &&
              detected.every((type) => capture.selected!.includes(type))
            ) {
              capture.groups = capture.suggested
            } else {
              const grouped = await dependencies.group(
                sections,
                capture.selected,
                sections.reduce((sum, section) => sum + section.words, 0),
              )
              if (grouped.error) throw new Error(grouped.error)
              capture.groups = mergeGroupsByType(
                validGroups(grouped.groups, sections.length).map((group) => ({
                  ...group,
                  journalType: capture.selected!.find((type) => type.toLowerCase() === group.title.toLowerCase()),
                })),
              )
            }
          } else capture.groups = whole(options.types?.[0] ?? (options.kind === 'Video' ? 'Video' : 'Misc'))
          await persist()
        }
        signal?.throwIfAborted()
        output.stage('journal-summary', 'Naming the journal entries')
        if (!capture.named) {
          const entries = capture.groups.map((group, index) => ({
            fileName: String(index),
            content: group.sections.map((i) => sections[i].body).join('\n\n'),
          }))
          try {
            const summaries = await dependencies.name(entries, signal)
            for (const [index, group] of capture.groups.entries()) {
              const title = summaries.find((summary) => summary.fileName === String(index))?.summary.trim()
              if (title) group.title = title.replace(/[\r\n]+/g, ' ')
            }
          } catch (error) {
            signal?.throwIfAborted()
            output.log(`Using the section titles for naming: ${error instanceof Error ? error.message : String(error)}`)
          }
          for (const group of capture.groups) {
            if (!group.title || group.title === group.journalType)
              group.title = sections[group.sections[0]].heading || 'Recorded Journal'
          }
          capture.named = true
          await persist()
        }
        const when = new PlainDateTime(capture.when)
        output.stage('file', 'Saving journals and recording')
        signal?.throwIfAborted()
        if (!capture.attachment) {
          const slug =
            slugify(capture.recording.title || 'Recorded Journal', { preserveCase: true, suggestedLength: 70 }) ||
            'Recorded-Journal'
          const kept = await copyToDayAttachments({
            sourcePath: options.source,
            attachmentsRoot: config.DIR_ATTACHMENTS,
            day: when.plainDate,
            fileName: `${capture.stamp}_${slug}${path.extname(options.source).toLowerCase()}`,
          })
          if (!kept) throw new Error('The recording could not be retained. The journal import is kept for retry.')
          capture.attachment = kept.attachment.file
          await persist()
        }
        capture.entries ??= []
        for (const [index, group] of capture.groups.entries()) {
          signal?.throwIfAborted()
          let entry = capture.entries[index]
          if (!entry) {
            const type = group.journalType ?? 'Misc'
            const h1 = `# **${type}: ${when.date} - ${when.plainDate.dayShort} - ${when.time}**`
            const markdown = buildEntryMarkdown(h1, group, sections)
            const enrichment = { summary: group.title, body: group.sections.map((i) => sections[i].body).join('\n\n') }
            const [tags, rel, scoped] = await Promise.all([
              options.noAutoTag ? undefined : dependencies.tags(enrichment, ENRICH),
              options.noAutoRel ? undefined : dependencies.rel(enrichment, ENRICH),
              options.noAutoRel || capture.groups.length === 1 || !options.rel.length
                ? undefined
                : dependencies.scope(options.rel, enrichment, {
                    kind: ENRICH.kind,
                    elsewhere: sections.filter((_, i) => !group.sections.includes(i)).map((section) => section.heading),
                  }),
            ])
            signal?.throwIfAborted()
            const doc = JournalDocument.fromMarkdown(markdown)
            doc.yaml['summary'] = group.title
            doc.yaml['rel'] = mergeRel(scoped ?? options.rel, rel) ?? null
            doc.yaml['tags'] = String(
              TagSet.fromString(
                [`Journal/${options.kind}`, `Journal/${type.replaceAll(' ', '-')}`, tags].filter(Boolean).join('; '),
              ),
            )
            doc.yaml['attachments'] = [{ file: capture.attachment }]
            const slug = slugify(group.title, { preserveCase: true, suggestedLength: 70 }) || 'Recorded-Journal'
            const typeSlug = slugify(type, { preserveCase: true }) || 'Misc'
            entry = {
              // The day directory already dates the journal; its name identifies the type and subject.
              file: path.join(config.DIR_TIME, dayDir(when.plainDate), 'journal', `${typeSlug}_${slug}.md`),
              content: doc.toMarkdown(),
              written: false,
            }
            // Allocate before publishing so a crash between file creation and checkpointing can recover it.
            const base = entry.file.replace(/\.md$/, '')
            for (let n = 2; (await readOptional(entry.file)) !== undefined; n++) entry.file = `${base}-${n}.md`
            capture.entries.push(entry)
            await persist()
          }
          if (!entry.written) {
            const base = entry.file.replace(/\.md$/, '')
            let suffix = 2
            while (!(await createDayFile(entry.file, entry.content))) {
              if ((await readOptional(entry.file)) === entry.content) break
              entry.file = `${base}-${suffix++}.md`
              await persist()
            }
            entry.written = true
            await persist()
          }
          output.tick(index + 1, capture.groups.length, 'journals')
        }
        const files = capture.entries.map((entry) => entry.file)
        signal?.throwIfAborted()
        await run.clear()
        for (const file of files) output.log(`Created ${path.relative(config.DIR_BASE, file)}`)
        if (context.platform === CommandPlatform.Console)
          openEditor(files.map((file) => ({ file, line: 1, column: 0 })))
        return CommandResult.success({ files })
      },
      false,
    )
  } catch (error) {
    return CommandResult.fail(error instanceof Error ? error.message : String(error), {
      files: state?.entries?.filter((entry) => entry.written).map((entry) => entry.file) ?? [],
    })
  }
}
