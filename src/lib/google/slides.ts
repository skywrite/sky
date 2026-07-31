import type { GoogleClient } from './client.ts'
import { validateBatchRequests } from './batchValidate.ts'

export const SLIDES_API_URL = 'https://slides.googleapis.com/v1/presentations'

/** batchUpdate request kinds the agent may emit against Slides. */
export const SLIDES_ALLOWED_REQUESTS = new Set([
  'createSlide',
  'deleteObject',
  'createShape',
  'createImage',
  'insertText',
  'deleteText',
  'replaceAllText',
  'updateTextStyle',
  'updateParagraphStyle',
  'createParagraphBullets',
  'deleteParagraphBullets',
  'updateShapeProperties',
  'updatePageElementTransform',
  'updatePageProperties',
  'updateSlidesPosition',
  'duplicateObject',
  'createTable',
  'insertTableRows',
  'deleteTableRow',
  'updateTableCellProperties',
  'createSheetsChart',
  'refreshSheetsChart',
  'createLine',
  'updateLineProperties',
])

const MAX_REQUESTS_PER_BATCH = 100

export function validateSlidesRequests(requests: unknown): string | null {
  return validateBatchRequests(requests, SLIDES_ALLOWED_REQUESTS, MAX_REQUESTS_PER_BATCH)
}

export function presentationUrl(presentationId: string): string {
  return `https://docs.google.com/presentation/d/${presentationId}/edit`
}

export interface SlidesPresentation {
  presentationId: string
  title?: string
}

export async function createPresentation(client: GoogleClient, title: string): Promise<SlidesPresentation> {
  return await client.postJson<SlidesPresentation>(SLIDES_API_URL, { title })
}

/** Apply validated batchUpdate requests; returns the number of replies. */
export async function batchUpdateSlides(
  client: GoogleClient,
  presentationId: string,
  requests: Array<Record<string, unknown>>,
): Promise<number> {
  const body = await client.postJson<{ replies?: unknown[] }>(
    `${SLIDES_API_URL}/${encodeURIComponent(presentationId)}:batchUpdate`,
    { requests },
  )
  return body.replies?.length ?? requests.length
}

// ── Outline (compact view of presentations.get for the agent) ──────────

export interface SlideElementSummary {
  objectId: string
  type: string
  text?: string
}

export interface SlideSummary {
  objectId: string
  index: number
  /** Text-box id of the slide's speaker-notes shape (insertText target). */
  notesObjectId?: string
  elements: SlideElementSummary[]
}

export interface PresentationOutline {
  presentationId: string
  title?: string
  slideCount: number
  slides: SlideSummary[]
}

interface RawTextElement {
  textRun?: { content?: string }
}

interface RawPageElement {
  objectId?: string
  shape?: {
    shapeType?: string
    placeholder?: { type?: string }
    text?: { textElements?: RawTextElement[] }
  }
  table?: { rows?: number; columns?: number }
  image?: { contentUrl?: string }
}

interface RawSlide {
  objectId?: string
  slideProperties?: { notesPage?: { notesProperties?: { speakerNotesObjectId?: string } } }
  pageElements?: RawPageElement[]
}

interface RawPresentation {
  presentationId?: string
  title?: string
  slides?: RawSlide[]
}

const ELEMENT_TEXT_LIMIT = 160

/** Compact a presentations.get response into targetable object ids + text excerpts. */
export function summarizePresentation(raw: RawPresentation): PresentationOutline {
  const slides: SlideSummary[] = (raw.slides ?? []).map((slide, index) => ({
    objectId: slide.objectId ?? '',
    index,
    notesObjectId: slide.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId,
    elements: (slide.pageElements ?? []).map((element) => {
      const summary: SlideElementSummary = {
        objectId: element.objectId ?? '',
        type: element.table
          ? `TABLE ${element.table.rows ?? '?'}x${element.table.columns ?? '?'}`
          : element.image
            ? 'IMAGE'
            : (element.shape?.placeholder?.type ?? element.shape?.shapeType ?? 'ELEMENT'),
      }
      const text = (element.shape?.text?.textElements ?? [])
        .map((t) => t.textRun?.content ?? '')
        .join('')
        .trim()
      if (text) summary.text = text.length > ELEMENT_TEXT_LIMIT ? `${text.slice(0, ELEMENT_TEXT_LIMIT)}…` : text
      return summary
    }),
  }))

  return {
    presentationId: raw.presentationId ?? '',
    title: raw.title,
    slideCount: slides.length,
    slides,
  }
}

const OUTLINE_FIELDS =
  'presentationId,title,slides(objectId,slideProperties.notesPage.notesProperties.speakerNotesObjectId,pageElements(objectId,shape(shapeType,placeholder.type,text.textElements.textRun.content),table(rows,columns),image.contentUrl))'

export async function getPresentationOutline(
  client: GoogleClient,
  presentationId: string,
): Promise<PresentationOutline> {
  const url = new URL(`${SLIDES_API_URL}/${encodeURIComponent(presentationId)}`)
  url.searchParams.set('fields', OUTLINE_FIELDS)
  const raw = await client.getJson<RawPresentation>(url.toString())
  return summarizePresentation(raw)
}

// ── Thumbnails (the agent's eyes) ──────────────────────────────────────

export interface SlideThumbnail {
  contentUrl: string
  width?: number
  height?: number
}

export async function getSlideThumbnail(
  client: GoogleClient,
  presentationId: string,
  pageObjectId: string,
): Promise<SlideThumbnail> {
  const url = new URL(
    `${SLIDES_API_URL}/${encodeURIComponent(presentationId)}/pages/${encodeURIComponent(pageObjectId)}/thumbnail`,
  )
  // LARGE (1600px) over MEDIUM: the vision reviewer must catch small
  // alignment offsets, which vanish at 800px.
  url.searchParams.set('thumbnailProperties.thumbnailSize', 'LARGE')
  return await client.getJson<SlideThumbnail>(url.toString())
}

/** The thumbnail contentUrl is short-lived and pre-signed — plain fetch, no auth header. */
export async function fetchThumbnailPng(contentUrl: string, fetchFn: typeof fetch = fetch): Promise<Uint8Array> {
  const res = await fetchFn(contentUrl)
  if (!res.ok) throw new Error(`Thumbnail fetch failed (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}
