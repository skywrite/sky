import { readFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { generateText, jsonSchema } from 'ai'
import {
  EXPORT_MIME,
  MAX_IMAGE_BYTES,
  WORKSPACE_MIME,
  batchUpdateDoc,
  batchUpdateSlides,
  batchUpdateSpreadsheet,
  compactComments,
  conversionTarget,
  copyFile,
  createComment,
  createReply,
  deleteComment,
  listComments,
  listDocSuggestionIds,
  listDocSuggestions,
  listDocTabs,
  shareFile,
  createDocFromMarkdown,
  createPresentation,
  createSpreadsheet,
  csvToValues,
  driveImageUrl,
  ensureConvertedTwin,
  exportFile,
  exportFileBytes,
  extractChartIds,
  fetchThumbnailPng,
  getDocOutline,
  getDocTabTexts,
  getElementAnchor,
  getFile,
  getPresentationOutline,
  getSlideThumbnail,
  getSpreadsheetOutline,
  getValues,
  presentationUrl,
  renameFile,
  replaceFileWithMarkdown,
  searchFiles,
  setValues,
  sniffImageMime,
  spreadsheetUrl,
  twinProperties,
  uploadFile,
  uploadedSpreadsheetFormat,
  validateDocsRequests,
  validateSheetsRequests,
  validateSlidesRequests,
  workspaceKind,
} from '#lib/google/mod.ts'
import type { GoogleClient, WorkspaceKind } from '#lib/google/mod.ts'
import { aiModel } from '#shared/ai/models.ts'
import { paginateRead } from '../../lib/readWorkspaceFile.ts'
import { addDocsComment, addSheetsComment, addSlidesComment } from './browserComments.ts'
import { suggestDocsEdit } from './browserSuggestions.ts'
import { svgToPng, validateSvgSource } from './svgToPng.ts'

export interface MissionFile {
  id: string
  title: string
  url?: string
  kind?: WorkspaceKind
  action: 'created' | 'updated' | 'read'
}

/** What the mission touched — drives the notebook artifact and the command result. */
export interface MissionState {
  files: MissionFile[]
  /** Images staged in Drive for placement; the command deletes them when the mission ends. */
  tempUploads: Array<{ id: string; name: string }>
  /** Fires once per newly-tracked file — the command uses it to open the file in the browser. */
  onFileTracked?: (file: MissionFile) => void
}

export function createMissionState(): MissionState {
  return { files: [], tempUploads: [] }
}

function track(
  state: MissionState,
  action: MissionFile['action'],
  file: { id: string; name?: string; webViewLink?: string; mimeType?: string },
): void {
  const kind = file.mimeType ? workspaceKind(file.mimeType) : undefined
  const existing = state.files.find((f) => f.id === file.id)
  if (existing) {
    if (file.name) existing.title = file.name
    if (file.webViewLink) existing.url = file.webViewLink
    if (kind) existing.kind = kind
    return
  }
  const tracked: MissionFile = { id: file.id, title: file.name ?? file.id, url: file.webViewLink, kind, action }
  state.files.push(tracked)
  state.onFileTracked?.(tracked)
}

/** Ceiling for a doc's rendered PDF sent to the vision reviewer (Anthropic's request cap is 32MB). */
const MAX_DOC_PDF_BYTES = 15 * 1024 * 1024

function toolError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('must not be an Office file')) {
    return `Error: ${message} — that id is an uploaded Office file Drive stores as-is; read_file converts it to a native Google twin and returns the twin id — use that id here`
  }
  return `Error: ${message}`
}

/**
 * Hard ceiling per tool call, comfortably above the slowest legitimate tool
 * (an anchored browser comment ≈ 90s). A wedged call must surface as a tool
 * error the agent can route around — never freeze the mission. The stream
 * watchdog in mod.ts relies on this: every tool call produces SOME result
 * within this window, so a longer silence can only mean a dead model stream.
 */
const TOOL_TIMEOUT_MS = 180_000

function withToolTimeouts<T extends Record<string, { execute: (...a: never[]) => unknown }>>(
  tools: T,
  log: (line: string) => void,
): T {
  for (const [name, tool] of Object.entries(tools)) {
    const execute = tool.execute as (...a: unknown[]) => Promise<unknown>
    tool.execute = (async (...a: unknown[]) => {
      const run = execute(...a)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          run,
          new Promise<string>((resolve) => {
            timer = setTimeout(() => {
              log(`${name} timed out after ${TOOL_TIMEOUT_MS / 60_000} minutes — continuing without it`)
              resolve(
                `Error: ${name} did not finish within ${TOOL_TIMEOUT_MS / 60_000} minutes (network stall). It may still have partially completed — verify its effect before retrying once, and if it stalls again fall back and continue the mission.`,
              )
            }, TOOL_TIMEOUT_MS)
          }),
        ])
      } finally {
        clearTimeout(timer)
        // The losing branch keeps running detached; keep its rejection quiet.
        void run.catch(() => undefined)
      }
    }) as typeof tool.execute
  }
  return tools
}

/**
 * The inner toolset of the workspace agent. Every tool logs a one-line
 * humanized status through `log` — the live progress feed the user watches.
 */
