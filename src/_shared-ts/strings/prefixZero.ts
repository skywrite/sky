export default function prefixZero(index: number, n: number): string {
  const totalDigits = Math.ceil(Math.log10(n + 1))
  return String(index).padStart(totalDigits, '0')
}
