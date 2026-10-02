import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { assert, test } from '#test'
import { verifyAppleExtension, verifyBrowserExtension } from './applePasswords.ts'

const integer = (value: number) => {
  const bytes: number[] = []
  do {
    bytes.push((value & 127) | (value > 127 ? 128 : 0))
    value >>>= 7
  } while (value)
  return Buffer.from(bytes)
}
const field = (tag: number, value: Buffer) => Buffer.concat([integer(tag * 8 + 2), integer(value.length), value])

test('CRX verification authenticates the publisher and all package bytes before extraction', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const key = publicKey.export({ format: 'der', type: 'spki' })
  const hash = createHash('sha256').update(key).digest()
  const id = hash
    .toString('hex')
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)))
  const signedHeader = field(1, hash.subarray(0, 16))
  const zip = Buffer.from('Synthetic extension package payload')
  const size = Buffer.alloc(4)
  size.writeUInt32LE(signedHeader.length)
  const signature = sign(
    'sha256',
    Buffer.concat([Buffer.from('CRX3 SignedData\0'), size, signedHeader, zip]),
    privateKey,
  )
  const header = Buffer.concat([
    field(2, Buffer.concat([field(1, key), field(2, signature)])),
    field(10000, signedHeader),
  ])
  const prefix = Buffer.alloc(12)
  prefix.write('Cr24')
  prefix.writeUInt32LE(3, 4)
  prefix.writeUInt32LE(header.length, 8)
  const archive = Buffer.concat([prefix, header, zip])
  const tampered = Buffer.from(archive)
  tampered[tampered.length - 1] ^= 1
  const rejected = (work: () => unknown) => {
    try {
      work()
      return false
    } catch {
      return true
    }
  }
  assert({
    given: 'a synthetic signed package, a changed payload, a different publisher, and malformed data',
    should: 'accept only the complete package signed by the pinned publisher; never accept it as Apple',
    actual: [
      verifyBrowserExtension(archive, id).toString(),
      rejected(() => verifyBrowserExtension(tampered, id)),
      rejected(() => verifyAppleExtension(archive)),
      rejected(() => verifyAppleExtension(Buffer.alloc(0))),
      rejected(() => verifyBrowserExtension(archive.subarray(0, 30), id)),
    ],
    expected: [zip.toString(), true, true, true, true],
  })
})
