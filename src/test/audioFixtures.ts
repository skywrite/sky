/** Only for tests that replace decoding with scripted words after this container header. */
export const CAF_TEST_HEADER = 'caff\0\u0001\0\0'

/** One second of synthetic silence in a complete, uncompressed CAF container. */
export function silentCaf(): Uint8Array<ArrayBuffer> {
  const samples = 8000
  const bytes = new Uint8Array(68 + samples * 2)
  const view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset)
  text(0, CAF_TEST_HEADER)
  text(8, 'desc')
  view.setBigInt64(12, 32n)
  view.setFloat64(20, samples)
  text(28, 'lpcm')
  view.setUint32(36, 2)
  view.setUint32(40, 1)
  view.setUint32(44, 1)
  view.setUint32(48, 16)
  text(52, 'data')
  view.setBigInt64(56, BigInt(4 + samples * 2))
  return bytes
}