export function createAgentTools(deps: {
  client: GoogleClient
  log: (line: string) => void
  state: MissionState
  /** Vision reviewer instructions for inspect_slide_visually. */
  critiquePrompt: string
  /** Vision reviewer instructions for inspect_deck_visually (cross-slide consistency). */
  deckCritiquePrompt: string
  /** Vision reviewer instructions for inspect_doc_visually (PDF page review). */
  docCritiquePrompt: string
}) {
  const { client, log, state, critiquePrompt, deckCritiquePrompt, docCritiquePrompt } = deps

  const tools = {
    find_files: {
      description:
        'Find Google Docs/Sheets/Slides — and uploaded Office/csv files (listed with their format as kind; read_file converts them to a native twin) — in Drive by name or content, most recently modified first. Omit query to list recent files.',
      inputSchema: jsonSchema<{ query?: string; kind?: WorkspaceKind; limit?: number }>({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text matched against file names and content' },
          kind: { type: 'string', enum: ['doc', 'sheet', 'slides'] },
          limit: { type: 'number' },
        },
      }),
      execute: async ({ query, kind, limit }: { query?: string; kind?: WorkspaceKind; limit?: number }) => {
        try {
          const files = await searchFiles(client, { text: query, kind, limit: limit ?? 10 })
          log(`Searched Drive for ${query ? `"${query}"` : 'recent files'} — ${files.length} match(es)`)
          return files.map((f) => ({
            id: f.id,
            name: f.name,
            kind: workspaceKind(f.mimeType) ?? uploadedSpreadsheetFormat(f.mimeType) ?? f.mimeType,
            modified: f.modifiedTime,
            url: f.webViewLink,
          }))
        } catch (err) {
          return toolError(err)
        }
      },
    },

    read_file: {
      description:
        'Read a file from Drive: Docs as markdown, Sheets as csv (first tab), Slides as text. An uploaded Office/csv/pdf file (.xlsx/.docx/.pptx…, stored as-is by Drive) is read through its native Google twin — converted on first read, reused after — and the result carries the twin id to use for every later call. Long files return 40k chars per call — when the content ends with a [Truncated …] marker, call again with the offset it names until you have read everything the mission needs. A Doc holding several tabs exports ALL of them in order, each opening with its tab title as a # heading, and returns a tabs list mapping those titles to tabIds (needed for tab-targeted edits); pass tabId to re-read just one tab (returned as plain text, not markdown).',
      inputSchema: jsonSchema<{ fileId: string; offset?: number; tabId?: string }>({
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          offset: { type: 'number', description: 'Character offset a truncated read told you to continue from' },
          tabId: { type: 'string', description: 'Docs only: read just this tab (plain text, not markdown)' },
        },
        required: ['fileId'],
      }),
      execute: async ({ fileId, offset, tabId }: { fileId: string; offset?: number; tabId?: string }) => {
        try {
          const source = await getFile(client, fileId)
          let file = source
          let kind = workspaceKind(source.mimeType)
          let twin: Record<string, unknown> | undefined
          let twinNote: string | undefined
          if (!kind) {
            if (!conversionTarget(source.mimeType)) {
              return `Error: "${source.name}" is not a Doc/Sheet/Slides file or an upload Drive can convert (${source.mimeType})`
            }
            // Drive's "Save as Google Sheets/Docs/Slides", done once and reused — the source itself stays untouched.
            const converted = await ensureConvertedTwin(client, source)
            file = converted.twin
            kind = converted.kind
            if (converted.created) track(state, 'created', file)
            log(
              converted.created
                ? `Converted "${source.name}" to a native ${kind} — ${file.webViewLink ?? file.id}`
                : `Reading "${source.name}" through its native ${kind} twin — ${file.webViewLink ?? file.id}`,
            )
            twin = { id: file.id, name: file.name, url: file.webViewLink, created: converted.created }
            twinNote = `"${source.name}" is an uploaded file Drive stores as-is; this content is its native Google ${kind} twin "${file.name}" (${
              converted.created ? 'converted just now' : 'converted earlier from this same revision, reused'
            }${
              converted.superseded
                ? `; an older twin ${converted.superseded.webViewLink ?? converted.superseded.id} predates the source's latest change and was left in place`
                : ''
            }). Use the twin id ${file.id} for every further tool call — get_values, outlines, comments, edits all refuse the original — and report the twin's URL alongside the original.`
          }
          if (tabId !== undefined) {
            if (kind !== 'doc') return `Error: tabId applies only to Docs — "${file.name}" is a ${kind}`
            const tabs = await getDocTabTexts(client, file.id)
            const tab = tabs.find((t) => t.tabId === tabId)
            if (!tab) {
              const known = tabs.map((t) => `${t.tabId} ("${t.tabTitle ?? 'untitled'}")`).join(', ')
              return `Error: no tab ${tabId} in "${file.name}" — its tabs: ${known}`
            }
            const page = paginateRead(tab.text, offset)
            if (!page) return `Error: offset ${offset} is past the end — the tab is ${tab.text.length} chars`
            log(
              `Read "${file.name}" tab "${tab.tabTitle ?? tabId}" (${
                page.start > 0 ? `chars ${page.start}-${page.end} of ` : ''
              }${tab.text.length} chars)`,
            )
            return {
              id: file.id,
              name: file.name,
              kind,
              tabId,
              tabTitle: tab.tabTitle,
              content: page.content,
              ...(twin ? { sourceId: source.id, twin, note: twinNote } : {}),
            }
          }
          const [full, docTabs] = await Promise.all([
            exportFile(client, file.id, EXPORT_MIME[kind]),
            kind === 'doc' ? listDocTabs(client, file.id) : Promise.resolve([]),
          ])
          const page = paginateRead(full, offset)
          if (!page) return `Error: offset ${offset} is past the end — "${file.name}" is ${full.length} chars`
          log(
            page.start > 0
              ? `Read "${file.name}" (${kind}, chars ${page.start}-${page.end} of ${full.length})`
              : `Read "${file.name}" (${kind}, ${full.length} chars${page.complete ? '' : `, first ${page.end} returned`})`,
          )
          const result: Record<string, unknown> = { id: file.id, name: file.name, kind, content: page.content }
          if (twin) {
            result.sourceId = source.id
            result.twin = twin
            result.note = twinNote
          }
          if (docTabs.length > 1) {
            result.tabs = docTabs.map((t) => ({ tabId: t.tabId, title: t.title }))
            result.note = `${twinNote ? `${twinNote} ` : ''}This doc has ${docTabs.length} tabs — the export includes all of them, each opening with its tab title as a # heading. Tab-targeted tools need the tabIds listed here.`
          }
          return result
        } catch (err) {
          return toolError(err)
        }
      },
    },

    create_doc: {
      description:
        'Create a new Google Doc from markdown (converted natively by Drive). Returns its id and URL — share the URL immediately.',
      inputSchema: jsonSchema<{ title: string; markdown: string }>({
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Document title (file name in Drive)' },
          markdown: { type: 'string', description: 'Full document content as markdown' },
        },
        required: ['title', 'markdown'],
      }),
      execute: async ({ title, markdown }: { title: string; markdown: string }) => {
        try {
          const file = await createDocFromMarkdown(client, { title, markdown })
          track(state, 'created', file)
          log(`Created "${file.name ?? title}" — ${file.webViewLink ?? file.id}`)
          return { id: file.id, name: file.name, url: file.webViewLink }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    replace_doc_content: {
      description:
        'Replace the ENTIRE content of an existing Google Doc with new markdown. Destructive — prior content remains only in Drive version history. Use solely on the mission-target document. Refuses docs with several tabs (the replacement would overwrite ALL of them) — edit those per tab with batch_update_doc instead.',
      inputSchema: jsonSchema<{ fileId: string; markdown: string }>({
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          markdown: { type: 'string', description: 'Full replacement content as markdown' },
        },
        required: ['fileId', 'markdown'],
      }),
      execute: async ({ fileId, markdown }: { fileId: string; markdown: string }) => {
        try {
          const tabs = await listDocTabs(client, fileId)
          if (tabs.length > 1) {
            return `Error: this doc has ${tabs.length} tabs — replacing the whole file would overwrite ALL of them. Edit the target tab with batch_update_doc (tabId from get_doc_outline) or suggest_doc_edit instead.`
          }
          const file = await replaceFileWithMarkdown(client, fileId, markdown)
          track(state, 'updated', file)
          log(`Rewrote "${file.name ?? fileId}" — ${file.webViewLink ?? file.id}`)
          return { id: file.id, name: file.name, url: file.webViewLink }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    batch_update_doc: {
      description:
        "Apply Google Docs API batchUpdate requests to a document (styling, replaceAllText, tables, headers). Range-based requests need indexes — call get_doc_outline first. Docs with several tabs: indexes are tab-local, so set the tab's tabId inside each location/range object (requests without one hit the FIRST tab) — and replaceAllText hits ALL tabs unless scoped with tabsCriteria: {tabIds: [...]}. Tabs themselves are managed here too: addDocumentTab creates one (tabProperties: title, index), updateDocumentTabProperties renames/moves one (tabProperties + fields mask), deleteTab removes one — replies are not returned, so call get_doc_outline after adding a tab to learn its tabId.",
      inputSchema: jsonSchema<{ fileId: string; requests: Array<Record<string, unknown>> }>({
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          requests: {
            type: 'array',
            items: { type: 'object' },
            description: 'Docs API request objects, one kind-key each',
          },
        },
        required: ['fileId', 'requests'],
      }),
      execute: async ({ fileId, requests }: { fileId: string; requests: Array<Record<string, unknown>> }) => {
        const problem = validateDocsRequests(requests)
        if (problem) return `Error: ${problem}`
        try {
          const applied = await batchUpdateDoc(client, fileId, requests)
          const file = await getFile(client, fileId)
          track(state, 'updated', file)
          log(`Applied ${applied} update(s) to "${file.name}"`)
          return { applied }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    inspect_doc_visually: {
      description:
        'Render a Google Doc to PDF and look at its pages. Without purpose: strict layout/typography QA (walls of text, heading problems, table overflow, spacing) — use after substantial writes. With purpose: answers that instruction instead (any visual question from the mission).',
      inputSchema: jsonSchema<{ fileId: string; purpose?: string }>({
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          purpose: {
            type: 'string',
            description: 'Optional instruction for the look — replaces the default QA entirely',
          },
        },
        required: ['fileId'],
      }),
      execute: async ({ fileId, purpose }: { fileId: string; purpose?: string }) => {
        try {
          const file = await getFile(client, fileId)
          if (workspaceKind(file.mimeType) !== 'doc') {
            return `Error: "${file.name}" is not a Google Doc — decks are inspected via inspect_slide_visually / inspect_deck_visually`
          }
          const pdf = await exportFileBytes(client, file.id, 'application/pdf')
          if (pdf.length > MAX_DOC_PDF_BYTES) {
            return `Error: the rendered PDF is too large to review (${pdf.length} bytes) — verify via get_doc_outline and read_file instead`
          }
          const instruction = purpose?.trim()
            ? `You are shown a document rendered as PDF pages.\n\n${purpose.trim()}`
            : docCritiquePrompt
          const { text } = await generateText({
            ...aiModel('vision'),
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'file', data: pdf, mediaType: 'application/pdf' },
                  { type: 'text', text: instruction },
                ],
              },
            ],
          })
          const critique = text.trim()
          log(
            purpose?.trim()
              ? `Looked at "${file.name}" as rendered pages`
              : `Looked at "${file.name}" as rendered pages: ${critique === 'OK' ? 'OK' : 'issues found'}`,
          )
          return { critique }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    create_presentation: {
      description:
        'Create a new empty Google Slides presentation. Returns its id and URL — then build slides with batch_update_slides.',
      inputSchema: jsonSchema<{ title: string }>({
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      }),
      execute: async ({ title }: { title: string }) => {
        try {
          const presentation = await createPresentation(client, title)
          const url = presentationUrl(presentation.presentationId)
          track(state, 'created', {
            id: presentation.presentationId,
            name: presentation.title ?? title,
            webViewLink: url,
            mimeType: WORKSPACE_MIME.slides,
          })
          log(`Created "${presentation.title ?? title}" — ${url}`)
          return { presentationId: presentation.presentationId, url }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    get_presentation_outline: {
      description:
        'Inspect a presentation: slide objectIds in order, each element objectId with type and text excerpt. Use to target batch_update_slides requests and verify structure.',
      inputSchema: jsonSchema<{ presentationId: string }>({
        type: 'object',
        properties: { presentationId: { type: 'string' } },
        required: ['presentationId'],
      }),
      execute: async ({ presentationId }: { presentationId: string }) => {
        try {
          const outline = await getPresentationOutline(client, presentationId)
          log(`Inspected "${outline.title ?? presentationId}" — ${outline.slideCount} slide(s)`)
          return outline
        } catch (err) {
          return toolError(err)
        }
      },
    },

    batch_update_slides: {
      description:
        'Apply Google Slides API batchUpdate requests (createSlide, createShape, insertText, updateTextStyle, ...). Assign your own objectIds in createSlide/createShape so later requests can target them without re-inspection.',
      inputSchema: jsonSchema<{ presentationId: string; requests: Array<Record<string, unknown>> }>({
        type: 'object',
        properties: {
          presentationId: { type: 'string' },
          requests: {
            type: 'array',
            items: { type: 'object' },
            description: 'Slides API request objects, one kind-key each',
          },
        },
        required: ['presentationId', 'requests'],
      }),
      execute: async ({
        presentationId,
        requests,
      }: {
        presentationId: string
        requests: Array<Record<string, unknown>>
      }) => {
        const problem = validateSlidesRequests(requests)
        if (problem) return `Error: ${problem}`
        try {
          const applied = await batchUpdateSlides(client, presentationId, requests)
          const file = await getFile(client, presentationId)
          track(state, 'updated', file)
          log(`Applied ${applied} update(s) to "${file.name}"`)
          return { applied }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    inspect_slide_visually: {
      description:
        'Render one slide to an image and look at it. Without purpose: strict layout-defect QA (overflow, overlap, cramped spacing, misalignment) — use this while building. With purpose: answers that instruction instead (describe an image, holistic feedback, any visual question from the mission).',
      inputSchema: jsonSchema<{ presentationId: string; slideObjectId: string; purpose?: string }>({
        type: 'object',
        properties: {
          presentationId: { type: 'string' },
          slideObjectId: { type: 'string' },
          purpose: {
            type: 'string',
            description: 'Optional instruction for the look — replaces the default layout QA entirely',
          },
        },
        required: ['presentationId', 'slideObjectId'],
      }),
      execute: async ({
        presentationId,
        slideObjectId,
        purpose,
      }: {
        presentationId: string
        slideObjectId: string
        purpose?: string
      }) => {
        try {
          const thumbnail = await getSlideThumbnail(client, presentationId, slideObjectId)
          const png = await fetchThumbnailPng(thumbnail.contentUrl)
          const instruction = purpose?.trim()
            ? `You are shown one rendered slide from a presentation.\n\n${purpose.trim()}`
            : critiquePrompt
          const { text } = await generateText({
            ...aiModel('vision'),
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'file', data: png, mediaType: 'image/png' },
                  { type: 'text', text: instruction },
                ],
              },
            ],
          })
          const critique = text.trim()
          log(
            purpose?.trim()
              ? `Looked at slide ${slideObjectId}`
              : `Looked at slide ${slideObjectId}: ${critique === 'OK' ? 'OK' : 'issues found'}`,
          )
          return { critique }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    inspect_deck_visually: {
      description:
        'Render every slide (up to 12) and look at the deck as a whole. Without purpose: cross-slide consistency QA (title drift, palette/typography drift, monotony, uneven density) — use ONCE after composing all slides. With purpose: answers that instruction across the whole deck instead (e.g. per-slide feedback for a review mission).',
      inputSchema: jsonSchema<{ presentationId: string; purpose?: string }>({
        type: 'object',
        properties: {
          presentationId: { type: 'string' },
          purpose: {
            type: 'string',
            description: 'Optional instruction for the look — replaces the default consistency QA entirely',
          },
        },
        required: ['presentationId'],
      }),
      execute: async ({ presentationId, purpose }: { presentationId: string; purpose?: string }) => {
        try {
          const outline = await getPresentationOutline(client, presentationId)
          const slides = outline.slides.slice(0, 12)
          if (slides.length === 0) return 'Error: the presentation has no slides'
          const images: Uint8Array[] = []
          for (const slide of slides) {
            const thumbnail = await getSlideThumbnail(client, presentationId, slide.objectId)
            images.push(await fetchThumbnailPng(thumbnail.contentUrl))
          }
          const instruction = purpose?.trim()
            ? `You are shown the slides of one presentation, numbered in order.\n\n${purpose.trim()}`
            : deckCritiquePrompt
          const closing =
            outline.slides.length > slides.length
              ? `${instruction}\n\n(Only the first ${slides.length} of ${outline.slides.length} slides are shown.)`
              : instruction
          const { text } = await generateText({
            ...aiModel('vision'),
            messages: [
              {
                role: 'user',
                content: [
                  ...images.flatMap((png, i) => [
                    { type: 'text' as const, text: `Slide ${i + 1} (${slides[i].objectId}):` },
                    { type: 'file' as const, data: png, mediaType: 'image/png' as const },
                  ]),
                  { type: 'text' as const, text: closing },
                ],
              },
            ],
          })
          const critique = text.trim()
          log(
            purpose?.trim()
              ? `Reviewed the whole deck (${slides.length} slides)`
              : `Reviewed the whole deck (${slides.length} slides): ${critique === 'OK' ? 'OK' : 'findings'}`,
          )
          return { critique, slidesReviewed: slides.map((s) => s.objectId) }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    upload_image: {
      description:
        'Stage a local image file (PNG/JPEG/GIF) from a path the mission provides, returning a public URL for createImage (Slides) or insertInlineImage (Docs). The staged Drive copy is deleted when the mission ends — place the image before finishing; Google stores its own copy at insert time, and one upload can be placed many times.',
      inputSchema: jsonSchema<{ path: string }>({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Local file path from the mission (absolute or ~/)' },
        },
        required: ['path'],
      }),
      execute: async ({ path: imagePath }: { path: string }) => {
        const resolved = imagePath.startsWith('~/') ? path.join(os.homedir(), imagePath.slice(2)) : imagePath
        let data: Uint8Array
        try {
          data = new Uint8Array(await readFile(resolved))
        } catch {
          return `Error: could not read image file: ${imagePath}`
        }
        if (data.length > MAX_IMAGE_BYTES) {
          return `Error: image is too large (${data.length} bytes > ${MAX_IMAGE_BYTES})`
        }
        const mime = sniffImageMime(data)
        if (!mime) return `Error: ${imagePath} is not a PNG, JPEG or GIF file`
        try {
          const name = path.basename(resolved)
          const file = await uploadFile(client, { name, mimeType: mime, data })
          state.tempUploads.push({ id: file.id, name })
          await shareFile(client, file.id, { role: 'reader', anyoneWithLink: true })
          log(`Staged image "${name}" (${mime}, ${Math.round(data.length / 1024)} KB)`)
          return { imageUrl: driveImageUrl(file.id), name }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    render_svg: {
      description:
        'Render self-contained SVG markup you author into a staged PNG — the way to create designed background art (gradients, glows, geometric patterns) that the Slides API cannot draw natively. Returns a public URL for stretchedPictureFill backgrounds or createImage. Same lifecycle as upload_image: the staged copy is deleted when the mission ends, so place it before finishing.',
      inputSchema: jsonSchema<{ svg: string; name: string; width?: number; height?: number }>({
        type: 'object',
        properties: {
          svg: {
            type: 'string',
            description: 'Complete SVG document with width/height attributes; no scripts or external URLs',
          },
          name: { type: 'string', description: 'Short slug naming the artwork (e.g. "bg-title")' },
          width: { type: 'number', description: 'Output pixel width (default 1920)' },
          height: { type: 'number', description: 'Output pixel height (default 1080)' },
        },
        required: ['svg', 'name'],
      }),
      execute: async ({ svg, name, width, height }: { svg: string; name: string; width?: number; height?: number }) => {
        const problem = validateSvgSource(svg)
        if (problem) return `Error: ${problem}`
        try {
          const png = await svgToPng(svg, { width: width ?? 1920, height: height ?? 1080 })
          const fileName = `${name.trim() || 'background'}.png`
          const file = await uploadFile(client, { name: fileName, mimeType: 'image/png', data: png })
          state.tempUploads.push({ id: file.id, name: fileName })
          await shareFile(client, file.id, { role: 'reader', anyoneWithLink: true })
          log(`Rendered background "${fileName}" (${width ?? 1920}x${height ?? 1080})`)
          return { imageUrl: driveImageUrl(file.id), name: fileName }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    copy_file: {
      description:
        'Copy an existing file under a new name — e.g. duplicate a branded template deck to populate, or snapshot before heavy edits. Returns the copy (never the original). convert: true turns an uploaded Office/csv/pdf file into its native Google twin (Sheet/Doc/Slides) under this title, stamped so later read_file calls reuse it; without it an uploaded file copies as-is, still refused by every Docs/Sheets tool. read_file already converts on its own — use this only when the mission wants the twin under a specific name.',
      inputSchema: jsonSchema<{ fileId: string; title: string; convert?: boolean }>({
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          title: { type: 'string', description: 'Name for the copy' },
          convert: {
            type: 'boolean',
            description: 'Convert an uploaded .xlsx/.csv/.docx/.pptx/.pdf into its native Google type on the way',
          },
        },
        required: ['fileId', 'title'],
      }),
      execute: async ({ fileId, title, convert }: { fileId: string; title: string; convert?: boolean }) => {
        try {
          let mimeType: string | undefined
          let appProperties: Record<string, string> | undefined
          if (convert) {
            const source = await getFile(client, fileId)
            const target = conversionTarget(source.mimeType)
            if (!target && !workspaceKind(source.mimeType)) {
              return `Error: Drive has no Google conversion for "${source.name}" (${source.mimeType})`
            }
            if (target) {
              mimeType = WORKSPACE_MIME[target]
              appProperties = twinProperties(source)
            }
          }
          const copy = await copyFile(client, fileId, title, { mimeType, appProperties })
          track(state, 'created', copy)
          log(`${mimeType ? 'Converted' : 'Copied'} to "${copy.name ?? title}" — ${copy.webViewLink ?? copy.id}`)
          return {
            id: copy.id,
            name: copy.name,
            kind: workspaceKind(copy.mimeType) ?? uploadedSpreadsheetFormat(copy.mimeType) ?? copy.mimeType,
            url: copy.webViewLink,
          }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    rename_file: {
      description:
        'Rename an existing file in Drive — e.g. replace a default "Copy of …" title. Only the name changes; content, sharing, and URL stay put.',
      inputSchema: jsonSchema<{ fileId: string; name: string }>({
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          name: { type: 'string', description: 'The new file name' },
        },
        required: ['fileId', 'name'],
      }),
      execute: async ({ fileId, name }: { fileId: string; name: string }) => {
        try {
          const file = await renameFile(client, fileId, name)
          track(state, 'updated', file)
          log(`Renamed to "${file.name ?? name}" — ${file.webViewLink ?? file.id}`)
          return { id: file.id, name: file.name, url: file.webViewLink }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    share_file: {
      description:
        'Grant access to a file — ONLY when the mission explicitly asks to share. Either to one email (they get a notification) or via anyone-with-link. Default role commenter unless the mission says otherwise.',
      inputSchema: jsonSchema<{
        fileId: string
        email?: string
        anyoneWithLink?: boolean
        role?: 'reader' | 'commenter' | 'writer'
      }>({
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          email: { type: 'string', description: 'Recipient email (exactly one of email / anyoneWithLink)' },
          anyoneWithLink: { type: 'boolean', description: 'Open link access instead of a specific person' },
          role: { type: 'string', enum: ['reader', 'commenter', 'writer'] },
        },
        required: ['fileId'],
      }),
      execute: async ({
        fileId,
        email,
        anyoneWithLink,
        role,
      }: {
        fileId: string
        email?: string
        anyoneWithLink?: boolean
        role?: 'reader' | 'commenter' | 'writer'
      }) => {
        if ((email === undefined) === (anyoneWithLink !== true)) {
          return 'Error: pass exactly one of email or anyoneWithLink'
        }
        try {
          await shareFile(client, fileId, {
            role: role ?? 'commenter',
            emailAddress: email,
            anyoneWithLink,
          })
          const file = await getFile(client, fileId)
          track(state, 'updated', file)
          log(`Shared "${file.name}" with ${email ?? 'anyone with the link'} (${role ?? 'commenter'})`)
          return { shared: true }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    add_comment: {
      description:
        'Leave a comment on a file (Doc/Sheet/Slides) that collaborators see and can reply to. Comments are file-level and appear in the 💬 comments panel, NOT pinned to content (Google forbids third-party anchoring): BEGIN the content with the location it concerns ("Slide 3:", "Section Outlook:") and pass the exact text it refers to as quote — the panel shows the quote with the comment. One comment per issue.',
      inputSchema: jsonSchema<{ fileId: string; content: string; quote?: string }>({
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          content: { type: 'string', description: 'The comment text, starting with the location it concerns' },
          quote: {
            type: 'string',
            description: 'Verbatim text from the file this comment refers to — displayed alongside the comment',
          },
        },
        required: ['fileId', 'content'],
      }),
      execute: async ({ fileId, content, quote }: { fileId: string; content: string; quote?: string }) => {
        if (!content.trim()) return 'Error: comment content is empty'
        try {
          const comment = await createComment(client, fileId, content.trim(), { quoted: quote })
          const file = await getFile(client, fileId)
          track(state, 'updated', file)
          const location = content.trim().split(':')[0]
          log(`Commented on "${file.name}" (${location})`)
          return { commentId: comment.id }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    list_comments: {
      description:
        'Read the open comment threads on a file (author, content, replies). Check before adding feedback so you never duplicate an existing open comment; also the starting point for missions that address reviewer feedback.',
      inputSchema: jsonSchema<{ fileId: string; includeResolved?: boolean }>({
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          includeResolved: { type: 'boolean', description: 'Also return resolved threads (default false)' },
        },
        required: ['fileId'],
      }),
      execute: async ({ fileId, includeResolved }: { fileId: string; includeResolved?: boolean }) => {
        try {
          const comments = await listComments(client, fileId, { includeResolved })
          log(`Read ${comments.length} comment thread(s)`)
          return { comments: compactComments(comments) }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    add_anchored_comment: {
      description:
        'Leave a REAL anchored comment by driving the local browser session (invisibly, headless): anchored to one slide or one element on it (Slides — pass slideObjectId, plus elementObjectId to pin the marker to that element), one cell (Sheets, pass sheetId + range), or a text passage (Docs — pass searchText, a VERBATIM snippet from the doc, distinctive enough to be unique; the comment binds to its first occurrence, and on a doc with several tabs also pass the tabId holding the text). Slower than add_comment (~20s each) but the comment appears AT its location. On any error (browser missing, signed out), fall back to add_comment.',
      inputSchema: jsonSchema<{
        fileId: string
        comment: string
        slideObjectId?: string
        elementObjectId?: string
        sheetId?: number
        range?: string
        searchText?: string
        tabId?: string
      }>({
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          comment: { type: 'string', description: 'The comment text collaborators will see at the anchor' },
          slideObjectId: { type: 'string', description: 'Slides: the slide to anchor to (from the outline)' },
          elementObjectId: {
            type: 'string',
            description: 'Slides: element on that slide to pin the marker to (from the outline)',
          },
          sheetId: { type: 'number', description: 'Sheets: numeric sheetId (from the outline)' },
          range: { type: 'string', description: 'Sheets: A1 cell to anchor to, e.g. "B12"' },
          searchText: {
            type: 'string',
            description: 'Docs: verbatim unique text from the document the comment anchors to',
          },
          tabId: {
            type: 'string',
            description: 'Docs with several tabs: the tab holding searchText (from get_doc_outline or read_file)',
          },
        },
        required: ['fileId', 'comment'],
      }),
      execute: async ({
        fileId,
        comment,
        slideObjectId,
        elementObjectId,
        sheetId,
        range,
        searchText,
        tabId,
      }: {
        fileId: string
        comment: string
        slideObjectId?: string
        elementObjectId?: string
        sheetId?: number
        range?: string
        searchText?: string
        tabId?: string
      }) => {
        if (!comment.trim()) return 'Error: comment content is empty'
        try {
          const file = await getFile(client, fileId)
          const kind = workspaceKind(file.mimeType)
          let where: string
          if (kind === 'slides') {
            if (!slideObjectId) return 'Error: pass slideObjectId for a Slides anchored comment'
            const anchor = elementObjectId ? await getElementAnchor(client, fileId, elementObjectId) : null
            const { level } = await addSlidesComment({
              presentationId: fileId,
              slideObjectId,
              comment: comment.trim(),
              anchor: anchor ?? undefined,
            })
            where = level === 'element' ? `element ${elementObjectId} on ${slideObjectId}` : `slide ${slideObjectId}`
          } else if (kind === 'sheet') {
            if (sheetId === undefined || !range) return 'Error: pass sheetId and range for a Sheets anchored comment'
            await addSheetsComment({ spreadsheetId: fileId, sheetId, range, comment: comment.trim() })
            where = `cell ${range}`
          } else if (kind === 'doc') {
            if (!searchText?.trim()) return 'Error: pass searchText (verbatim doc text) for a Docs anchored comment'
            await addDocsComment({ documentId: fileId, searchText: searchText.trim(), comment: comment.trim(), tabId })
            where = `text "${searchText.trim().slice(0, 40)}"${tabId ? ` (tab ${tabId})` : ''}`
          } else {
            return `Error: "${file.name}" is not a Doc/Sheet/Slides file`
          }
          // The UI flow is blind; the API is the witness. UI-created comments
          // list through the Drive API (with real anchors).
          const needle = comment.trim().slice(0, 40)
          const found = (await listComments(client, fileId)).some((c) => (c.content ?? '').includes(needle))
          track(state, 'updated', file)
          log(`Anchored a comment on "${file.name}" (${where})${found ? '' : ' — not yet visible via API'}`)
          return found
            ? { anchored: true }
            : { anchored: true, warning: 'submitted, but not yet listed via the API — verify before relying on it' }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    suggest_doc_edit: {
      description:
        'Propose a SUGGESTED edit in a Google Doc — a tracked change collaborators Accept or Reject — by driving the local browser session (invisibly, headless) in Suggesting mode. Docs only; when the mission wants changes APPLIED, use replace_doc_content/batch_update_doc instead. searchText is VERBATIM text as it reads in the document (no markdown syntax), distinctive enough to be unique — the first occurrence is edited unless you pass occurrence (1-based, reading order). Docs with several tabs require tabId (from get_doc_outline or read_file); searchText and occurrence then count within that tab. replacement is the full text that should stand in its place: "" proposes deleting the anchor; for an insertion, include unchanged neighboring text in BOTH fields (only the difference is typed). Slower than API edits (~25s each); on any browser error (missing, signed out), leave the proposal as an anchored/panel comment instead. Pending suggestions do NOT appear in read_file output — success is verified against the Docs API here, so never re-check by reading or retry because the text looks unchanged. Issue browser-driven calls ONE AT A TIME (they share one browser); a timed-out call usually still lands — check list_doc_suggestions before any re-issue.',
      inputSchema: jsonSchema<{
        fileId: string
        searchText: string
        replacement: string
        occurrence?: number
        tabId?: string
      }>({
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          searchText: {
            type: 'string',
            description: 'Verbatim unique text from the document that the suggestion replaces',
          },
          replacement: {
            type: 'string',
            description: 'Text to stand in its place — "" to propose deletion',
          },
          occurrence: {
            type: 'number',
            description: 'When searchText repeats: which match to edit, 1-based in reading order (default 1)',
          },
          tabId: {
            type: 'string',
            description: 'The tab holding searchText — required on docs with several tabs',
          },
        },
        required: ['fileId', 'searchText', 'replacement'],
      }),
      execute: async ({
        fileId,
        searchText,
        replacement,
        occurrence,
        tabId,
      }: {
        fileId: string
        searchText: string
        replacement: string
        occurrence?: number
        tabId?: string
      }) => {
        if (!searchText.trim()) return 'Error: searchText is empty'
        if (occurrence !== undefined && (!Number.isInteger(occurrence) || occurrence < 1)) {
          return 'Error: occurrence must be a positive integer (1-based)'
        }
        if (/[\n\r\t]/.test(searchText)) {
          return 'Error: searchText cannot span paragraphs or contain tabs — anchor on a snippet within one paragraph'
        }
        if (searchText === replacement) return 'Error: replacement equals searchText — nothing to suggest'
        if (searchText.length > 300) {
          return 'Error: searchText is too long (max 300 chars) — anchor on a shorter distinctive snippet'
        }
        if (replacement.length > 1500) {
          return 'Error: replacement is too long (max 1500 chars) — suggest passage-sized changes; a full rewrite belongs in a comment or a direct edit'
        }
        try {
          const file = await getFile(client, fileId)
          if (workspaceKind(file.mimeType) !== 'doc') return `Error: "${file.name}" is not a Google Doc`
          // On a find miss the browser flow would type at an unanchored caret —
          // prove the anchor exists in the target tab's base text before
          // launching (the editor opens on that tab; without a tabId, on the
          // first — so the anchor must be verified against the same tab).
          const tabs = await getDocTabTexts(client, fileId)
          const knownTabs = tabs.map((t) => `${t.tabId} ("${t.tabTitle ?? 'untitled'}")`).join(', ')
          if (tabId === undefined && tabs.length > 1) {
            return `Error: "${file.name}" has ${tabs.length} tabs — pass the tabId holding searchText: ${knownTabs}`
          }
          const tab = tabId === undefined ? tabs[0] : tabs.find((t) => t.tabId === tabId)
          if (!tab) return `Error: no tab ${tabId} in "${file.name}" — its tabs: ${knownTabs}`
          const text = tab.text
          const occurrences = text.split(searchText).length - 1
          if (occurrences === 0) {
            return `Error: searchText does not occur in ${tabId !== undefined ? `tab ${tabId}` : 'the document'} — pass text exactly as it reads there (read_file shows markdown; drop its syntax)`
          }
          const target = occurrence ?? 1
          if (target > occurrences) {
            return `Error: searchText occurs ${occurrences} time(s) — occurrence ${target} does not exist`
          }
          const before = new Set(await listDocSuggestionIds(client, fileId))
          await suggestDocsEdit({ documentId: fileId, searchText, replacement, occurrence: target, tabId })
          // The UI flow is blind; the API is the witness — a landed suggestion
          // brings new pending-suggestion ids.
          const found = (await listDocSuggestionIds(client, fileId)).some((id) => !before.has(id))
          track(state, 'updated', file)
          log(`Suggested an edit on "${file.name}" (text "${searchText.slice(0, 40)}")`)
          const result: Record<string, unknown> = found
            ? { suggested: true }
            : {
                suggested: true,
                warning:
                  'submitted, but no new pending suggestion is visible via the API yet — verify before relying on it',
              }
          if (occurrences > 1) result.note = `searchText occurs ${occurrences} times — occurrence ${target} was edited`
          return result
        } catch (err) {
          return toolError(err)
        }
      },
    },

    list_doc_suggestions: {
      description:
        'Read the pending suggested text edits on a Google Doc (Docs only): per suggestion its id, the text it deletes, the text it inserts, and the base text just before it for locating — on docs with several tabs, also the tabId/tabTitle it lives in. Check before a suggest pass so you never duplicate a pending suggestion (including one whose suggest_doc_edit call timed out), and use it to verify at the end of a suggest mission; also the work list for missions about existing suggestions. Read-only — accepting or rejecting stays with the doc owner in the editor. The API carries no author per suggestion.',
      inputSchema: jsonSchema<{ fileId: string }>({
        type: 'object',
        properties: { fileId: { type: 'string' } },
        required: ['fileId'],
      }),
      execute: async ({ fileId }: { fileId: string }) => {
        try {
          const file = await getFile(client, fileId)
          if (workspaceKind(file.mimeType) !== 'doc') return `Error: "${file.name}" is not a Google Doc`
          const suggestions = await listDocSuggestions(client, fileId)
          log(`Read ${suggestions.length} pending suggestion(s)`)
          return {
            suggestions: suggestions.map((s) => ({
              id: s.id,
              tabId: s.tabId,
              tabTitle: s.tabTitle,
              deletes: s.deletes.slice(0, 300),
              inserts: s.inserts.slice(0, 300),
              context: s.context,
            })),
          }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    delete_comment: {
      description:
        'Delete one comment thread entirely (including replies) — ONLY when the mission explicitly asks for comments to be removed. For addressed feedback prefer reply_to_comment with resolve, which keeps the history.',
      inputSchema: jsonSchema<{ fileId: string; commentId: string }>({
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          commentId: { type: 'string', description: 'Thread to delete (from list_comments)' },
        },
        required: ['fileId', 'commentId'],
      }),
      execute: async ({ fileId, commentId }: { fileId: string; commentId: string }) => {
        try {
          await deleteComment(client, fileId, commentId)
          const file = await getFile(client, fileId)
          track(state, 'updated', file)
          log(`Deleted a comment thread on "${file.name}"`)
          return { deleted: true }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    reply_to_comment: {
      description:
        'Reply on an existing comment thread (id from list_comments), optionally resolving it. For missions that address reviewer feedback: state what changed, and resolve only when the fix fully settles the thread.',
      inputSchema: jsonSchema<{ fileId: string; commentId: string; reply: string; resolve?: boolean }>({
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          commentId: { type: 'string' },
          reply: { type: 'string', description: 'The reply text collaborators will see' },
          resolve: { type: 'boolean', description: 'Also close the thread (default false)' },
        },
        required: ['fileId', 'commentId', 'reply'],
      }),
      execute: async ({
        fileId,
        commentId,
        reply,
        resolve,
      }: {
        fileId: string
        commentId: string
        reply: string
        resolve?: boolean
      }) => {
        if (!reply.trim()) return 'Error: reply content is empty'
        try {
          await createReply(client, fileId, commentId, { content: reply.trim(), resolve })
          const file = await getFile(client, fileId)
          track(state, 'updated', file)
          log(`Replied on "${file.name}"${resolve ? ' and resolved the thread' : ''}`)
          return { replied: true, resolved: resolve === true }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    create_spreadsheet: {
      description:
        'Create a new Google Sheets spreadsheet (one empty tab). Returns id, URL and the initial sheet — fill it with set_values, then style/chart via batch_update_spreadsheet.',
      inputSchema: jsonSchema<{ title: string }>({
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      }),
      execute: async ({ title }: { title: string }) => {
        try {
          const spreadsheet = await createSpreadsheet(client, title)
          const url = spreadsheet.spreadsheetUrl ?? spreadsheetUrl(spreadsheet.spreadsheetId)
          track(state, 'created', {
            id: spreadsheet.spreadsheetId,
            name: title,
            webViewLink: url,
            mimeType: WORKSPACE_MIME.sheet,
          })
          log(`Created "${title}" — ${url}`)
          return { spreadsheetId: spreadsheet.spreadsheetId, url, sheets: spreadsheet.sheets }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    set_values: {
      description:
        'Write data into a range (A1 notation with sheet name, e.g. "Sheet1!A1:C13"). Pass EITHER values (2D array) OR csv (raw CSV text verbatim — preferred for table data from the mission; never hand-transcribe CSV into arrays). USER_ENTERED semantics: numbers as numbers, strings starting with = become live formulas.',
      inputSchema: jsonSchema<{ spreadsheetId: string; range: string; values?: unknown[][]; csv?: string }>({
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string' },
          range: { type: 'string', description: 'Anchor or full range; the top-left cell is enough (e.g. "Data!A1")' },
          values: { type: 'array', items: { type: 'array' }, description: 'Rows of cell values' },
          csv: { type: 'string', description: 'Raw CSV text, passed through verbatim' },
        },
        required: ['spreadsheetId', 'range'],
      }),
      execute: async ({
        spreadsheetId,
        range,
        values,
        csv,
      }: {
        spreadsheetId: string
        range: string
        values?: unknown[][]
        csv?: string
      }) => {
        if ((values === undefined) === (csv === undefined)) {
          return 'Error: pass exactly one of values or csv'
        }
        const rows = csv !== undefined ? csvToValues(csv) : (values as unknown[][])
        if (rows.length === 0) return 'Error: no rows to write'
        try {
          const updated = await setValues(client, spreadsheetId, range, rows)
          const file = await getFile(client, spreadsheetId)
          track(state, 'updated', file)
          log(`Wrote ${rows.length} row(s) to ${range}`)
          return updated
        } catch (err) {
          return toolError(err)
        }
      },
    },

    get_values: {
      description:
        'Read cell values from a range (A1 notation with sheet name). Use to verify written data or read any tab.',
      inputSchema: jsonSchema<{ spreadsheetId: string; range: string }>({
        type: 'object',
        properties: { spreadsheetId: { type: 'string' }, range: { type: 'string' } },
        required: ['spreadsheetId', 'range'],
      }),
      execute: async ({ spreadsheetId, range }: { spreadsheetId: string; range: string }) => {
        try {
          const values = await getValues(client, spreadsheetId, range)
          log(`Read ${values.length} row(s) from ${range}`)
          if (values.length > 200) {
            return { values: values.slice(0, 200), note: `truncated to 200 of ${values.length} rows` }
          }
          return { values }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    batch_update_spreadsheet: {
      description:
        'Apply Sheets API batchUpdate requests (repeatCell styling, frozen rows, banding, addChart, ...). GridRanges need the numeric sheetId from get_spreadsheet_outline. addChart replies return chartIds — required to embed charts into Slides via createSheetsChart.',
      inputSchema: jsonSchema<{ spreadsheetId: string; requests: Array<Record<string, unknown>> }>({
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string' },
          requests: {
            type: 'array',
            items: { type: 'object' },
            description: 'Sheets API request objects, one kind-key each',
          },
        },
        required: ['spreadsheetId', 'requests'],
      }),
      execute: async ({
        spreadsheetId,
        requests,
      }: {
        spreadsheetId: string
        requests: Array<Record<string, unknown>>
      }) => {
        const problem = validateSheetsRequests(requests)
        if (problem) return `Error: ${problem}`
        try {
          const replies = await batchUpdateSpreadsheet(client, spreadsheetId, requests)
          const chartIds = extractChartIds(replies)
          const file = await getFile(client, spreadsheetId)
          track(state, 'updated', file)
          log(
            `Applied ${requests.length} update(s) to "${file.name}"${chartIds.length ? ` — chart(s) ${chartIds.join(', ')}` : ''}`,
          )
          return { applied: replies.length, chartIds }
        } catch (err) {
          return toolError(err)
        }
      },
    },

    get_spreadsheet_outline: {
      description:
        'Inspect a spreadsheet: tabs with numeric sheetId, title, size, and existing charts with chartIds. sheetIds are required by batch_update_spreadsheet GridRanges.',
      inputSchema: jsonSchema<{ spreadsheetId: string }>({
        type: 'object',
        properties: { spreadsheetId: { type: 'string' } },
        required: ['spreadsheetId'],
      }),
      execute: async ({ spreadsheetId }: { spreadsheetId: string }) => {
        try {
          const outline = await getSpreadsheetOutline(client, spreadsheetId)
          log(`Inspected "${outline.title ?? spreadsheetId}" — ${outline.sheets.length} tab(s)`)
          return outline
        } catch (err) {
          return toolError(err)
        }
      },
    },

    get_doc_outline: {
      description:
        'Inspect a Google Doc: title, headings with startIndex/endIndex (for range-based styling), paragraph count, end index. A doc holding several tabs returns one outline per tab under `tabs` (tabId, tabTitle, headings) — indexes are LOCAL to each tab. Use after writes to verify structure.',
      inputSchema: jsonSchema<{ fileId: string }>({
        type: 'object',
        properties: { fileId: { type: 'string' } },
        required: ['fileId'],
      }),
      execute: async ({ fileId }: { fileId: string }) => {
        try {
          const outline = await getDocOutline(client, fileId)
          const headingCount = outline.tabs
            ? outline.tabs.reduce((n, tab) => n + tab.headings.length, 0)
            : (outline.headings?.length ?? 0)
          log(
            `Inspected "${outline.title ?? fileId}" — ${
              outline.tabs ? `${outline.tabs.length} tab(s), ` : ''
            }${headingCount} heading(s)`,
          )
          return outline
        } catch (err) {
          return toolError(err)
        }
      },
    },
  }

  return withToolTimeouts(tools, log)
}
