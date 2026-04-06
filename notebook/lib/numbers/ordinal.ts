// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules/PluralRules
const ENGLISH_ORDINAL_RULES = new Intl.PluralRules('en', { type: 'ordinal' })

const SUFFIXES = {
  zero: '', // I don't think valid for English
  many: '', // I don't think valid for English
  one: 'st',
  two: 'nd',
  few: 'rd',
  other: 'th',
}

export default function ordinal(num: number): string {
  const rule = ENGLISH_ORDINAL_RULES.select(num)
  if (rule === 'zero' || rule === 'many') {
    console.log(`WARN: numbers/ordinal(): ${num} returned ${rule}.`)
  }

  const suffix = SUFFIXES[rule]
  return `${num}${suffix}`
}
