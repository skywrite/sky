import { assert, test } from '#test'
import Organization from './mod.ts'

const fixtures = [
  {
    description: 'no kind tags set',
    yaml: {
      name: 'Anthropic',
      slug: 'anthropic',
      sector: 'tech',
      subcategory: 'ai',
    },
    expected: 'unknown',
  },
  {
    description: 'Organization/Company tag set',
    yaml: {
      name: 'Anthropic',
      slug: 'anthropic',
      sector: 'tech',
      subcategory: 'ai',
      tags: 'Organization/Company',
    },
    expected: 'company',
  },
  {
    description: 'Organization/Government tag set',
    yaml: {
      name: 'SEC',
      slug: 'sec',
      sector: 'regulators',
      subcategory: 'United States',
      tags: 'Organization/Government',
    },
    expected: 'government',
  },
  {
    description: 'Organization/Nonprofit tag set',
    yaml: {
      name: 'Coin Center',
      slug: 'coin-center',
      sector: 'advocacy-political',
      subcategory: 'nonprofits',
      tags: 'Organization/Nonprofit',
    },
    expected: 'nonprofit',
  },
  {
    description: 'multiple kind tags (uses first)',
    yaml: {
      name: 'Ambiguous Org',
      slug: 'ambiguous-org',
      sector: 'tech',
      subcategory: 'ai',
      tags: 'Organization/Company; Organization/Government',
    },
    expected: 'company',
  },
  {
    description: 'kind tag with other tags',
    yaml: {
      name: 'Acme',
      slug: 'acme',
      sector: 'crypto',
      subcategory: 'wallets',
      tags: 'crypto; wallet; self-custody; Organization/Company',
    },
    expected: 'company',
  },
]

fixtures.forEach((fixture) => {
  test(`Organization.kind - ${fixture.description}`, () => {
    const org = Organization.create(fixture.yaml)

    assert({
      given: fixture.description,
      should: `return ${fixture.expected}`,
      actual: org.kind,
      expected: fixture.expected,
    })
  })
})

const setKindFixtures = [
  {
    description: 'set company kind on org with no tags',
    initial: {
      name: 'Anthropic',
      slug: 'anthropic',
      sector: 'tech',
      subcategory: 'ai',
    },
    kind: 'company' as const,
    expectedKind: 'company',
    expectedHasTag: 'Organization/Company',
  },
  {
    description: 'set government kind on org with no tags',
    initial: {
      name: 'SEC',
      slug: 'sec',
      sector: 'regulators',
      subcategory: 'United States',
    },
    kind: 'government' as const,
    expectedKind: 'government',
    expectedHasTag: 'Organization/Government',
  },
  {
    description: 'set nonprofit kind on org with no tags',
    initial: {
      name: 'Coin Center',
      slug: 'coin-center',
      sector: 'advocacy-political',
      subcategory: 'nonprofits',
    },
    kind: 'nonprofit' as const,
    expectedKind: 'nonprofit',
    expectedHasTag: 'Organization/Nonprofit',
  },
  {
    description: 'change company to government',
    initial: {
      name: 'Org',
      slug: 'org',
      sector: 'tech',
      subcategory: 'ai',
      tags: 'Organization/Company',
    },
    kind: 'government' as const,
    expectedKind: 'government',
    expectedHasTag: 'Organization/Government',
    expectedNotHasTag: 'Organization/Company',
  },
  {
    description: 'set unknown removes all kind tags',
    initial: {
      name: 'Org',
      slug: 'org',
      sector: 'tech',
      subcategory: 'ai',
      tags: 'Organization/Company',
    },
    kind: 'unknown' as const,
    expectedKind: 'unknown',
    expectedNotHasTag: 'Organization/Company',
  },
  {
    description: 'set company preserves other tags',
    initial: {
      name: 'Acme',
      slug: 'acme',
      sector: 'crypto',
      subcategory: 'wallets',
      tags: 'crypto; wallet; self-custody',
    },
    kind: 'company' as const,
    expectedKind: 'company',
    expectedHasTag: 'Organization/Company',
    expectedOtherTags: ['crypto', 'wallet', 'self-custody'],
  },
]

setKindFixtures.forEach((fixture) => {
  test(`Organization.setKind - ${fixture.description}`, () => {
    const org = Organization.create(fixture.initial)
    const updated = org.setKind(fixture.kind)

    assert({
      given: fixture.description,
      should: `return kind ${fixture.expectedKind}`,
      actual: updated.kind,
      expected: fixture.expectedKind,
    })

    if (fixture.expectedHasTag) {
      assert({
        given: fixture.description,
        should: `have tag ${fixture.expectedHasTag}`,
        actual: updated.tags.has(fixture.expectedHasTag),
        expected: true,
      })
    }

    if (fixture.expectedNotHasTag) {
      assert({
        given: fixture.description,
        should: `not have tag ${fixture.expectedNotHasTag}`,
        actual: updated.tags.has(fixture.expectedNotHasTag),
        expected: false,
      })
    }

    if (fixture.expectedOtherTags) {
      fixture.expectedOtherTags.forEach((tag) => {
        assert({
          given: fixture.description,
          should: `preserve tag ${tag}`,
          actual: updated.tags.has(tag),
          expected: true,
        })
      })
    }
  })
})
