import type { GoogleClient } from './client.ts'
import { DRIVE_FILES_URL } from './drive.ts'

// The Drive comments API rejects calls without an explicit fields selector.
const COMMENT_FIELDS = 'id,content,author(displayName,me),createdTime,resolved,quotedFileContent(value)'
const LIST_FIELDS = `comments(${COMMENT_FIELDS},replies(content,author(displayName,me),createdTime)),nextPageToken`

export interface DriveCommentAuthor {
  displayName?: string
  me?: boolean
}

export interface DriveComment {
  id: string
  content?: string
  author?: DriveCommentAuthor
  createdTime?: string
  resolved?: boolean
  quotedFileContent?: { value?: string }
  replies?: Array<{ content?: string; author?: DriveCommentAuthor; createdTime?: string }>
}

/**
 * Leave a file-level comment. Anchored comments are not reliably creatable by
 * third-party apps on Google-editor files (the anchor format is undocumented
 * and silently degrades), so location context belongs in the content itself
 * ("Slide 3: ...").
 */
export async function createComment(client: GoogleClient, fileId: string, content: string): Promise<DriveComment> {
  const url = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/comments`)
  url.searchParams.set('fields', COMMENT_FIELDS)
  return await client.postJson<DriveComment>(url.toString(), { content })
}

const MAX_COMMENTS = 300

export async function listComments(
  client: GoogleClient,
  fileId: string,
  options: { includeResolved?: boolean } = {},
): Promise<DriveComment[]> {
  const comments: DriveComment[] = []
  let pageToken: string | undefined
  do {
    const url = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/comments`)
    url.searchParams.set('fields', LIST_FIELDS)
    url.searchParams.set('pageSize', '100')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const body = await client.getJson<{ comments?: DriveComment[]; nextPageToken?: string }>(url.toString())
    comments.push(...(body.comments ?? []))
    pageToken = body.nextPageToken
  } while (pageToken && comments.length < MAX_COMMENTS)
  return options.includeResolved ? comments : comments.filter((c) => !c.resolved)
}

export interface DriveReply {
  id: string
  content?: string
  action?: string
}

const REPLY_FIELDS = 'id,content,action'

/** Reply on a comment thread; with resolve, the reply also closes the thread. */
export async function createReply(
  client: GoogleClient,
  fileId: string,
  commentId: string,
  options: { content: string; resolve?: boolean },
): Promise<DriveReply> {
  const url = new URL(
    `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(commentId)}/replies`,
  )
  url.searchParams.set('fields', REPLY_FIELDS)
  const body: Record<string, unknown> = { content: options.content }
  if (options.resolve) body.action = 'resolve'
  return await client.postJson<DriveReply>(url.toString(), body)
}

export interface CompactComment {
  id: string
  author: string
  created?: string
  content: string
  quoted?: string
  resolved?: boolean
  replyCount: number
}

const CONTENT_LIMIT = 300

/** Compact comments for the agent: who, when, what — truncated, reply-counted. */
export function compactComments(comments: DriveComment[]): CompactComment[] {
  return comments.map((comment) => {
    const name = comment.author?.displayName ?? 'Unknown'
    const content = (comment.content ?? '').trim()
    const compact: CompactComment = {
      id: comment.id,
      author: comment.author?.me ? `${name} (me)` : name,
      created: comment.createdTime,
      content: content.length > CONTENT_LIMIT ? `${content.slice(0, CONTENT_LIMIT)}…` : content,
      replyCount: comment.replies?.length ?? 0,
    }
    const quoted = comment.quotedFileContent?.value?.trim()
    if (quoted) compact.quoted = quoted.length > 120 ? `${quoted.slice(0, 120)}…` : quoted
    if (comment.resolved) compact.resolved = true
    return compact
  })
}
