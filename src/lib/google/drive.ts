import type { GoogleClient } from './client.ts'

export const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'

export type WorkspaceKind = 'doc' | 'sheet' | 'slides'

export const WORKSPACE_MIME: Record<WorkspaceKind, string> = {
  doc: 'application/vnd.google-apps.document',
  sheet: 'application/vnd.google-apps.spreadsheet',
  slides: 'application/vnd.google-apps.presentation',
}

const KIND_BY_MIME = new Map<string, WorkspaceKind>(
  (Object.entries(WORKSPACE_MIME) as Array<[WorkspaceKind, string]>).map(([kind, mime]) => [mime, kind]),
)

/** Plain-text export target per kind: docs speak markdown, sheets CSV (first tab), slides text. */
export const EXPORT_MIME: Record<WorkspaceKind, string> = {
  doc: 'text/markdown',
  sheet: 'text/csv',
  slides: 'text/plain',
}

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  webViewLink?: string
}

export function workspaceKind(mimeType: string): WorkspaceKind | undefined {
  return KIND_BY_MIME.get(mimeType)
}

/** Escape a value for a Drive `q` string literal (backslash first, then quote). */
export function escapeDriveQueryValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}

export function buildFilesQuery(options: { text?: string; kind?: WorkspaceKind } = {}): string {
  const clauses = ['trashed = false']
  if (options.kind) {
    clauses.push(`mimeType = '${WORKSPACE_MIME[options.kind]}'`)
  } else {
    const mimes = Object.values(WORKSPACE_MIME).map((mime) => `mimeType = '${mime}'`)
    clauses.push(`(${mimes.join(' or ')})`)
  }
  if (options.text) {
    const value = escapeDriveQueryValue(options.text)
    clauses.push(`(name contains '${value}' or fullText contains '${value}')`)
  }
  return clauses.join(' and ')
}

const FILE_FIELDS = 'id, name, mimeType, modifiedTime, webViewLink'

export async function searchFiles(
  client: GoogleClient,
  options: { text?: string; kind?: WorkspaceKind; limit?: number } = {},
): Promise<DriveFile[]> {
  const url = new URL(DRIVE_FILES_URL)
  url.searchParams.set('q', buildFilesQuery(options))
  url.searchParams.set('orderBy', 'modifiedTime desc')
  url.searchParams.set('pageSize', String(options.limit ?? 10))
  url.searchParams.set('fields', `files(${FILE_FIELDS})`)
  const body = await client.getJson<{ files?: DriveFile[] }>(url.toString())
  return body.files ?? []
}

export async function getFile(client: GoogleClient, fileId: string): Promise<DriveFile> {
  const url = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`)
  url.searchParams.set('fields', FILE_FIELDS)
  return await client.getJson<DriveFile>(url.toString())
}

export async function exportFile(client: GoogleClient, fileId: string, mimeType: string): Promise<string> {
  const url = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/export`)
  url.searchParams.set('mimeType', mimeType)
  return await client.getText(url.toString())
}

/** Binary export — e.g. a Doc as application/pdf for visual review. */
export async function exportFileBytes(client: GoogleClient, fileId: string, mimeType: string): Promise<Uint8Array> {
  const url = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/export`)
  url.searchParams.set('mimeType', mimeType)
  return await client.getBytes(url.toString())
}

/** Permanently delete a file (bypasses trash). Used to clean up staged uploads. */
export async function deleteFile(client: GoogleClient, fileId: string): Promise<void> {
  await client.request(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, { method: 'DELETE' })
}

/** Copy a file (e.g. a branded template deck) under a new name. */
export async function copyFile(client: GoogleClient, fileId: string, title: string): Promise<DriveFile> {
  const url = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/copy`)
  url.searchParams.set('fields', FILE_FIELDS)
  return await client.postJson<DriveFile>(url.toString(), { name: title })
}

export type ShareRole = 'reader' | 'commenter' | 'writer'

/**
 * Grant access: either to one account by email (with notification), or via
 * anyone-with-link. Outward-facing — callers gate it behind explicit intent.
 */
export async function shareFile(
  client: GoogleClient,
  fileId: string,
  options: { role: ShareRole; emailAddress?: string; anyoneWithLink?: boolean },
): Promise<{ id: string }> {
  const url = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/permissions`)
  url.searchParams.set('fields', 'id')
  if (options.emailAddress) url.searchParams.set('sendNotificationEmail', 'true')
  const body = options.anyoneWithLink
    ? { type: 'anyone', role: options.role }
    : { type: 'user', role: options.role, emailAddress: options.emailAddress }
  return await client.postJson<{ id: string }>(url.toString(), body)
}

// ── Upload with conversion (markdown → Google Doc) ─────────────────────

export const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

/** RFC 2387 multipart/related body: JSON metadata part + content part. */
export function buildMultipartBody(metadata: unknown, content: string, contentType: string, boundary: string): string {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${contentType}`,
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

/** Binary variant of buildMultipartBody — byte-identical framing, raw content bytes. */
export function buildBinaryMultipartBody(
  metadata: unknown,
  content: Uint8Array,
  contentType: string,
  boundary: string,
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const head = encoder.encode(
    [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${contentType}`,
      '',
      '',
    ].join('\r\n'),
  )
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`)
  const body = new Uint8Array(head.length + content.length + tail.length)
  body.set(head, 0)
  body.set(content, head.length)
  body.set(tail, head.length + content.length)
  return body
}

function multipartInit(metadata: unknown, content: string, contentType: string): RequestInit {
  const boundary = `sky-multipart-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`
  return {
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: buildMultipartBody(metadata, content, contentType, boundary),
  }
}

/** Upload raw bytes as a plain Drive file (no conversion) — e.g. staging an image for placement. */
export async function uploadFile(
  client: GoogleClient,
  options: { name: string; mimeType: string; data: Uint8Array },
): Promise<DriveFile> {
  const url = new URL(DRIVE_UPLOAD_URL)
  url.searchParams.set('uploadType', 'multipart')
  url.searchParams.set('fields', FILE_FIELDS)
  const boundary = `sky-multipart-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`
  const res = await client.request(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: buildBinaryMultipartBody(
      { name: options.name, mimeType: options.mimeType },
      options.data,
      options.mimeType,
      boundary,
    ),
  })
  return (await res.json()) as DriveFile
}

/** Create a Google Doc from markdown via Drive's import conversion. */
export async function createDocFromMarkdown(
  client: GoogleClient,
  options: { title: string; markdown: string },
): Promise<DriveFile> {
  const url = new URL(DRIVE_UPLOAD_URL)
  url.searchParams.set('uploadType', 'multipart')
  url.searchParams.set('fields', FILE_FIELDS)
  const init = multipartInit({ name: options.title, mimeType: WORKSPACE_MIME.doc }, options.markdown, 'text/markdown')
  const res = await client.request(url.toString(), { ...init, method: 'POST' })
  return (await res.json()) as DriveFile
}

/**
 * Replace a Google Doc's entire content by re-importing markdown.
 * Destructive by design; prior content stays in Drive version history.
 */
export async function replaceFileWithMarkdown(
  client: GoogleClient,
  fileId: string,
  markdown: string,
): Promise<DriveFile> {
  const url = new URL(`${DRIVE_UPLOAD_URL}/${encodeURIComponent(fileId)}`)
  url.searchParams.set('uploadType', 'multipart')
  url.searchParams.set('fields', FILE_FIELDS)
  const init = multipartInit({}, markdown, 'text/markdown')
  const res = await client.request(url.toString(), { ...init, method: 'PATCH' })
  return (await res.json()) as DriveFile
}
