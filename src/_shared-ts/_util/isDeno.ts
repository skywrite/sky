export default function isDeno(): boolean {
  return Boolean((globalThis as any).Deno)
}
