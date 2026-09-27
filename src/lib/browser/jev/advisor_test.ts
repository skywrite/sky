import { assert, test } from '#test'
import { advise } from './advisor.ts'
import type { ActionTable } from './table.ts'

const table: ActionTable = {
  url: 'https://atlas.example/home',
  title: 'Atlas Brokerage',
  text: 'Welcome back, Jane. Accounts Documents Log out',
  above: 0,
  below: 3,
  omitted: 0,
  rows: [
    {
      index: 0,
      ref: 'e2',
      role: 'link',
      name: 'Documents',
      flags: [],
      kind: 'click',
      secret: false,
      href: '/documents',
    },
    { index: 1, ref: 'e3', role: 'link', name: 'Log out', flags: [], kind: 'click', secret: false, href: '/logout' },
    { index: 2, ref: 'e4', role: 'button', name: 'Accept cookies', flags: [], kind: 'click', secret: false },
  ],
}

test('the adviser reply is read as a plan, a judgment, and a checked move', async () => {
  const result = await advise({
    model: {} as never,
    goal: 'download the 2025 tax form',
    table,
    history: [],
    trigger: 'new_page',
    reply: async () =>
      '```json\n{"subgoal": "Open the Documents section", "needs_person": false, "action": {"kind": "navigate", "url": "/documents"}, "reason": "Signed in already."}\n```',
  })
  assert({
    given: 'a fenced JSON reply with a navigate action to a link on the page',
    should: 'keep the plan, read signed-in as not needing the person, and resolve the address',
    actual: result.advice,
    expected: {
      subgoal: 'Open the Documents section',
      needsPerson: false,
      action: { kind: 'navigate', url: 'https://atlas.example/documents' },
      reason: 'Signed in already.',
    },
  })
})

test('a move the page does not offer is dropped, and a broken reply is no advice', async () => {
  const invented = await advise({
    model: {} as never,
    goal: 'g',
    table,
    history: [],
    trigger: 'move_failed',
    failure: 'intercepts pointer events',
    reply: async () =>
      '{"subgoal": "Dismiss the banner", "needs_person": false, "action": {"kind": "navigate", "url": "https://elsewhere.example/"}, "reason": "x"}',
  })
  assert({
    given: 'a navigate to an address no link on the page carries',
    should: 'keep the plan but drop the move',
    actual: [invented.advice.subgoal, invented.advice.action],
    expected: ['Dismiss the banner', undefined],
  })
  const clicked = await advise({
    model: {} as never,
    goal: 'g',
    table,
    history: [],
    trigger: 'move_failed',
    reply: async () =>
      '{"subgoal": "Dismiss the banner", "needs_person": false, "action": {"kind": "click", "index": 2}, "reason": "x"}',
  })
  assert({
    given: 'a click on a row that exists',
    should: 'pass through',
    actual: clicked.advice.action,
    expected: { kind: 'click', index: 2 },
  })
  const broken = await advise({
    model: {} as never,
    goal: 'g',
    table,
    history: [],
    trigger: 'no_change',
    reply: async () => 'I am not sure.',
  })
  assert({
    given: 'a reply that is not JSON',
    should: 'yield a default plan and no move, never a throw',
    actual: [broken.advice.subgoal, broken.advice.needsPerson, broken.advice.action],
    expected: ['Continue toward the goal on this page.', false, undefined],
  })
  const failed = await advise({
    model: {} as never,
    goal: 'g',
    table,
    history: [],
    trigger: 'new_page',
    reply: async () => {
      throw new Error('gateway down')
    },
  })
  assert({
    given: 'an adviser that throws',
    should: 'report it as a reason and carry on',
    actual: failed.advice.reason,
    expected: 'The adviser failed: gateway down',
  })
})

test('the adviser may send the task back to an address it has been to, even from a blank page', async () => {
  const blank: ActionTable = { url: 'about:blank', title: '', text: '', above: 0, below: 0, omitted: 0, rows: [] }
  const result = await advise({
    model: {} as never,
    goal: 'download the 2025 tax form',
    table: blank,
    history: [],
    trigger: 'no_change',
    known: ['https://atlas.example/', 'https://atlas.example/documents'],
    reply: async () =>
      '{"subgoal": "Return to the documents page", "needs_person": false, "action": {"kind": "navigate", "url": "https://atlas.example/documents"}, "reason": "The page is blank."}',
  })
  assert({
    given: 'a navigate to a page the task has visited, proposed from a page with no links',
    should: 'be allowed',
    actual: result.advice.action,
    expected: { kind: 'navigate', url: 'https://atlas.example/documents' },
  })
})
