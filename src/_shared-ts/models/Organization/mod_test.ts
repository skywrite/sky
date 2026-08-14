import readTextFile from '#shared/fs/readTextFile.ts'
import { assert, test } from '#test'
import Organization from './mod.ts'

test('Organization.create - creates Anthropic organization', () => {
  const yaml = {
    name: 'Anthropic',
    slug: 'anthropic',
    site: 'https://anthropic.com',
    sector: 'tech',
    subcategory: 'ai',
    rel: 'prospect',
    created: '2025-10-11',
    updated: '2025-10-11',
  }

  const org = Organization.create(
    yaml,
    'AI safety company focused on building reliable, interpretable, and steerable AI systems.',
  )

  assert({
    given: 'Anthropic organization YAML',
    should: 'create Organization with correct name',
    actual: org.name,
    expected: 'Anthropic',
  })

  assert({
    given: 'Anthropic organization YAML',
    should: 'create Organization with correct slug',
    actual: org.slug,
    expected: 'anthropic',
  })

  assert({
    given: 'Anthropic organization YAML',
    should: 'create Organization with correct sector',
    actual: org.sector,
    expected: 'tech',
  })

  assert({
    given: 'Anthropic organization YAML',
    should: 'create Organization with correct subcategory',
    actual: org.subcategory,
    expected: 'ai',
  })

  assert({
    given: 'Anthropic organization YAML',
    should: 'create Organization with correct site',
    actual: org.site,
    expected: 'https://anthropic.com',
  })

  assert({
    given: 'a description passed to create',
    should: 'keep it out of the YAML header',
    actual: org.description,
    expected: undefined,
  })

  assert({
    given: 'Anthropic organization YAML',
    should: 'generate markdown with heading',
    actual: org.markdown.includes('# Anthropic'),
    expected: true,
  })

  assert({
    given: 'Anthropic organization YAML',
    should: 'generate markdown with description',
    actual: org.markdown.includes('AI safety company'),
    expected: true,
  })
})

test('Organization - Anthropic fixture has company kind', async () => {
  const fixturePath = new URL('./_fixtures/anthropic.md', import.meta.url).pathname
  const fixtureContent = await readTextFile(fixturePath)
  const org = Organization.fromMarkdown(fixtureContent)

  assert({
    given: 'Anthropic fixture with Organization/Company tag',
    should: 'return kind as company',
    actual: org.kind,
    expected: 'company',
  })

  assert({
    given: 'Anthropic fixture with Organization/Company tag',
    should: 'have Organization/Company tag',
    actual: org.tags.has('Organization/Company'),
    expected: true,
  })
})

// Note: fromMarkdown test skipped due to YAML parser env access issues in tests
// The functionality works in practice, as demonstrated by other Document subclasses

test('Organization - created and updated return PlainDate', () => {
  const yaml = {
    name: 'Anthropic',
    slug: 'anthropic',
    sector: 'tech',
    subcategory: 'ai',
    created: '2025-10-11',
    updated: '2025-10-11',
  }

  const org = Organization.create(yaml)

  assert({
    given: 'organization with created date string',
    should: 'return PlainDate from created getter',
    actual: org.created?.ymd,
    expected: '2025-10-11',
  })

  assert({
    given: 'organization with updated date string',
    should: 'return PlainDate from updated getter',
    actual: org.updated?.ymd,
    expected: '2025-10-11',
  })
})

test('Organization.toMarkdown - serializes correctly', () => {
  const yaml = {
    name: 'Anthropic',
    slug: 'anthropic',
    site: 'https://anthropic.com',
    sector: 'tech',
    subcategory: 'ai',
    description: 'AI safety company focused on building reliable, interpretable, and steerable AI systems.',
    rel: 'prospect',
    created: '2025-10-11',
    updated: '2025-10-11',
  }

  const org = Organization.create(yaml)
  const output = org.toMarkdown()

  assert({
    given: 'Anthropic organization',
    should: 'include YAML frontmatter',
    actual: output.includes('---'),
    expected: true,
  })

  assert({
    given: 'Anthropic organization',
    should: 'include name in YAML',
    actual: output.includes('name: Anthropic'),
    expected: true,
  })

  assert({
    given: 'Anthropic organization',
    should: 'include sector in YAML',
    actual: output.includes('sector: tech'),
    expected: true,
  })

  assert({
    given: 'Anthropic organization',
    should: 'include markdown heading',
    actual: output.includes('# Anthropic'),
    expected: true,
  })
})

test('Organization.kind - returns unknown when no kind tag set', () => {
  const yaml = {
    name: 'Anthropic',
    slug: 'anthropic',
    sector: 'tech',
    subcategory: 'ai',
  }

  const org = Organization.create(yaml)

  assert({
    given: 'organization with no kind tags',
    should: 'return unknown',
    actual: org.kind,
    expected: 'unknown',
  })
})

test('Organization.setKind - sets company kind', () => {
  const yaml = {
    name: 'Anthropic',
    slug: 'anthropic',
    sector: 'tech',
    subcategory: 'ai',
  }

  const org = Organization.create(yaml).setKind('company')

  assert({
    given: 'organization with company kind set',
    should: 'return company',
    actual: org.kind,
    expected: 'company',
  })

  assert({
    given: 'organization with company kind set',
    should: 'have Organization/Company tag',
    actual: org.tags.has('Organization/Company'),
    expected: true,
  })
})

test('Organization.setKind - replaces existing kind', () => {
  const yaml = {
    name: 'SEC',
    slug: 'sec',
    sector: 'regulators',
    subcategory: 'United States',
    tags: ['Organization/Government'],
  }

  const org = Organization.create(yaml)

  assert({
    given: 'organization with government tag',
    should: 'return government',
    actual: org.kind,
    expected: 'government',
  })

  const updated = org.setKind('nonprofit')

  assert({
    given: 'organization kind changed to nonprofit',
    should: 'return nonprofit',
    actual: updated.kind,
    expected: 'nonprofit',
  })

  assert({
    given: 'organization kind changed to nonprofit',
    should: 'not have Organization/Government tag',
    actual: updated.tags.has('Organization/Government'),
    expected: false,
  })

  assert({
    given: 'organization kind changed to nonprofit',
    should: 'have Organization/Nonprofit tag',
    actual: updated.tags.has('Organization/Nonprofit'),
    expected: true,
  })
})

test('Organization.setKind - unknown removes all kind tags', () => {
  const yaml = {
    name: 'Anthropic',
    slug: 'anthropic',
    sector: 'tech',
    subcategory: 'ai',
    tags: ['Organization/Company'],
  }

  const org = Organization.create(yaml).setKind('unknown')

  assert({
    given: 'organization kind set to unknown',
    should: 'return unknown',
    actual: org.kind,
    expected: 'unknown',
  })

  assert({
    given: 'organization kind set to unknown',
    should: 'not have Organization/Company tag',
    actual: org.tags.has('Organization/Company'),
    expected: false,
  })
})
