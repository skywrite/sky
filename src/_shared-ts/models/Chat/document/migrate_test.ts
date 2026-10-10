import { assert, test } from '#test'
import { serializeContextLog } from './ContextLog/mod.ts'
import { migrateChatMarkdown } from './migrate.ts'
import ChatDocument, { setUserSpeakerLabel } from './mod.ts'

setUserSpeakerLabel('Jane')

const FRONTMATTER = '---\ncreated: 2026-02-08\nupdated: 2026-02-08\nsummary: Legacy Forms\nturns: 3\n---\n'
const LOG = serializeContextLog([{ turn: 1, queries: ['{ chats { path } }'] }])

const lines = (...rows: string[]) => rows.join('\n')

test('migrateChatMarkdown - every earlier heading form becomes the one written form, nothing else changes', () => {
  const body = lines(
    '',
    '# Legacy Forms',
    '',
    '## Jane',
    '',
    'Bare question.',
    '',
    '## AI Assistant (2026-02-08 14:33)',
    '',
    'Paren answer.',
    '',
    '',
    '## 2026-02-08 14:40 - **Jane**',
    '',
    'Stamped question.',
    '',
    '## 2026-02-08 14:41 - **AI Assistant**',
    '',
    'Renamed answer.',
    '',
    '## 2026-02-08 25:42 - **Sky**',
    '',
    'Current answer.',
    '',
  )
  const migration = migrateChatMarkdown(FRONTMATTER + body + LOG, 'Jane')
  const expected =
    FRONTMATTER +
    lines(
      '',
      '# Legacy Forms',
      '',
      '## Conversation',
      '',
      '### **Jane**',
      '',
      'Bare question.',
      '',
      '### 2026-02-08 14:33 - **Sky**',
      '',
      'Paren answer.',
      '',
      '',
      '### 2026-02-08 14:40 - **Jane**',
      '',
      'Stamped question.',
      '',
      '### 2026-02-08 14:41 - **Sky**',
      '',
      'Renamed answer.',
      '',
      '### 2026-02-08 25:42 - **Sky**',
      '',
      'Current answer.',
      '',
    ) +
    LOG
  assert({
    given: 'bare, trailing-stamp, stamp-led and renamed-assistant H2 speaker headings, then a context log',
    should: 'rewrite each to its H3 written form under a new Conversation section, every other byte kept',
    actual: { markdown: migration.markdown, outcome: migration.outcome, speakers: migration.speakers },
    expected: { markdown: expected, outcome: 'migrated', speakers: 5 },
  })
  assert({
    given: 'the migrated transcript',
    should: 'read back the conversation the earlier shape held, stamps and log intact',
    actual: {
      conversation: ChatDocument.fromMarkdown(migration.markdown).conversation,
      log: ChatDocument.fromMarkdown(migration.markdown).contextLog.map((e) => e.turn),
    },
    expected: {
      conversation: [
        { role: 'user', content: 'Bare question.' },
        { role: 'assistant', content: 'Paren answer.', when: '2026-02-08 14:33' },
        { role: 'user', content: 'Stamped question.', when: '2026-02-08 14:40' },
        { role: 'assistant', content: 'Renamed answer.\n\nCurrent answer.', when: '2026-02-08 14:41' },
      ],
      log: [1],
    },
  })
})

test('migrateChatMarkdown - a migrated transcript is left alone', () => {
  const once = migrateChatMarkdown(lines('# Again', '', '## Jane', '', 'Hi.', ''), 'Jane')
  const twice = migrateChatMarkdown(once.markdown, 'Jane')
  assert({
    given: 'a transcript migrated once',
    should: 'report it current and return it unchanged',
    actual: { outcome: twice.outcome, same: twice.markdown === once.markdown },
    expected: { outcome: 'current', same: true },
  })
})

test('migrateChatMarkdown - a reply keeps the headings the earlier reader folded into it', () => {
  const migrated = migrateChatMarkdown(
    lines(
      '# Fold',
      '',
      '## Jane',
      '',
      'Compare the options.',
      '',
      '## AI Assistant',
      '',
      'Two options stand out.',
      '',
      '## Recommendation',
      '',
      'Go with the first.',
      '',
      '### Why',
      '',
      'It ships sooner.',
      '',
      '```',
      '## 2026-02-08 14:32 - **Jane**',
      '```',
      '',
      '## Jane',
      '',
      'Thanks.',
    ),
    'Jane',
  ).markdown
  assert({
    given: 'an assistant reply with its own H2 and H3 headings, and a speaker heading quoted in a code block',
    should: 'leave all of them as written inside the reply and rewrite only the real speaker headings',
    actual: ChatDocument.fromMarkdown(migrated).conversation,
    expected: [
      { role: 'user', content: 'Compare the options.' },
      {
        role: 'assistant',
        content: lines(
          'Two options stand out.',
          '',
          '## Recommendation',
          '',
          'Go with the first.',
          '',
          '### Why',
          '',
          'It ships sooner.',
          '',
          '```',
          '## 2026-02-08 14:32 - **Jane**',
          '```',
        ),
      },
      { role: 'user', content: 'Thanks.' },
    ],
  })
})

test('migrateChatMarkdown - the section opens at the first H2, as the earlier reader read it', () => {
  const migrated = migrateChatMarkdown(
    lines('# Preamble', '', 'A note under the title.', '', '## Context', '', 'Set by hand.', '', '## Jane', '', 'Go.'),
    'Jane',
  ).markdown
  assert({
    given: 'text under the title, then an H2 that names no speaker, then a message',
    should: 'keep the text above the section and read the hand-set H2 as the opening user text',
    actual: {
      above: migrated.indexOf('A note under the title.') < migrated.indexOf('## Conversation'),
      conversation: ChatDocument.fromMarkdown(migrated).conversation,
    },
    expected: {
      above: true,
      conversation: [{ role: 'user', content: '## Context\n\nSet by hand.\n\nGo.' }],
    },
  })
})

test('migrateChatMarkdown - a transcript with no messages still gets its section, above the log', () => {
  const withLog = migrateChatMarkdown(`${FRONTMATTER}\n# Empty\n${LOG}`, 'Jane').markdown
  const bare = migrateChatMarkdown('# Empty\n', 'Jane').markdown
  assert({
    given: 'a title-only transcript with a context log, and one without',
    should: 'add the Conversation heading before the log, or at the end',
    actual: {
      withLog:
        withLog.indexOf('## Conversation') > 0 &&
        withLog.indexOf('## Conversation') < withLog.indexOf('<!-- CONTEXT-LOG'),
      logKept: withLog.endsWith(LOG),
      bare,
    },
    expected: { withLog: true, logKept: true, bare: '# Empty\n\n## Conversation\n' },
  })
})
