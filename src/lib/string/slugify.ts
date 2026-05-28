import stripPunctuation from './stripPunctuation.ts'
import latinize from './latinize.ts'

export interface SlugifyOptions {
  suggestedLength?: number
  suggestedWords?: number
  preserveCase?: boolean
}

export default function slugify(input: string, opts?: SlugifyOptions | number): string {
  if (typeof input === 'undefined') return ''

  // maintain backwards compatibility for now
  let suggestedLen
  let suggestedWords: number | undefined
  if (typeof opts === 'number') suggestedLen = opts
  if (typeof opts === 'object') {
    suggestedLen = opts.suggestedLength
    suggestedWords = opts.suggestedWords
  }

  if (typeof opts === 'undefined') opts = {}

  // pre-truncate by words before the char-level pipeline (so hyphenated
  // tokens like 'foo-bar' count as one word, matching word-boundary intent)
  if (suggestedWords) {
    input = input.trim().split(/\s+/).slice(0, suggestedWords).join(' ')
  }

  // hack to keep the '-' and not get stripped
  input = input.replaceAll('-', ' ')

  let newStr = stripPunctuation(latinize(input))
    .replaceAll("'", '')
    .replaceAll(' ', '-')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/-{2,}/g, '-')

  if (!(<SlugifyOptions>opts).preserveCase) {
    newStr = newStr.toLowerCase()
  }

  let sliceLength = newStr.length
  if (suggestedLen) sliceLength = _determineSliceLength(newStr, suggestedLen)

  newStr = newStr.slice(0, sliceLength)

  // hack something is fucked in determineSliceLength, this catches it
  if (newStr.endsWith('-')) newStr = newStr.replace(/\-$/, '')

  return newStr
}

function _determineSliceLength(input: string, suggestedLen: number): number {
  if (suggestedLen > input.length) return input.length

  const nextSpacePos = input.indexOf('-', suggestedLen - 1)
  if (nextSpacePos > -1) return nextSpacePos

  // no space, round up to string length
  return input.length
}
