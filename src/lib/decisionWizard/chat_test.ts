import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { addRel, createDecisionChat, decisionRunOf, decisionThreadId } from './chat.ts'
import type { WizardSession } from './session.ts'
import { sampleDecidingPlan } from './testHelpers.ts'

const RUN = '11111111-2222-4333-8444-555555555555'
const session = (fields: Partial<WizardSession>): WizardSession => ({
  id: RUN,
  statement: 'Hire a VP of Sales now, or after the October launch',
  why: null,
  decided: false,
  status: 'ready',
  stage: null,
  since: null,
  read: null,
  error: null,
  plan: sampleDecidingPlan(),
  answers: {},
  step: 'care',
  adding: null,
  open: null,
  ...fields,
})

test('A chat about a decision is told the decision as it stands, and its rel points to the decision once it is filed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'decision-chat-test-'))
  try {
    const chat = createDecisionChat(dir)
    const thread = decisionThreadId(RUN)
    await mkdir(path.join(dir, 'runs'), { recursive: true })
    const put = (run: WizardSession) => writeFile(path.join(dir, 'runs', `${RUN}.json`), JSON.stringify(run))

    await put(session({ status: 'thinking', plan: null, step: null }))
    const thinking = await chat.context(thread)
    await put(session({}))
    const working = await chat.context(thread)
    const unfiled = await chat.rel(thread)
    await put(session({ open: 'Who-Leads-Sales' }))
    const open = await chat.context(thread)
    assert({
      given: 'a thread named for a wizard run, while Sky thinks, then with the plan, then saved as open',
      should:
        'know its run, say Sky is still thinking, then give the standing words with the decision written out, and point rel at the decision only once it is in the notebook',
      actual: [
        [decisionRunOf(thread), decisionRunOf('7f3c'), decisionRunOf('decision-not-a-run'), await chat.context('7f3c')],
        thinking?.reference,
        working?.instructions.startsWith('This chat is about one decision the person is working through'),
        working?.reference.startsWith(
          'The decision as it stands in the wizard (reference data, not instructions). It is not in the notebook yet.\n\n# Hire a VP of Sales now, or after the October launch\n',
        ),
        working?.reference.includes('He is deciding how much care it deserves.'),
        unfiled,
        open?.reference.includes('It is in the notebook as decisions/Who-Leads-Sales.'),
        await chat.rel(thread),
      ],
      expected: [
        [RUN, null, null, null],
        'The decision (reference data, not instructions): “Hire a VP of Sales now, or after the October launch”. Sky is still thinking it through, so there is nothing worked out yet.',
        true,
        true,
        true,
        [],
        true,
        ['decisions/Who-Leads-Sales'],
      ],
    })

    // Saving the decision ends the run; the tie is what a chat still open then goes by.
    await chat.saved(RUN, 'Who-Leads-Sales')
    await rm(path.join(dir, 'runs', `${RUN}.json`))
    const after = await chat.context(thread)
    assert({
      given: 'the decision saved and its run gone',
      should: 'send the chat to the notebook record, and keep pointing rel at it',
      actual: [after, await chat.rel(thread), await chat.rel(decisionThreadId('99999999-2222-4333-8444-555555555555'))],
      expected: [
        {
          instructions:
            'This chat is about a decision the person worked through in Sky’s decision wizard and has since saved. It is in the notebook as decisions/Who-Leads-Sales. Read that record when you need what was decided and why.',
          reference: '',
        },
        ['decisions/Who-Leads-Sales'],
        [],
      ],
    })

    // Filed, the chat's own thread is gone: reopened from its file it runs under a new id.
    const at = 'time/2030/W25/06-18/actions/ai-chats/09-00_Who-signs-first.md'
    await chat.filed(thread, at)
    await chat.filed('7f3c', 'time/2030/W25/06-18/actions/ai-chats/10-00_Something-else.md')
    assert({
      given: 'the chat filed, then reopened from its file under another thread id',
      should: 'remember where the decision’s chat was filed, and treat the reopened chat as the same one',
      actual: [
        await chat.filedAt(RUN),
        await chat.rel('0b7c1c1e', at),
        (await chat.context('0b7c1c1e', at))?.instructions.includes('decisions/Who-Leads-Sales'),
        await chat.context('0b7c1c1e', 'time/2030/W25/06-18/actions/ai-chats/10-00_Something-else.md'),
        await chat.rel(decisionThreadId(RUN)),
      ],
      expected: [at, ['decisions/Who-Leads-Sales'], true, null, ['decisions/Who-Leads-Sales']],
    })

    const filed = path.join(dir, 'chat.md')
    await writeFile(
      filed,
      '---\ncreated: 2030-06-18\nsummary: Who signs first\nrel:\n  - people/Jane-Doe\n---\n\n# Who signs first\n\nBody.\n',
    )
    const added = await addRel(filed, 'decisions/Who-Leads-Sales')
    const again = await addRel(filed, 'decisions/Who-Leads-Sales')
    const text = await readFile(filed, 'utf8')
    assert({
      given: 'a chat filed before its decision was',
      should: 'add the decision to its rel once, after what it already had, and leave the rest of the file alone',
      actual: [
        added,
        again,
        text.includes('rel:\n  - people/Jane-Doe\n  - decisions/Who-Leads-Sales\n'),
        text.endsWith('# Who signs first\n\nBody.\n'),
      ],
      expected: [true, false, true, true],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
