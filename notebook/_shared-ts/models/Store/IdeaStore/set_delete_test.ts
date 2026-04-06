import { assert, test } from '#test'
import IdeaStore from './mod.ts'

test('IdeaStore.set: adds an idea by path', () => {
  const store = IdeaStore.empty()
  const contents = '---\nname: ai-powered-crm\n---\n\n# AI-Powered CRM'

  store.set('/ideas/2026/draft/03/ai-powered-crm.md', contents)

  assert({
    given: 'set with idea contents',
    should: 'increase size to 1',
    actual: store.size,
    expected: 1,
  })

  assert({
    given: 'set with idea contents',
    should: 'find by name',
    actual: store.find('ai-powered-crm')?.value.name,
    expected: 'ai-powered-crm',
  })

  assert({
    given: 'set with idea contents',
    should: 'find by path',
    actual: store.findByPath('/ideas/2026/draft/03/ai-powered-crm.md')?.name,
    expected: 'ai-powered-crm',
  })

  assert({
    given: 'draft path',
    should: 'appear in draft list',
    actual: store.getDraft().size,
    expected: 1,
  })
})

test('IdeaStore.set: upserts and cleans old indexes', () => {
  const store = IdeaStore.empty()
  const filePath = '/ideas/2026/draft/03/ai-powered-crm.md'

  store.set(filePath, '---\nname: ai-powered-crm\n---\n\n# V1')
  store.set(filePath, '---\nname: ai-powered-erp\n---\n\n# V2')

  assert({
    given: 'upsert with new name',
    should: 'still have size 1',
    actual: store.size,
    expected: 1,
  })

  assert({
    given: 'upsert with new name',
    should: 'find by new name',
    actual: store.find('ai-powered-erp')?.value.name,
    expected: 'ai-powered-erp',
  })

  assert({
    given: 'upsert with new name',
    should: 'not find by old name',
    actual: store.find('ai-powered-crm'),
    expected: undefined,
  })
})

test('IdeaStore.delete: removes idea and all indexes', () => {
  const store = IdeaStore.empty()
  const filePath = '/ideas/2026/draft/03/ai-powered-crm.md'

  store.set(filePath, '---\nname: ai-powered-crm\n---\n\n# Idea')
  store.delete(filePath)

  assert({
    given: 'delete after set',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
  })

  assert({
    given: 'delete after set',
    should: 'not find by name',
    actual: store.find('ai-powered-crm'),
    expected: undefined,
  })

  assert({
    given: 'delete after set',
    should: 'not find by path',
    actual: store.findByPath(filePath),
    expected: undefined,
  })

  assert({
    given: 'delete after set',
    should: 'empty draft list',
    actual: store.getDraft().size,
    expected: 0,
  })
})
