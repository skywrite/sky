/**
 * Tests for selector parser.
 */

import { assert, test } from '#test'
import { parseSelector } from './parser.ts'

// =============================================================================
// Type selectors
// =============================================================================

const typeFixtures = [
  { selector: 'meeting', expectedType: 'meeting', description: 'meeting type' },
  { selector: 'person', expectedType: 'person', description: 'person type' },
  { selector: 'message', expectedType: 'message', description: 'message type' },
  { selector: 'decision', expectedType: 'decision', description: 'decision type' },
  { selector: 'project', expectedType: 'project', description: 'project type' },
  { selector: 'org', expectedType: 'org', description: 'org type' },
  { selector: 'place', expectedType: 'place', description: 'place type' },
  { selector: 'day', expectedType: 'day', description: 'day type' },
  { selector: '*', expectedType: '*', description: 'wildcard type' },
]

for (const { selector, expectedType, description } of typeFixtures) {
  test(`parseSelector - type selector: ${description}`, () => {
    const result = parseSelector(selector)

    assert({
      given: `selector "${selector}"`,
      should: `have type "${expectedType}"`,
      actual: result[0].type,
      expected: expectedType,
    })

    assert({
      given: `selector "${selector}"`,
      should: 'have no attributes',
      actual: result[0].attributes.length,
      expected: 0,
    })

    assert({
      given: `selector "${selector}"`,
      should: 'have no pseudos',
      actual: result[0].pseudos.length,
      expected: 0,
    })
  })
}

// =============================================================================
// Attribute selectors
// =============================================================================

const attributeFixtures = [
  {
    selector: 'person[org="MoonPay"]',
    expectedAttr: { name: 'org', operator: '=', value: 'MoonPay' },
    description: 'exact match',
  },
  {
    selector: 'meeting[tags~="Acme/M&A"]',
    expectedAttr: { name: 'tags', operator: '~=', value: 'Acme/M&A' },
    description: 'contains',
  },
  {
    selector: 'meeting[tags^="Acme/"]',
    expectedAttr: { name: 'tags', operator: '^=', value: 'Acme/' },
    description: 'starts with',
  },
  {
    selector: 'person[name$="Smith"]',
    expectedAttr: { name: 'name', operator: '$=', value: 'Smith' },
    description: 'ends with',
  },
  {
    selector: 'meeting[summary*="partnership"]',
    expectedAttr: { name: 'summary', operator: '*=', value: 'partnership' },
    description: 'substring',
  },
  {
    selector: 'meeting[year="2025"]',
    expectedAttr: { name: 'year', operator: '=', value: '2025' },
    description: 'year attribute',
  },
  {
    selector: 'message[medium="Slack"]',
    expectedAttr: { name: 'medium', operator: '=', value: 'Slack' },
    description: 'medium attribute',
  },
]

for (const { selector, expectedAttr, description } of attributeFixtures) {
  test(`parseSelector - attribute: ${description}`, () => {
    const result = parseSelector(selector)

    assert({
      given: `selector "${selector}"`,
      should: 'have one attribute',
      actual: result[0].attributes.length,
      expected: 1,
    })

    assert({
      given: `selector "${selector}"`,
      should: `have attribute name "${expectedAttr.name}"`,
      actual: result[0].attributes[0].name,
      expected: expectedAttr.name,
    })

    assert({
      given: `selector "${selector}"`,
      should: `have operator "${expectedAttr.operator}"`,
      actual: result[0].attributes[0].operator,
      expected: expectedAttr.operator,
    })

    assert({
      given: `selector "${selector}"`,
      should: `have value "${expectedAttr.value}"`,
      actual: result[0].attributes[0].value,
      expected: expectedAttr.value,
    })
  })
}

// =============================================================================
// Pseudo-classes
// =============================================================================

const pseudoFixtures = [
  { selector: 'meeting:today', expectedPseudo: { name: 'today' }, description: ':today' },
  { selector: 'meeting:yesterday', expectedPseudo: { name: 'yesterday' }, description: ':yesterday' },
  { selector: 'meeting:recent(7d)', expectedPseudo: { name: 'recent', value: '7d' }, description: ':recent(7d)' },
  { selector: 'meeting:recent(2w)', expectedPseudo: { name: 'recent', value: '2w' }, description: ':recent(2w)' },
  { selector: 'decision:pending', expectedPseudo: { name: 'pending' }, description: ':pending' },
  { selector: 'decision:decided', expectedPseudo: { name: 'decided' }, description: ':decided' },
  {
    selector: '*:involves("Bob Smith")',
    expectedPseudo: { name: 'involves', value: 'Bob Smith' },
    description: ':involves()',
  },
  {
    selector: 'meeting:contains("partnership")',
    expectedPseudo: { name: 'contains', value: 'partnership' },
    description: ':contains()',
  },
  {
    selector: 'meeting:date(2025-01-15)',
    expectedPseudo: { name: 'date', value: '2025-01-15' },
    description: ':date()',
  },
]

