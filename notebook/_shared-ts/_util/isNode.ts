export default function isNode(): boolean {
  return Boolean((globalThis as any).process)
}
