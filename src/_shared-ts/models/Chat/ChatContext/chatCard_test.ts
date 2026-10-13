import { assert, test } from '#test'
import { setUserSpeakerLabel } from '../document/mod.ts'
import { chatCard, contextDocument } from './chatCard.ts'

setUserSpeakerLabel('Jane')

const HEAD = [
  '---',
  'created: 2026-01-26',
  'summary: Atlas launch plan',
  'tags: atlas',
  '---',
  '',
  '# Atlas launch plan',
  '',
  '## Summary (Opus 5.5, High)',
  '',
  '- Sky drafted a launch checklist for Atlas.',
  '- Jane chose a May launch.',
]

const CONVERSATION = [
  '## Conversation',
  '',
  '### 2026-01-26 16:00 - **Jane**',
  '',
  'When should Atlas launch?',
  '',
  '### 2026-01-26 16:01 - **Sky**',
  '',
  '#### Timing',
  '',
  'May works: the escrow timeline closes in April.',
  '',
  '### 2026-01-26 16:02 - **Jane**',
  '',
  'May it is.',
  '',
  '<!-- CONTEXT-LOG',
  '{"v":2,"turns":[]}',
  '-->',
  '',
]

const CHAT = [...HEAD, '', ...CONVERSATION].join('\n')
const CHAT_PATH = '/notebook/time/2026/W05/01-26/actions/ai-chats/16-00_Atlas-Launch-Plan.md'

test('chatCard - a saved chat', () => {
  assert({
    given: 'a saved chat with a summary and three messages',
    should: 'keep everything above the conversation and count the messages it leaves out',
    actual: chatCard(CHAT),
    expected: [...HEAD, '', '_The conversation (3 messages) is not shown here; read_chat opens it._', ''].join('\n'),
  })
})

test('chatCard - a chat with one message and no summary', () => {
  const chat = ['# Atlas question', '', '## Conversation', '', '### 2026-01-26 16:00 - **Jane**', '', 'Hi', ''].join(
    '\n',
  )
  assert({
    given: 'a chat filed before its summary was written',
    should: 'keep the title and count the one message',
    actual: chatCard(chat),
    expected: '# Atlas question\n\n_The conversation (1 message) is not shown here; read_chat opens it._\n',
  })
})

test('chatCard - no conversation section', () => {
  const notes = '# Atlas notes\n\nA plan without a conversation.\n'
  assert({
    given: 'markdown without a Conversation section',
    should: 'be its own card',
    actual: chatCard(notes),
    expected: notes,
  })
})

test('contextDocument - a saved chat comes in as its card unless whole', () => {
  const card = contextDocument(CHAT_PATH, CHAT)
  const whole = contextDocument(CHAT_PATH, CHAT, { wholeChat: true })
  assert({
    given: 'a saved chat read for context, as a card and whole',
    should:
      "keep the frontmatter for scoring either way; the conversation only whole, with its replies' headings; never the context log",
    actual: {
      title: card.yaml['summary'],
      cardSummary: card.toMarkdown().includes('Jane chose a May launch.'),
      cardConversation: card.toMarkdown().includes('escrow'),
      wholeConversation: whole.toMarkdown().includes('escrow') && whole.toMarkdown().includes('#### Timing'),
      log: [card, whole].some((doc) => doc.toMarkdown().includes('CONTEXT-LOG')),
    },
    expected: {
      title: 'Atlas launch plan',
      cardSummary: true,
      cardConversation: false,
      wholeConversation: true,
      log: false,
    },
  })
})

test('contextDocument - any other file loses its transcript sections', () => {
  const meeting = '# Atlas sync\n\n## Notes\n\nShip in May.\n\n## Transcript\n\nJane: hello\n'
  const doc = contextDocument('/notebook/time/2026/W05/01-26/actions/meetings/11-00_Atlas_Sync.md', meeting)
  assert({
    given: 'a meeting with a Transcript section',
    should: 'keep its notes and drop the transcript',
    actual: { notes: doc.toMarkdown().includes('Ship in May.'), transcript: doc.toMarkdown().includes('Jane: hello') },
    expected: { notes: true, transcript: false },
  })
})
