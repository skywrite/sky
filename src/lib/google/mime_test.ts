import { Buffer } from 'node:buffer'
import { assert, test } from '#test'
import { buildMimeMessage, encodeHeaderText, formatAddress } from './mime.ts'

const CRLF = '\r\n'

/** Undo RFC 2047 B-encoding the way a mail client does: folding whitespace between words is dropped. */
function decodeWords(header: string): string {
  return header
    .replace(/(\?=)\r\n\s+(=\?)/g, '$1$2')
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_match, b64: string) => Buffer.from(b64, 'base64').toString('utf-8'))
}

test('buildMimeMessage', () => {
  const message = buildMimeMessage({
    to: [{ name: 'Jane Doe', address: 'jane@example.com' }, { address: 'bob@example.com' }],
    cc: [{ address: 'lead@example.com' }],
    subject: 'Atlas kickoff',
    html: '<p>Hi Jane,</p>\n<p>Thursday works?\r\nBest</p>',
  })

  assert({
    given: 'an ASCII message with two To and one Cc recipient',
    should: 'emit RFC 5322 headers, a blank line, and the CRLF-normalized HTML body as base64',
    expected: [
      'To: "Jane Doe" <jane@example.com>, bob@example.com',
      'Cc: lead@example.com',
      'Subject: Atlas kickoff',
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('<p>Hi Jane,</p>\r\n<p>Thursday works?\r\nBest</p>', 'utf-8').toString('base64'),
      '',
    ].join(CRLF),
    actual: message,
  })
})

test('buildMimeMessage without recipients or subject', () => {
  assert({
    given: 'only a body',
    should: 'skip the address and Subject headers so Gmail shows an addressless, untitled draft',
    expected: [
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('<p>draft body</p>', 'utf-8').toString('base64'),
      '',
    ].join(CRLF),
    actual: buildMimeMessage({ html: '<p>draft body</p>' }),
  })
})

test('buildMimeMessage body wrapping', () => {
  const html = `<p>${'A long paragraph that keeps going. '.repeat(40)}</p>`
  const message = buildMimeMessage({ html })
  const lines = message
    .split(CRLF + CRLF)[1]
    .split(CRLF)
    .filter(Boolean)

  assert({
    given: 'a body whose base64 runs past one line',
    should: 'wrap the base64 at 76 chars and still decode back to the HTML',
    expected: [true, true, html],
    actual: [
      lines.length > 1,
      lines.every((line) => line.length <= 76),
      Buffer.from(lines.join(''), 'base64').toString('utf-8'),
    ],
  })
})

test('encodeHeaderText', () => {
  const long = 'Café ünïcode – '.repeat(8)
  const encoded = encodeHeaderText(long)
  const lines = encoded.split(CRLF)

  assert({
    given: 'ASCII, non-ASCII, long non-ASCII, and multi-line header text',
    should: 'pass ASCII through, encode the rest as folded encoded-words that decode back, and keep one line',
    expected: ['Atlas kickoff', '=?UTF-8?B?Q2Fmw6k=?=', true, long.trim(), 'Hi Bcc: evil@example.com'],
    actual: [
      encodeHeaderText('Atlas kickoff'),
      encodeHeaderText('Café'),
      lines.length > 1 && lines.every((line) => line.length <= 76),
      decodeWords(encoded),
      encodeHeaderText('Hi\r\nBcc: evil@example.com'),
    ],
  })
})

test('formatAddress', () => {
  let rejected = ''
  try {
    formatAddress({ name: 'Nobody' })
  } catch (err) {
    rejected = (err as Error).message
  }

  assert({
    given: 'bare, named, special-character-named, non-ASCII-named, and addressless recipients',
    should: 'quote ASCII display names (escaping quotes), encode non-ASCII ones, and reject a missing address',
    expected: [
      'jane@example.com',
      '"Jane Doe" <jane@example.com>',
      '"Doe, Jane \\"JD\\"" <jane@example.com>',
      '=?UTF-8?B?Wm/DqyBEb2U=?= <zoe@example.com>',
      'Recipient has no email address: Nobody',
    ],
    actual: [
      formatAddress({ address: 'jane@example.com' }),
      formatAddress({ name: 'Jane Doe', address: 'jane@example.com' }),
      formatAddress({ name: 'Doe, Jane "JD"', address: 'jane@example.com' }),
      formatAddress({ name: 'Zoë Doe', address: 'zoe@example.com' }),
      rejected,
    ],
  })
})
