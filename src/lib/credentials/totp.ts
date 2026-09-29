import { createHmac } from 'node:crypto'
import { Instant, instantNow } from '#universal/dates/nbdt/mod.ts'
import { CredentialError } from './errors.ts'
import { SensitiveValue } from './SensitiveValue.ts'
import type { OtpCode } from './types.ts'

/** RFC 6238, for explicit otpauth://totp setup values held by a secret provider. */
export function generateTotp(uri: string, at = instantNow()): OtpCode {
  try {
    const url = new URL(uri)
    if (url.protocol !== 'otpauth:' || url.hostname !== 'totp' || url.username || url.password || url.hash)
      throw new CredentialError('invalid-input')
    for (const name of ['secret', 'algorithm', 'digits', 'period'])
      if (url.searchParams.getAll(name).length > 1) throw new CredentialError('invalid-input')
    const secret = url.searchParams.get('secret') ?? ''
    const algorithm = (url.searchParams.get('algorithm') ?? 'SHA1').toLowerCase()
    const digits = Number(url.searchParams.get('digits') ?? '6')
    const period = Number(url.searchParams.get('period') ?? '30')
    if (
      !['sha1', 'sha256', 'sha512'].includes(algorithm) ||
      ![6, 8].includes(digits) ||
      !Number.isSafeInteger(period) ||
      period < 1 ||
      period > 86400
    )
      throw new CredentialError('invalid-input')
    const milliseconds = Instant.from(at).epochMilliseconds
    if (milliseconds < 0) throw new CredentialError('invalid-input')
    const counter = Math.floor(milliseconds / 1000 / period)
    const bytes = Buffer.alloc(8)
    bytes.writeBigUInt64BE(BigInt(counter))
    const digest = createHmac(algorithm, decodeBase32(secret)).update(bytes).digest()
    const offset = digest[digest.length - 1] & 15
    const code = String((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, '0')
    return {
      code: new SensitiveValue(code),
      expiresAt: Instant.fromEpochMilliseconds((counter + 1) * period * 1000).toString(),
    }
  } catch {
    // URL/crypto errors can include the entire setup secret.
    throw new CredentialError('invalid-input')
  }
}

function decodeBase32(input: string): Buffer {
  if (!/^[A-Z2-7]+={0,6}$/i.test(input)) throw new CredentialError('invalid-input')
  const text = input.replace(/=+$/, '').toUpperCase()
  if (![0, 2, 4, 5, 7].includes(text.length % 8)) throw new CredentialError('invalid-input')
  if (input.includes('=') && input.length % 8 !== 0) throw new CredentialError('invalid-input')
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of text) {
    buffer = (buffer << 5) | alphabet.indexOf(char)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >>> bits) & 255)
      buffer &= (1 << bits) - 1
    }
  }
  if (buffer !== 0 || bytes.length === 0) throw new CredentialError('invalid-input')
  return Buffer.from(bytes)
}
