import { createHash, createPublicKey, verify } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { runCommand } from '#lib/sys/mod.ts'

export const APPLE_PASSWORDS_ID = 'pejdijmoenmkgeppbflobdenhhabjlaj'
const LIMIT = 16 * 1024 * 1024

// CRX3 proofs cover the signed header and the complete ZIP, not just the manifest.
function fields(bytes: Buffer): Map<number, Buffer[]> {
  let offset = 0
  const number = () => {
    let value = 0
    for (let shift = 0; shift < 35 && offset < bytes.length; shift += 7) {
      const byte = bytes[offset++]
      value += (byte & 127) * 2 ** shift
      if (!(byte & 128)) return value
    }
    throw new Error('Invalid extension header')
  }
  const result = new Map<number, Buffer[]>()
  while (offset < bytes.length) {
    const tag = number()
    if (tag % 8 !== 2) throw new Error('Invalid extension header')
    const length = number()
    if (offset + length > bytes.length) throw new Error('Invalid extension header')
    const key = Math.floor(tag / 8)
    result.set(key, [...(result.get(key) ?? []), bytes.subarray(offset, offset + length)])
    offset += length
  }
  return result
}

/** Only Apple's public extension signing key can authorize this payload. */
export function verifyBrowserExtension(bytes: Buffer, expectedId: string): Buffer {
  if (
    bytes.length < 12 ||
    bytes.length > LIMIT ||
    bytes.toString('ascii', 0, 4) !== 'Cr24' ||
    bytes.readUInt32LE(4) !== 3
  )
    throw new Error('Invalid Apple Passwords extension')
  const length = bytes.readUInt32LE(8)
  if (length > 65536 || 12 + length >= bytes.length) throw new Error('Invalid extension header')
  const header = fields(bytes.subarray(12, 12 + length))
  const signed = header.get(10000)
  if (signed?.length !== 1) throw new Error('Invalid extension signature')
  const zip = bytes.subarray(12 + length)
  const size = Buffer.alloc(4)
  size.writeUInt32LE(signed[0].length)
  const message = Buffer.concat([Buffer.from('CRX3 SignedData\0'), size, signed[0], zip])
  for (const proof of header.get(2) ?? []) {
    const entry = fields(proof)
    const key = entry.get(1)?.[0]
    const signature = entry.get(2)?.[0]
    if (!key || !signature) continue
    const id = createHash('sha256')
      .update(key)
      .digest('hex')
      .slice(0, 32)
      .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)))
    const signedId = fields(signed[0]).get(1)?.[0]
    if (
      id === expectedId &&
      signedId?.equals(createHash('sha256').update(key).digest().subarray(0, 16)) &&
      verify('sha256', message, createPublicKey({ key, format: 'der', type: 'spki' }), signature)
    )
      return zip
  }
  throw new Error('Apple Passwords signature did not match')
}

export const verifyAppleExtension = (bytes: Buffer): Buffer => verifyBrowserExtension(bytes, APPLE_PASSWORDS_ID)

/** Explicit setup only; never visits a vault or installs into the person's browser profile. */
export async function prepareAppleExtension(directory: string): Promise<string> {
  const archive = path.join(directory, 'apple-passwords.crx')
  try {
    verifyAppleExtension(await readFile(archive))
    return archive
  } catch {
    /* Fetch a fresh, authenticated vendor package. */
  }
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=150.0.0.0&acceptformat=crx3&x=id%3D${APPLE_PASSWORDS_ID}%26uc`
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!response.ok || !response.body) throw new Error('Apple Passwords download failed')
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > LIMIT) throw new Error('Apple Passwords package is too large')
    chunks.push(chunk)
  }
  const bytes = Buffer.concat(chunks)
  verifyAppleExtension(bytes)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = `${archive}.${crypto.randomUUID()}`
  try {
    await writeFile(temporary, bytes, { mode: 0o600 })
    await rename(temporary, archive)
  } finally {
    await rm(temporary, { force: true })
  }
  return archive
}

/** Reverify at every launch and unpack into this task's disposable directory. */
export async function unpackAppleExtension(archive: string, directory: string): Promise<string> {
  const zip = verifyAppleExtension(await readFile(archive))
  const file = path.join(directory, 'apple-passwords.zip')
  await writeFile(file, zip, { mode: 0o600 })
  const entries = await runCommand('/usr/bin/unzip', ['-Z1', file], { timeout: 10000, maxBuffer: 1024 * 1024 })
  if (
    !entries.success ||
    entries.stdout.split('\n').some((entry) => entry.startsWith('/') || entry.split('/').includes('..'))
  )
    throw new Error('Invalid extension archive')
  const extension = path.join(directory, 'apple-passwords')
  const result = await runCommand('/usr/bin/ditto', ['-xk', file, extension], { timeout: 10000 })
  if (!result.success) throw new Error('Apple Passwords could not be prepared')
  return extension
}
