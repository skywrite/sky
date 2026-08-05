import * as path from 'node:path'
import readTextFileSync from '#shared/fs/readTextFileSync.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { assert, test } from '#test'

const __dirname = new URL('.', import.meta.url).pathname
const DIR_FIXTURES = path.join(__dirname, 'fixtures')

const loadFixture = (name: string): string => readTextFileSync(path.join(DIR_FIXTURES, name))

// =============================================================================
// addCommitmentItem
// =============================================================================

test('DayDocument.addCommitmentItem() adds item to existing Commitments list', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-full-structure.md'))
  const result = day.addCommitmentItem('New commitment')

  const commitmentsList = result.lists.find((l) => l.title === 'Professional Commitments')

  assert({
    given: 'a day with existing Professional Commitments list',
    should: 'add item to existing list',
    actual: commitmentsList?.items.includes('New commitment'),
    expected: true,
  })
})

test('DayDocument.addCommitmentItem() creates list after Most Important when list does not exist', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-most-important-and-complete.md'))
  const result = day.addCommitmentItem('New commitment')

  const mostImportantIndex = result.lists.findIndex((l) => l.title === 'Most Important')
  const commitmentsIndex = result.lists.findIndex((l) => l.title === 'Professional Commitments')

  assert({
    given: 'a day without Commitments list',
    should: 'create list after Most Important',
    actual: commitmentsIndex === mostImportantIndex + 1,
    expected: true,
  })
})

test('DayDocument.addCommitmentItem() creates list at beginning when no Most Important exists', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-only-complete.md'))
  const result = day.addCommitmentItem('New commitment')

  const commitmentsIndex = result.lists.findIndex((l) => l.title === 'Professional Commitments')

  assert({
    given: 'a day without Most Important list',
    should: 'create Commitments list at beginning',
    actual: commitmentsIndex,
    expected: 0,
  })
})

test('DayDocument.addCommitmentItem() respects category parameter', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-only-complete.md'))
  const result = day.addCommitmentItem('Personal task', { category: 'Personal' })

  const personalCommitments = result.lists.find((l) => l.title === 'Personal Commitments')

  assert({
    given: 'category "Personal"',
    should: 'create Personal Commitments list',
    actual: personalCommitments?.items.includes('Personal task'),
    expected: true,
  })
})

test('DayDocument.addCommitmentItem() adds item with link to existing list', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-with-links.md'))
  const links = new Map([['new-link', { href: 'https://example.com', label: 'new-link' }]])
  const result = day.addCommitmentItem('Task with link [new-link][]', { links })

  assert({
    given: 'an item with a reference link',
    should: 'add the link to the document',
    actual: result.links.has('new-link'),
    expected: true,
  })
})

test('DayDocument.addCommitmentItem() adds item with link when creating new list', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-only-complete.md'))
  const links = new Map([['new-link', { href: 'https://example.com', label: 'new-link' }]])
  const result = day.addCommitmentItem('Task with link [new-link][]', { links })

  assert({
    given: 'creating a new list with a linked item',
    should: 'add the link to the document',
    actual: result.links.get('new-link')?.href,
    expected: 'https://example.com',
  })
})

// =============================================================================
// addTodoItem
// =============================================================================

test('DayDocument.addTodoItem() adds item to existing Todos list', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-full-structure.md'))
  const result = day.addTodoItem('New todo item')

  const todoList = result.lists.find((l) => l.title === 'Professional Todos')

  assert({
    given: 'a day with existing Professional Todos list',
    should: 'add item to existing list',
    actual: todoList?.items.includes('New todo item'),
    expected: true,
  })
})

test('DayDocument.addTodoItem() creates list after last Commitments when list does not exist', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-with-commitments-no-todos.md'))
  const result = day.addTodoItem('New todo item')

  const lastCommitmentsIndex = result.lists.findLastIndex((l) => l.title.endsWith('Commitments'))
  const todosIndex = result.lists.findIndex((l) => l.title === 'Professional Todos')

  assert({
    given: 'a day with Commitments but no Todos',
    should: 'create Todos list after last Commitments',
    actual: todosIndex === lastCommitmentsIndex + 1,
    expected: true,
  })
})

test('DayDocument.addTodoItem() creates list after Most Important when no Commitments exist', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-most-important-and-complete.md'))
  const result = day.addTodoItem('New todo item')

  const mostImportantIndex = result.lists.findIndex((l) => l.title === 'Most Important')
  const todosIndex = result.lists.findIndex((l) => l.title === 'Professional Todos')

  assert({
    given: 'a day with Most Important but no Commitments',
    should: 'create Todos list after Most Important',
    actual: todosIndex === mostImportantIndex + 1,
    expected: true,
  })
})

