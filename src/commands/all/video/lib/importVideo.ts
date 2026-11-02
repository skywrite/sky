import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { createDayFile } from '#lib/nbfs/createDayFile.ts'
import { insertBlock } from '#lib/nbfs/listBlocks.ts'
import { ensureDay } from '#lib/nbfs/mod.ts'
import withDayWrite from '#lib/nbfs/withDayWrite.ts'
import { withMarkdownWrite } from '#lib/nbfs/withMarkdownWrite.ts'
import { copyFileDedup, copyToDayAttachments } from '#lib/notebook/attachments.ts'
import { atomicWrite, notebookFile, readOptional, withLock } from '#lib/outbox/files.ts'
import slugify from '#lib/string/slugify.ts'
import { attachmentCandidates, attachmentDestination } from '#service/handler/attachments/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import VideoDocument from '#shared/models/Video/mod.ts'
import { actionKindRel, dayDir, dayFile } from '#shared/nbfs/mod.ts'
import parseTimePath from '#shared/nbfs/parseTimePath.ts'
import { Instant, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { completeVideoBody, substantiveVideoText, videoContent } from './content.ts'
import { videoSource } from './source.ts'

export interface VideoImportConfig {
  DIR_BASE: string
  DIR_TIME: string
  DIR_ATTACHMENTS: string
  DIR_STATE: string
  DIR_USER_DATA: string
}

export interface VideoImportPlan {
  action: 'create' | 'fill' | 'skip' | 'review'
  url: string
  loomId: string | null
  filePath: string | null
  matches: string[]
  missing: ('video' | 'transcript' | 'summary')[]
  when: string
  reason?: string
}

export interface VideoImportText {
  body?: string
  cleanedText?: string
  title?: string
  from?: string | null
  to?: string | null
  rel?: string[]
  tags?: string
}

export interface VideoImportOptions {
  config: VideoImportConfig
  url: string
  when: PlainDateTime
  recordedAt?: string
  timezone: string
  title?: string
  medium?: string
  from?: string
  to?: string
  category: string
  videoFile?: string
  transcriptFile?: string
  dryRun?: boolean
  signal?: AbortSignal
  prepare: (plan: VideoImportPlan, existingTranscript: string) => Promise<VideoImportText>
}

export { videoSource } from './source.ts'

async function exists(file: string): Promise<boolean> {
  try {
    const info = await stat(file)
    return info.isFile() && info.size > 0
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false
    throw error
  }
}

async function markdownFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const groups = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map(async (entry) => {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) return markdownFiles(file)
        return entry.isFile() && entry.name.toLowerCase().endsWith('.md') ? [file] : []
      }),
  )
  return groups.flat()
}

async function matchingFiles(options: VideoImportOptions): Promise<string[]> {
  const source = videoSource(options.url)
  const matches: string[] = []
  for (const file of await markdownFiles(options.config.DIR_BASE)) {
    options.signal?.throwIfAborted()
    const text = await readFile(file, 'utf8')
    const header = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
    if (!header || !/\bvideo\b/.test(header)) continue
    const doc = Document.fromMarkdown(text)
    if (
      doc.yamlError &&
      (source.loomId ? header.replaceAll('-', '').toLowerCase().includes(source.loomId) : header.includes(source.url))
    )
      throw new Error(
        `The existing video header could not be read: ${path.relative(options.config.DIR_BASE, file)}. Fix its YAML before importing this source.`,
      )
    const video = doc.yaml.video as { url?: unknown } | null | undefined
    if (typeof video?.url !== 'string' || !video.url) continue
    try {
      if (videoSource(video.url).key === source.key) matches.push(file)
    } catch {
      /* An unrelated malformed provider URL cannot identify this recording. */
    }
  }
  return matches.sort()
}

async function localVideo(doc: Document, file: string, config: VideoImportConfig): Promise<boolean> {
  const relative = path.relative(config.DIR_BASE, file)
  for (const attachment of doc.attachments) {
    if (!/\.(?:mp4|mov|m4v|webm|mkv)$/i.test(attachment.file)) continue
    const candidates = [
      ...(path.isAbsolute(attachment.file) ? [attachment.file] : []),
      ...attachmentCandidates(path.join(path.dirname(relative), attachment.file), config.DIR_USER_DATA, relative),
      path.resolve(path.dirname(file), attachment.file),
    ]
    for (const candidate of candidates) if (await exists(candidate)) return true
  }
  return false
}

function identity(options: VideoImportOptions): string {
  const stamp = options.recordedAt
    ? Instant.from(options.recordedAt)
        .toZonedDateTimeISO(options.timezone)
        .toPlainDateTime()
        .toString({ smallestUnit: 'second' })
        .replace('T', '_')
        .replaceAll(':', '')
    : `${options.when.date}_${options.when.time.replace(':', '')}00`
  return `${stamp}_${slugify(options.title || 'Video', { preserveCase: true, suggestedLength: 70 }) || 'Video'}`
}

