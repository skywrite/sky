export default function expand(str: string, n: number): string {
  return Array(n).fill(str).join('')
}
