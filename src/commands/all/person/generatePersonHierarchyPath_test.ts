import { assert, test } from '#test'
import { generatePersonHierarchyPath } from './new.ts'

const fixtures = [
  // Standard names
  { name: 'John Smith', year: 2025, expected: '2025/jo', description: 'standard first and last name' },
  { name: 'José García', year: 2025, expected: '2025/jo', description: 'name with accents' },
  { name: 'Mary-Anne Johnson', year: 2025, expected: '2025/ma', description: 'hyphenated first name' },
  { name: 'Jean-Claude Van Damme', year: 2025, expected: '2025/je', description: 'multiple part first name' },

  // Short names with padding
  { name: 'JP Morgan', year: 2025, expected: '2025/jp', description: 'two-letter first name' },
  { name: 'Bo Jackson', year: 2025, expected: '2025/bo', description: 'two-letter name (Bo)' },
  { name: 'Ed Norton', year: 2025, expected: '2025/ed', description: 'two-letter name (Ed)' },
  { name: 'A Rodriguez', year: 2025, expected: '2025/a_', description: 'single-letter first name' },
  { name: 'Q Johnson', year: 2025, expected: '2025/q_', description: 'single-letter name (Q)' },
  { name: '', year: 2025, expected: '2025/__', description: 'empty name' },

  // Single names
  { name: 'Madonna', year: 2025, expected: '2025/ma', description: 'single name (Madonna)' },
  { name: 'Cher', year: 2025, expected: '2025/ch', description: 'single name (Cher)' },
  { name: 'Prince', year: 2025, expected: '2025/pr', description: 'single name (Prince)' },
  { name: 'Bo', year: 2025, expected: '2025/bo', description: 'single two-letter name' },

  // Special characters and internationalization
  { name: 'François Müller', year: 2025, expected: '2025/fr', description: 'French name with diacritics' },
  { name: 'Søren Kjærgaard', year: 2025, expected: '2025/so', description: 'Scandinavian name' },
  { name: 'Łukasz Nowak', year: 2025, expected: '2025/lu', description: 'Polish name' },

  // Edge cases
  { name: '   John Smith   ', year: 2025, expected: '2025/jo', description: 'name with extra spaces' },
  { name: 'John  Middle  Smith', year: 2025, expected: '2025/jo', description: 'multiple spaces between names' },

  // Different years
  { name: 'Test Person', year: 2024, expected: '2024/te', description: 'different year (2024)' },
  { name: 'Test Person', year: 2026, expected: '2026/te', description: 'future year (2026)' },
]

test('generatePersonHierarchyPath', () => {
  for (const fixture of fixtures) {
    assert({
      given: fixture.description,
      should: `generate path ${fixture.expected}`,
      actual: generatePersonHierarchyPath(fixture.name, fixture.year),
      expected: fixture.expected,
    })
  }
})

test('generatePersonHierarchyPath - uses current year by default', () => {
  const currentYear = new Date().getFullYear()

  assert({
    given: 'no year parameter provided',
    should: 'use the current year',
    actual: generatePersonHierarchyPath('Test Person'),
    expected: `${currentYear}/te`,
  })
})