function existingWhen(doc: VideoDocument, file: string, options: VideoImportOptions): PlainDateTime {
  const raw = doc.yaml.when
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) return doc.when.datetime
  const location = parseTimePath(path.relative(options.config.DIR_BASE, file))
  const date = location?.kind === 'day' ? location.date.toString() : options.when.date
  const clock = typeof raw === 'string' ? raw.match(/^\d{1,2}:\d{2}/)?.[0] : undefined
  return new PlainDateTime({ date, time: clock ?? options.when.time })
}

export async function planVideoImport(options: VideoImportOptions): Promise<VideoImportPlan> {
  const source = videoSource(options.url)
  if (options.recordedAt) Instant.from(options.recordedAt)
  const matches = await matchingFiles(options)
  if (matches.length > 1)
    return {
      action: 'review',
      url: source.url,
      loomId: source.loomId,
      filePath: null,
      matches,
      missing: [],
      when: options.when.toString(),
      reason: 'Multiple Sky entries have this video URL. Choose the destination before importing.',
    }
  const filePath =
    matches[0] ??
    path.join(
      options.config.DIR_TIME,
      dayDir(options.when.plainDate),
      actionKindRel('video'),
      `${identity(options)}.md`,
    )
  const doc = matches[0] ? VideoDocument.fromMarkdown(await readFile(filePath, 'utf8')) : null
  const body = videoContent(doc?.markdown ?? '')
  const missing: VideoImportPlan['missing'] = []
  if (!doc || !(await localVideo(doc, filePath, options.config))) missing.push('video')
  if (!body.transcript) missing.push('transcript')
  if (!body.summary) missing.push('summary')
  return {
    action: !doc ? 'create' : missing.length ? 'fill' : 'skip',
    url: source.url,
    loomId: source.loomId,
    filePath,
    matches,
    missing,
    when: doc ? existingWhen(doc, filePath, options).toString() : options.when.toString(),
  }
}

interface PendingVideo {
  filePath: string
  when: string
  title: string
  category: string
}

async function addDayLink(pending: PendingVideo, config: VideoImportConfig): Promise<void> {
  const when = new PlainDateTime(pending.when)
  const relative = path.relative(path.join(config.DIR_TIME, dayDir(when.plainDate)), pending.filePath)
  await withDayWrite(config, when.date, async () => {
    await ensureDay(when.plainDate, config.DIR_TIME)
    const file = path.join(config.DIR_TIME, dayFile(when.plainDate))
    const text = await readFile(file, 'utf8')
    if (text.includes(`](<${relative}>)`) || text.includes(`](${relative})`)) return
    const label = pending.title.replace(/[\\[\]]/g, '\\$&')
    await atomicWrite(file, insertBlock(text, pending.category, `- ${when.time} > Video -> [${label}](<${relative}>)`))
  })
}

