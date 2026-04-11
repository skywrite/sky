import { assert, test } from '#test'
import latinize from './latinize.ts'

const fixtures = [
  // French diacritics
  { input: 'François', expected: 'Francois', description: 'French name with cedilla' },
  { input: 'André', expected: 'Andre', description: 'French name with acute accent' },
  { input: 'Hélène', expected: 'Helene', description: 'French name with grave accent' },
  { input: 'Noël', expected: 'Noel', description: 'French name with diaeresis' },
  { input: 'Château', expected: 'Chateau', description: 'French word with circumflex' },
  { input: 'Crème Brûlée', expected: 'Creme Brulee', description: 'French with multiple diacritics' },

  // Spanish/Portuguese diacritics
  { input: 'José', expected: 'Jose', description: 'Spanish name with acute accent' },
  { input: 'María', expected: 'Maria', description: 'Spanish name with acute accent' },
  { input: 'São Paulo', expected: 'Sao Paulo', description: 'Portuguese with tilde' },
  { input: 'Niño', expected: 'Nino', description: 'Spanish with tilde' },

  // German/Nordic characters
  { input: 'Müller', expected: 'Muller', description: 'German umlaut u' },
  { input: 'Björk', expected: 'Bjork', description: 'Nordic o with umlaut' },
  { input: 'Jürgen', expected: 'Jurgen', description: 'German umlaut u' },
  { input: 'Große', expected: 'Grosse', description: 'German eszett' },

  // Scandinavian special letters
  { input: 'Søren', expected: 'Soren', description: 'Danish/Norwegian ø' },
  { input: 'Kjærgaard', expected: 'Kjaergaard', description: 'Danish/Norwegian æ' },
  { input: 'Håkon', expected: 'Hakon', description: 'Norwegian å' },
  { input: 'Ægir', expected: 'AEgir', description: 'Norse Æ' },
  { input: 'BJØRN', expected: 'BJORN', description: 'Uppercase Norwegian ø' },

  // Polish characters
  { input: 'Łukasz', expected: 'Lukasz', description: 'Polish ł' },
  { input: 'Żółć', expected: 'Zolc', description: 'Polish special characters' },
  { input: 'Grzegorz', expected: 'Grzegorz', description: 'Polish rz (no change needed)' },
  { input: 'Michał', expected: 'Michal', description: 'Polish ł' },
  { input: 'Kraków', expected: 'Krakow', description: 'Polish city name' },

  // Icelandic characters
  { input: 'Þórsteinn', expected: 'THorsteinn', description: 'Icelandic thorn (þ)' },
  { input: 'Guðmundur', expected: 'Gudmundur', description: 'Icelandic eth (ð)' },
  { input: 'Sigurðsson', expected: 'Sigurdsson', description: 'Icelandic patronymic' },

  // Czech/Slovak characters
  { input: 'Dvořák', expected: 'Dvorak', description: 'Czech ř and á' },
  { input: 'Čech', expected: 'Cech', description: 'Czech č' },
  { input: 'Šťastný', expected: 'Stastny', description: 'Czech/Slovak special chars' },

  // Mixed cases
  { input: 'Jean-François', expected: 'Jean-Francois', description: 'Hyphenated French name' },
  { input: 'María José', expected: 'Maria Jose', description: 'Spanish compound name' },
  { input: 'Åse-Marie', expected: 'Ase-Marie', description: 'Norwegian hyphenated name' },

  // Edge cases
  { input: '', expected: '', description: 'Empty string' },
  { input: 'John', expected: 'John', description: 'ASCII-only name' },
  { input: '李明', expected: '李明', description: 'Chinese characters (unchanged)' },

  // Special ligatures
  { input: 'Œuvre', expected: 'OEuvre', description: 'French OE ligature' },
  { input: 'œuf', expected: 'oeuf', description: 'Lowercase oe ligature' },

  // Case preservation
  { input: 'JOSÉ', expected: 'JOSE', description: 'Uppercase preservation' },
  { input: 'mÜlLeR', expected: 'mUlLeR', description: 'Mixed case preservation' },
]

test('latinize', () => {
  for (const fixture of fixtures) {
    assert({
      given: fixture.description,
      should: `convert "${fixture.input}" to "${fixture.expected}"`,
      actual: latinize(fixture.input),
      expected: fixture.expected,
    })
  }
})
