// https://stackoverflow.com/questions/990904/remove-accents-diacritics-in-a-string-in-javascript

// Map of special characters to their Latin equivalents
const specialCharMap: Record<string, string> = {
  // Scandinavian
  ø: 'o',
  Ø: 'O',
  æ: 'ae',
  Æ: 'AE',
  å: 'a',
  Å: 'A',

  // Polish
  ł: 'l',
  Ł: 'L',
  ż: 'z',
  Ż: 'Z',
  ź: 'z',
  Ź: 'Z',
  ć: 'c',
  Ć: 'C',
  ń: 'n',
  Ń: 'N',
  ś: 's',
  Ś: 'S',

  // German/Dutch
  ß: 'ss',
  œ: 'oe',
  Œ: 'OE',

  // Icelandic
  ð: 'd',
  Ð: 'D',
  þ: 'th',
  Þ: 'TH',

  // Other
  đ: 'd',
  Đ: 'D',
}

export default function latinize(input: string): string {
  // First, normalize and remove diacritics
  let result = input.normalize('NFD').replace(/\p{Diacritic}/gu, '')

  // Then replace special characters that aren't diacritics
  for (const [char, replacement] of Object.entries(specialCharMap)) {
    result = result.replaceAll(char, replacement)
  }

  return result
}