/** URL identity is in the notebook. The local pending record only repairs an interrupted day link. */
export async function importVideo(
  options: VideoImportOptions,
): Promise<{ filePath: string | null; plan: VideoImportPlan }> {
  const initial = await planVideoImport(options)
  if (options.dryRun) {
    for (const source of [options.videoFile, options.transcriptFile])
      if (source && !(await exists(source))) throw new Error(`The source file is missing: ${path.basename(source)}`)
    return { filePath: initial.filePath, plan: initial }
  }
  const key = createHash('sha256').update(videoSource(options.url).key).digest('hex')
  const state = path.join(options.config.DIR_STATE, 'video-imports', `${key}.json`)
  // Serialize this source across CLI and web, without holding a document's edit lock during AI calls.
  return withLock(
    `${state}.lock`,
    async () => {
      let plan = await planVideoImport(options)
      if (plan.action === 'review') throw new Error(`${plan.reason} ${plan.matches.join('; ')}`)
      const pendingText = await readOptional(state)
      let pending: PendingVideo | null = pendingText ? (JSON.parse(pendingText) as PendingVideo) : null
      if (pending && plan.matches.includes(pending.filePath)) {
        await addDayLink(pending, options.config)
        await unlink(state)
        pending = null
      }
      if (plan.action === 'skip') return { filePath: plan.filePath, plan }
      options.signal?.throwIfAborted()
      if (plan.missing.includes('video') && (!options.videoFile || !(await exists(options.videoFile))))
        throw new Error('The local video is missing. Supply its recording with --video-file.')
      const old = plan.matches[0] ? VideoDocument.fromMarkdown(await readFile(plan.matches[0], 'utf8')) : null
      const existingTranscript = videoContent(old?.markdown ?? '').transcriptText
      if ((plan.missing.includes('transcript') || plan.missing.includes('summary')) && !existingTranscript) {
        if (!options.transcriptFile || !(await exists(options.transcriptFile)))
          throw new Error('The transcript is missing. Supply an SRT, VTT or TXT transcript.')
        const raw = await readFile(options.transcriptFile, 'utf8')
        if (!substantiveVideoText(raw.replace(/^.*-->.*$/gm, '').replace(/^\s*\d+\s*$/gm, '')))
          throw new Error('The supplied transcript contains no usable words.')
      }
      const generated = plan.missing.some((part) => part !== 'video')
        ? await options.prepare(plan, existingTranscript)
        : {}
      options.signal?.throwIfAborted()
      const when = new PlainDateTime(plan.when)
      const save = async (file: string | null): Promise<string> => {
        if (file) await notebookFile(options.config.DIR_BASE, path.relative(options.config.DIR_BASE, file))
        const current = file ? VideoDocument.fromMarkdown(await readFile(file, 'utf8')) : null
        if (current && videoSource(current.videoUrl ?? '').key !== videoSource(options.url).key)
          throw new Error('The destination video URL changed during review. Review it before retrying.')
        const currentWhen = current ? existingWhen(current, file!, options) : when
        const stem = file
          ? path.basename(file, '.md')
          : identity({ ...options, title: options.title || generated.title })
        const content = videoContent(current?.markdown ?? '')
        if (!content.summary && !generated.body)
          throw new Error('The missing summary was not generated. No content was filed.')
        if (!content.transcript && !generated.cleanedText)
          throw new Error('The missing transcript was not produced. No content was filed.')
        const body = completeVideoBody(current?.markdown ?? `# ${options.medium || 'Video'}\n`, generated)
        // Keep unknown attachment fields and annotations exactly as stored.
        const attachments: unknown[] =
          current && Array.isArray(current.yaml.attachments) ? [...current.yaml.attachments] : []
        const sources: string[] = []
        if ((!current || !(await localVideo(current, file!, options.config))) && options.videoFile)
          sources.push(options.videoFile)
        if (options.transcriptFile) sources.push(options.transcriptFile)
        for (const source of sources) {
          options.signal?.throwIfAborted()
          const name = `${stem}${path.extname(source).toLowerCase()}`
          let attachment: { file: string } | undefined
          if (file) {
            const destination = attachmentDestination(
              path.relative(options.config.DIR_BASE, file),
              options.config.DIR_USER_DATA,
            )
            await mkdir(destination.dir, { recursive: true })
            const copied = await copyFileDedup(source, destination.dir, name)
            if (copied) attachment = { file: copied }
          } else {
            attachment = (
              await copyToDayAttachments({
                sourcePath: source,
                attachmentsRoot: options.config.DIR_ATTACHMENTS,
                day: currentWhen.plainDate,
                fileName: name,
              })
            )?.attachment
          }
          if (!attachment) throw new Error(`The source file is missing: ${path.basename(source)}`)
          if (
            !attachments.some(
              (entry) => entry && typeof entry === 'object' && (entry as { file?: unknown }).file === attachment.file,
            )
          )
            attachments.push(attachment)
        }
        options.signal?.throwIfAborted()
        const yaml = current
          ? { ...current.yaml, attachments }
          : {
              when: currentWhen,
              medium: options.medium || 'Loom',
              summary: options.title || generated.title || 'Video',
              ...(options.from || generated.from ? { from: options.from || generated.from } : {}),
              ...(options.to || generated.to ? { to: options.to || generated.to } : {}),
              ...(generated.rel?.length ? { rel: generated.rel } : {}),
              ...(generated.tags ? { tags: generated.tags } : {}),
              video: { url: plan.url, ...(options.recordedAt ? { recorded_at: options.recordedAt } : {}) },
              attachments,
            }
        const text = current ? new Document(yaml, body).toMarkdown() : new VideoDocument({ ...yaml, body }).toMarkdown()
        if (file) {
          await atomicWrite(file, text)
          return file
        }
        const base = path.join(options.config.DIR_TIME, dayDir(when.plainDate), actionKindRel('video'), stem)
        let target = pending?.filePath ?? `${base}.md`
        for (let suffix = 2; ; suffix++) {
          pending = {
            filePath: target,
            when: when.toString(),
            title: options.title || generated.title || 'Video',
            category: options.category,
          }
          await atomicWrite(state, JSON.stringify(pending))
          if (await createDayFile(target, text)) return target
          // A crash can publish the note before its pending record is cleared.
          const existing = VideoDocument.fromMarkdown(await readFile(target, 'utf8'))
          try {
            if (videoSource(existing.videoUrl ?? '').key === videoSource(options.url).key) return target
          } catch {
            /* A different video owns this filename. */
          }
          target = `${base}-${suffix}.md`
        }
      }
      // Re-read after AI, including an entry saved by another caller while this run was preparing.
      plan = await planVideoImport(options)
      if (plan.action === 'review') throw new Error(plan.reason)
      if (plan.action === 'skip') return { filePath: plan.filePath, plan }
      const filePath = plan.matches[0]
        ? await withMarkdownWrite(plan.matches[0], () => save(plan.matches[0]))
        : await save(null)
      if (pending) {
        await addDayLink(pending, options.config)
        await unlink(state)
      }
      const finished = await planVideoImport(options)
      if (finished.missing.length)
        throw new Error(
          `The video entry was saved but still needs: ${finished.missing.join(', ')}. Retry to fill the missing pieces.`,
        )
      return { filePath, plan: { ...finished, action: initial.action } }
    },
    false,
  )
}