test('DayDocument.addTodoItem() respects category parameter', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-only-complete.md'))
  const result = day.addTodoItem('Personal todo', { category: 'Personal' })

  const personalTodos = result.lists.find((l) => l.title === 'Personal Todos')

  assert({
    given: 'category "Personal"',
    should: 'create Personal Todos list',
    actual: personalTodos?.items.includes('Personal todo'),
    expected: true,
  })
})

test('DayDocument.addTodoItem() adds item with link to existing list', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-with-links.md'))
  const links = new Map([['todo-link', { href: 'https://github.com/issue/789', label: 'todo-link' }]])
  const result = day.addTodoItem('Fix issue [todo-link][]', { links })

  assert({
    given: 'an item with a reference link',
    should: 'add the link to the document',
    actual: result.links.get('todo-link')?.href,
    expected: 'https://github.com/issue/789',
  })
})

test('DayDocument.addTodoItem() adds item with link when creating new list', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-most-important-and-complete.md'))
  const links = new Map([['todo-link', { href: 'https://github.com/issue/789', label: 'todo-link' }]])
  const result = day.addTodoItem('Fix issue [todo-link][]', { links })

  assert({
    given: 'creating a new list with a linked item',
    should: 'add the link to the document',
    actual: result.links.has('todo-link'),
    expected: true,
  })
})

// =============================================================================
// addReminderItem
// =============================================================================

test('DayDocument.addReminderItem() adds item to existing Reminders list', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-full-structure.md'))
  const result = day.addReminderItem('New reminder')

  const remindersList = result.lists.find((l) => l.title === 'Reminders')

  assert({
    given: 'a day with existing Reminders list',
    should: 'add item to existing list',
    actual: remindersList?.items.includes('New reminder'),
    expected: true,
  })
})

test('DayDocument.addReminderItem() creates list after last Todos when list does not exist', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-with-todos-no-reminders.md'))
  const result = day.addReminderItem('New reminder')

  const lastTodosIndex = result.lists.findLastIndex((l) => l.title.endsWith('Todos'))
  const remindersIndex = result.lists.findIndex((l) => l.title === 'Reminders')

  assert({
    given: 'a day with Todos but no Reminders',
    should: 'create Reminders list after last Todos',
    actual: remindersIndex === lastTodosIndex + 1,
    expected: true,
  })
})

test('DayDocument.addReminderItem() creates list after last Commitments when no Todos exists', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-with-commitments-no-todos.md'))
  const result = day.addReminderItem('New reminder')

  const lastCommitmentsIndex = result.lists.findLastIndex((l) => l.title.endsWith('Commitments'))
  const remindersIndex = result.lists.findIndex((l) => l.title === 'Reminders')

  assert({
    given: 'a day with Commitments but no Todos',
    should: 'create Reminders list after last Commitments',
    actual: remindersIndex === lastCommitmentsIndex + 1,
    expected: true,
  })
})

test('DayDocument.addReminderItem() creates list before first Complete when no Todos or Commitments exist', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-only-complete.md'))
  const result = day.addReminderItem('New reminder')

  const firstCompleteIndex = result.lists.findIndex((l) => l.title.endsWith('Complete'))
  const remindersIndex = result.lists.findIndex((l) => l.title === 'Reminders')

  assert({
    given: 'a day with only Complete lists',
    should: 'create Reminders list before first Complete',
    actual: remindersIndex === firstCompleteIndex - 1,
    expected: true,
  })
})

test('DayDocument.addReminderItem() adds item with link to existing list', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-with-links.md'))
  const links = new Map([['reminder-link', { href: 'https://docs.example.com/page', label: 'reminder-link' }]])
  const result = day.addReminderItem('Check page [reminder-link][]', { links })

  assert({
    given: 'an item with a reference link',
    should: 'add the link to the document',
    actual: result.links.get('reminder-link')?.href,
    expected: 'https://docs.example.com/page',
  })
})

test('DayDocument.addReminderItem() adds item with link when creating new list', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-with-todos-no-reminders.md'))
  const links = new Map([['reminder-link', { href: 'https://docs.example.com/page', label: 'reminder-link' }]])
  const result = day.addReminderItem('Check page [reminder-link][]', { links })

  assert({
    given: 'creating a new list with a linked item',
    should: 'add the link to the document',
    actual: result.links.has('reminder-link'),
    expected: true,
  })
})