for (const { selector, expectedPseudo, description } of pseudoFixtures) {
  test(`parseSelector - pseudo: ${description}`, () => {
    const result = parseSelector(selector)

    assert({
      given: `selector "${selector}"`,
      should: 'have one pseudo',
      actual: result[0].pseudos.length,
      expected: 1,
    })

    assert({
      given: `selector "${selector}"`,
      should: `have pseudo name "${expectedPseudo.name}"`,
      actual: result[0].pseudos[0].name,
      expected: expectedPseudo.name,
    })

    if (expectedPseudo.value !== undefined) {
      assert({
        given: `selector "${selector}"`,
        should: `have pseudo value "${expectedPseudo.value}"`,
        actual: result[0].pseudos[0].value,
        expected: expectedPseudo.value,
      })
    }
  })
}

// =============================================================================
// :has() pseudo-class
// =============================================================================

test('parseSelector - :has() with attribute', () => {
  const result = parseSelector('meeting:has([who~="Alice"])')

  assert({
    given: 'selector with :has()',
    should: 'have pseudo name "has"',
    actual: result[0].pseudos[0].name,
    expected: 'has',
  })

  assert({
    given: 'selector with :has()',
    should: 'have inner selector',
    actual: result[0].pseudos[0].innerSelector !== undefined,
    expected: true,
  })

  assert({
    given: 'selector with :has()',
    should: 'have inner attribute who',
    actual: result[0].pseudos[0].innerSelector?.attributes[0].name,
    expected: 'who',
  })
})

// =============================================================================
// :not() pseudo-class
// =============================================================================

test('parseSelector - :not() with attribute', () => {
  const result = parseSelector('person:not([org])')

  assert({
    given: 'selector with :not()',
    should: 'have pseudo name "not"',
    actual: result[0].pseudos[0].name,
    expected: 'not',
  })

  assert({
    given: 'selector with :not()',
    should: 'have inner selector',
    actual: result[0].pseudos[0].innerSelector !== undefined,
    expected: true,
  })

  assert({
    given: 'selector with :not()',
    should: 'have inner attribute org',
    actual: result[0].pseudos[0].innerSelector?.attributes[0].name,
    expected: 'org',
  })
})

// =============================================================================
// Combined selectors (AND - chaining)
// =============================================================================

test('parseSelector - multiple attributes (AND)', () => {
  const result = parseSelector('meeting[year="2025"][tags~="Acme/M&A"]')

  assert({
    given: 'selector with multiple attributes',
    should: 'have type meeting',
    actual: result[0].type,
    expected: 'meeting',
  })

  assert({
    given: 'selector with multiple attributes',
    should: 'have 2 attributes',
    actual: result[0].attributes.length,
    expected: 2,
  })
})

test('parseSelector - attribute and pseudo (AND)', () => {
  const result = parseSelector('meeting:recent(7d)[medium="Zoom"]')

  assert({
    given: 'selector with attribute and pseudo',
    should: 'have 1 attribute',
    actual: result[0].attributes.length,
    expected: 1,
  })

  assert({
    given: 'selector with attribute and pseudo',
    should: 'have 1 pseudo',
    actual: result[0].pseudos.length,
    expected: 1,
  })
})

// =============================================================================
// Union selectors (OR - comma)
// =============================================================================

test('parseSelector - comma-separated (OR)', () => {
  const result = parseSelector('meeting:today, message:today')

  assert({
    given: 'comma-separated selector',
    should: 'return 2 selectors',
    actual: result.length,
    expected: 2,
  })

  assert({
    given: 'comma-separated selector',
    should: 'have first type meeting',
    actual: result[0].type,
    expected: 'meeting',
  })

  assert({
    given: 'comma-separated selector',
    should: 'have second type message',
    actual: result[1].type,
    expected: 'message',
  })
})

// =============================================================================
// Complex selectors
// =============================================================================

test('parseSelector - complex selector', () => {
  const result = parseSelector('meeting:recent(7d)[medium="Zoom"]:has([who~="Alice"])')

  assert({
    given: 'complex selector',
    should: 'have type meeting',
    actual: result[0].type,
    expected: 'meeting',
  })

  assert({
    given: 'complex selector',
    should: 'have 1 attribute (medium)',
    actual: result[0].attributes.length,
    expected: 1,
  })

  assert({
    given: 'complex selector',
    should: 'have 2 pseudos (recent, has)',
    actual: result[0].pseudos.length,
    expected: 2,
  })
})
