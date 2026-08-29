import { describe, expect, test } from 'bun:test'
import { matchPersonFiles, prepareQuery } from './tools.ts'

describe('matchPersonFiles', () => {
  const files = [
    '/nb/people/j/jane-doe.md',
    '/nb/people/j/jane-smith.md',
    '/nb/people/d/john-doe.md',
    '/nb/people/a/ann-lee.md',
  ]

  test('exact stem match ranks first', () => {
    const matched = matchPersonFiles(files, 'Jane Doe')
    expect(matched[0]).toBe('/nb/people/j/jane-doe.md')
    expect(matched).toHaveLength(1)
  })

  test('single token matches every stem containing it', () => {
    const matched = matchPersonFiles(files, 'jane')
    expect(matched).toEqual(['/nb/people/j/jane-doe.md', '/nb/people/j/jane-smith.md'])
  })

  test('token order and separators do not matter', () => {
    const matched = matchPersonFiles(files, 'doe, jane')
    expect(matched).toContain('/nb/people/j/jane-doe.md')
    expect(matched).not.toContain('/nb/people/j/jane-smith.md')
  })

  test('no match returns empty, never throws', () => {
    expect(matchPersonFiles(files, 'nobody known')).toEqual([])
    expect(matchPersonFiles(files, '')).toEqual([])
    expect(matchPersonFiles([], 'jane')).toEqual([])
  })
})

describe('prepareQuery', () => {
  test('a valid query normalizes with no errors', async () => {
    const { errors } = await prepareQuery('{ meetings { path markdown } }')
    expect(errors).toBeNull()
  })

  test('a hallucinated field returns validator errors instead of executing', async () => {
    const { errors } = await prepareQuery('{ meetings { path notAField } }')
    expect(errors).not.toBeNull()
    expect(errors!.length).toBeGreaterThan(0)
  })

  test('code fences are stripped before validation', async () => {
    const { errors } = await prepareQuery('```graphql\n{ meetings { path markdown } }\n```')
    expect(errors).toBeNull()
  })
})
