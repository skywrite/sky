/**
 * Tests for DomainCollection.fromStore()
 */

import { assert, test } from '#test'
import DomainCollection from './mod.ts'
import { Collection, Document } from '#shared/models/Markdown/mod.ts'
import PersonDocument from '#shared/models/Person/mod.ts'
import OrganizationDocument from '#shared/models/Organization/mod.ts'
import ProjectDocument from '#shared/models/Project/mod.ts'
import DecisionDocument from '#shared/models/Decision/mod.ts'
import GoalDocument from '#shared/models/Goal/mod.ts'
import PlaceDocument from '#shared/models/Place/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'

// Helper to create markdown with YAML frontmatter
function md(yaml: string, body: string): string {
  return `---\n${yaml}\n---\n${body}`
}

/** Create a mock store with full sub-stores for fromStore() testing */
function createFullMockStore(config: {
  people?: Array<{ doc: PersonDocument; path: string }>
  orgs?: Array<{ doc: OrganizationDocument; path: string }>
  projects?: Array<{ doc: ProjectDocument; path: string }>
  projectFiles?: Array<{ doc: Document; path: string }>
  decisions?: Array<{ doc: DecisionDocument; path: string }>
  goals?: Array<{ doc: GoalDocument; path: string }>
  streaks?: Array<{ doc: Document; path: string }>
  ideas?: Array<{ doc: Document; path: string }>
  places?: Array<{ doc: PlaceDocument; path: string }>
  time?: Array<{ doc: Document; path: string }>
}): MarkdownStore {
  return {
    people: {
      getAll: () => Collection.from(config.people ?? [], 'person'),
    },
    orgs: {
      getAll: () => Collection.from(config.orgs ?? [], 'org'),
    },
    projects: {
      getAll: () => Collection.from(config.projects ?? [], 'project'),
      getDocuments: () => Collection.from(config.projectFiles ?? [], 'document'),
    },
    decisions: {
      getAll: () => Collection.from(config.decisions ?? [], 'decision'),
    },
    goals: {
      getAll: () => Collection.from(config.goals ?? [], 'goal'),
    },
    streaks: {
      getAll: () => Collection.from(config.streaks ?? [], 'streak'),
    },
    ideas: {
      getAll: () => Collection.from(config.ideas ?? [], 'idea'),
    },
    places: {
      getAll: () => Collection.from(config.places ?? [], 'place'),
    },
    time: {
      getAll: () => Collection.from(config.time ?? [], 'document'),
    },
    resolve: () => ({ type: 'unresolved', value: null, raw: '' }),
    resolveAll: () => [],
  } as unknown as MarkdownStore
}

test('DomainCollection.fromStore - creates empty collection from empty store', () => {
  const store = createFullMockStore({})
  const collection = DomainCollection.fromStore(store)

  assert({
    given: 'empty store',
    should: 'have size 0',
    actual: collection.size,
    expected: 0,
  })
})

test('DomainCollection.fromStore - includes all people', () => {
  const alice = PersonDocument.fromMarkdown(md('name: Alice', '# Alice'))
  const bob = PersonDocument.fromMarkdown(md('name: Bob', '# Bob'))

  const store = createFullMockStore({
    people: [
      { doc: alice, path: '/people/Alice.md' },
      { doc: bob, path: '/people/Bob.md' },
    ],
  })

  const collection = DomainCollection.fromStore(store)

  assert({
    given: 'store with 2 people',
    should: 'have size 2',
    actual: collection.size,
    expected: 2,
  })

  assert({
    given: 'store with 2 people',
    should: 'have 2 people',
    actual: collection.people.length,
    expected: 2,
  })
})

test('DomainCollection.fromStore - includes all document types', () => {
  const alice = PersonDocument.fromMarkdown(md('name: Alice', '# Alice'))
  const acme = OrganizationDocument.fromMarkdown(md('name: Acme', '# Acme'))
  const project = ProjectDocument.fromMarkdown(md('name: ProjectX', '# ProjectX'))
  const decision = DecisionDocument.fromMarkdown(md('name: Hire CTO', '# Decision'))
  const goal = GoalDocument.fromMarkdown(md('name: Personal Goals\narea: Personal', '# Goals'))
  const meeting = Document.fromMarkdown(md('title: Meeting', '# Meeting'))

  const store = createFullMockStore({
    people: [{ doc: alice, path: '/people/Alice.md' }],
    orgs: [{ doc: acme, path: '/orgs/Acme.md' }],
    projects: [{ doc: project, path: '/projects/open/ProjectX/_project/overview.md' }],
    decisions: [{ doc: decision, path: '/decisions/Hire-CTO.md' }],
    goals: [{ doc: goal, path: '/goals/Personal.md' }],
    time: [{ doc: meeting, path: '/time/2026/01/meeting.md' }],
  })

  const collection = DomainCollection.fromStore(store)

  assert({
    given: 'store with all document types',
    should: 'have size 6',
    actual: collection.size,
    expected: 6,
  })

  assert({
    given: 'store with all document types',
    should: 'have 1 person',
    actual: collection.people.length,
    expected: 1,
  })

  assert({
    given: 'store with all document types',
    should: 'have 1 org',
    actual: collection.orgs.length,
    expected: 1,
  })

  assert({
    given: 'store with all document types',
    should: 'have 1 project',
    actual: collection.projects.length,
    expected: 1,
  })

  assert({
    given: 'store with all document types',
    should: 'have 1 goal',
    actual: collection.goals.length,
    expected: 1,
  })
})

test('DomainCollection.fromStore - includes project folder files as documents', () => {
  const project = ProjectDocument.fromMarkdown(md('name: ProjectX', '# ProjectX'))
  const notes = Document.fromMarkdown(md('rel:\n  - projects/ProjectX', '# Notes'))

  const store = createFullMockStore({
    projects: [{ doc: project, path: '/projects/open/ProjectX/_project/overview.md' }],
    projectFiles: [{ doc: notes, path: '/projects/open/ProjectX/notes.md' }],
  })

  const collection = DomainCollection.fromStore(store)

  assert({
    given: 'a project with one folder file',
    should: 'include both documents',
    actual: collection.size,
    expected: 2,
  })

  assert({
    given: 'a project with one folder file',
    should: 'classify only the overview as a project',
    actual: collection.projects.length,
    expected: 1,
  })

  assert({
    given: 'a project with one folder file',
    should: 'expose the folder file as a document entry',
    actual: collection.entriesByType('document').map((e) => e.path),
    expected: ['/projects/open/ProjectX/notes.md'],
  })
})
