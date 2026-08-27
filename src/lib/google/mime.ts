import { Buffer } from 'node:buffer'
import type { GmailAddress } from './gmail.ts'

// RFC 5322 / MIME message builder for Gmail drafts: a single text/html part.
// HTML (not text/plain) so Gmail opens the draft in its normal rich compose,
// where paragraphs flow — a text/plain draft opens in plain-text mode, which
// hard-wraps lines at ~76 columns on send. The draft is finished and sent by
// hand in Gmail, which re-encodes on send, so this stays the minimum that
// round-trips any UTF-8 subject and body intact.

export interface MimeMessageInput {
  to?: GmailAddress[]
  cc?: GmailAddress[]
  bcc?: GmailAddress[]
  subject?: string
  /** HTML body (see emailHtml.ts); any line-ending style, normalized to CRLF. */
  html: string
}

const CRLF = '\r\n'
/** RFC 2047 caps an encoded-word at 75 chars: 45 UTF-8 bytes → 60 base64 chars + 12 chars of framing. */
const ENCODED_WORD_BYTES = 45
/** RFC 2045 line limit for base64 bodies. */
const BASE64_LINE = 76

export function buildMimeMessage(input: MimeMessageInput): string {
  const headers: string[] = []
  const addressHeader = (name: string, list: GmailAddress[] | undefined) => {
    if (list && list.length > 0) headers.push(`${name}: ${list.map(formatAddress).join(', ')}`)
  }
  addressHeader('To', input.to)
  addressHeader('Cc', input.cc)
  addressHeader('Bcc', input.bcc)
  const subject = encodeHeaderText(input.subject ?? '')
  if (subject) headers.push(`Subject: ${subject}`)
  headers.push('MIME-Version: 1.0', 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64')

  const body = Buffer.from(input.html.replace(/\r\n?|\n/g, CRLF), 'utf-8').toString('base64')
  return [...headers, '', ...chunk(body, BASE64_LINE)].join(CRLF) + CRLF
}

/** `"Jane Doe" <jane@example.com>`; a non-ASCII display name becomes an encoded-word. */
export function formatAddress(address: GmailAddress): string {
  const mailbox = (address.address ?? '').trim()
  if (!mailbox) throw new Error(`Recipient has no email address: ${address.name ?? '(unnamed)'}`)
  const name = singleLine(address.name ?? '').trim()
  if (!name) return mailbox
  const display = isPrintableAscii(name) ? `"${name.replace(/(["\\])/g, '\\$1')}"` : encodeWords(name)
  return `${display} <${mailbox}>`
}

/** Header text as one logical line: verbatim when printable ASCII, RFC 2047 encoded-words otherwise. */
export function encodeHeaderText(text: string): string {
  const clean = singleLine(text).trim()
  return isPrintableAscii(clean) ? clean : encodeWords(clean)
}

/** A header value must be one line — a CR/LF inside it would start a new header (Bcc injection). */
function singleLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ')
}

function isPrintableAscii(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text)
}

/** Split on code points so no UTF-8 sequence straddles two encoded-words; fold with CRLF + space. */
function encodeWords(text: string): string {
  const words: string[] = []
  let current = ''
  for (const ch of text) {
    if (Buffer.byteLength(current + ch, 'utf-8') > ENCODED_WORD_BYTES) {
      words.push(current)
      current = ''
    }
    current += ch
  }
  if (current) words.push(current)
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf-8').toString('base64')}?=`).join(`${CRLF} `)
}

function chunk(text: string, size: number): string[] {
  const lines: string[] = []
  for (let i = 0; i < text.length; i += size) lines.push(text.slice(i, i + size))
  return lines
}
