import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import * as config from '#config'
import { createProcessJob } from '#lib/jobs/mod.ts'
import { assert, test } from '#test'
import { createComposeProcess, type ComposeProcessInput } from './composeProcess.ts'
import { OutboxReview } from './review.ts'
import { SavedMessages } from './sources.ts'
import { OutboxStore } from './store.ts'
import type { OutboxRecord } from './types.ts'

const NOW = '2025-03-15 12:00'
const ID = 'a'.repeat(32)
const moduleUrl = (file: string) => JSON.stringify(new URL(file, import.meta.url).href)

async function until<T>(read: () => Promise<T | null>): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await read()
    if (result !== null) return result
    await delay(25)
  }
  throw new Error('Timed out waiting for the revision worker.')
}

const untilFile = (file: string) =>
  until(() =>
    access(file).then(
      () => true,
      () => null,
    ),
  )

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-compose-process-test-'))
  const overrides = {
    DIR_BASE: path.join(root, 'notebook'),
    DIR_USER_DATA: path.join(root, 'data'),
    DIR_STATE: path.join(root, 'state'),
    DIR_INPUT: path.join(root, 'input'),
    DIR_OUTPUT: path.join(root, 'output'),
  }
  const local = { ...config, ...overrides }
  const state = path.join(root, 'outbox-state')
  const store = new OutboxStore(path.join(local.DIR_BASE, 'outbox'), state)
  const env = { ENV_FILE_LOADED: '1', SKY_COMPOSE_TEST_ROOT: root, SKY_COMPOSE_TEST_STATE: state }
  const review = new OutboxReview(
    store,
    new SavedMessages(local.DIR_BASE, { Slack: [], Email: [] }),
    async () => {
      throw new Error('Revision must never place a native draft.')
    },
    () => NOW,
  )
  const item = await store.put(
    {
      id: ID,
      created: NOW,
      updated: NOW,
      status: 'needs_review',
      origin: 'followup',
      conversation: {
        key: 'synthetic',
        version: 'source-v1',
        medium: 'Slack',
        sources: [],
        target: null,
        limitations: [],
      },
      title: 'Clarify the draft',
      situation: 'A reply needs clearer wording.',
      reasoning: 'The owner supplied the meaning.',
      questions: [],
      draft: 'The original draft.',
      originalDraft: 'The original draft.',
      edited: false,
      stale: false,
      reviews: [],
      native: null,
      placementError: null,
    },
    null,
  )
  const module = path.join(root, 'compose.ts')
  await writeFile(
    module,
    `import { access, appendFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { OutboxStore } from ${moduleUrl('./store.ts')}
import { SavedMessages } from ${moduleUrl('./sources.ts')}
import { OutboxReview } from ${moduleUrl('./review.ts')}
export default async (input) => {
  const root = process.env.SKY_COMPOSE_TEST_ROOT
  const store = new OutboxStore(process.env.SKY_DIR + '/outbox', process.env.SKY_COMPOSE_TEST_STATE)
  const review = new OutboxReview(store, new SavedMessages(process.env.SKY_DIR, { Slack: [], Email: [] }), async () => { throw new Error('Unexpected native write') }, () => ${JSON.stringify(NOW)}, undefined, async ({ draft, instruction }) => {
    await appendFile(root + '/executions', 'started\\n')
    await writeFile(root + '/started', JSON.stringify({ draft, instruction, saved: (await store.get(input.id)).draft }))
    while (!(await access(root + '/release').then(() => true, () => false))) await delay(20)
    if (instruction === 'Fail this revision.') throw new Error('Synthetic writing failure.')
    return { action: 'draft', title: 'Revised reply', situation: 'Clearer wording.', reasoning: 'Owner direction.', questions: [], draft: 'The revised draft.' }
  })
  return review.composePrepared(input.id, input.revision, input.instruction, input.reviewedChanges)
}
`,
  )
  const client = () => createComposeProcess(local, env, store, (...args) => review.prepareCompose(...args), { module })
  const jobDir = path.join(state, 'compose-jobs', ID)
  const execution = createProcessJob<ComposeProcessInput, OutboxRecord>({ dir: jobDir, module })
  const children: ChildProcess[] = []
  return {
    root,
    local,
    env,
    review,
    store,
    item,
    module,
    client,
    execution,
    release: () => writeFile(path.join(root, 'release'), ''),
    launch: async () => {
      const launcher = path.join(root, 'launcher.ts')
      await writeFile(
        launcher,
        `import { writeFile } from 'node:fs/promises'
import * as config from ${moduleUrl('../../_shared-ts/config.ts')}
import { createComposeProcess } from ${moduleUrl('./composeProcess.ts')}
import { OutboxStore } from ${moduleUrl('./store.ts')}
import { SavedMessages } from ${moduleUrl('./sources.ts')}
import { OutboxReview } from ${moduleUrl('./review.ts')}
const local = { ...config, ...${JSON.stringify(overrides)} }
const store = new OutboxStore(local.DIR_BASE + '/outbox', ${JSON.stringify(state)})
const review = new OutboxReview(store, new SavedMessages(local.DIR_BASE, { Slack: [], Email: [] }), async () => { throw new Error('Unexpected native write') }, () => ${JSON.stringify(NOW)})
const client = createComposeProcess(local, ${JSON.stringify(env)}, store, (...args) => review.prepareCompose(...args), { module: ${JSON.stringify(module)} })
await writeFile(${JSON.stringify(path.join(root, 'accepted.json'))}, JSON.stringify(await client.start(${JSON.stringify(ID)}, ${JSON.stringify(item.revision)}, 'My unsaved edit.', 'Make it clearer.')))
setInterval(() => {}, 1000)
`,
      )
      const child = spawn(process.execPath, [launcher], { detached: true, stdio: 'ignore' })
      children.push(child)
      return child
    },
    dispose: async () => {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      const active = await execution.status()
      if (active?.status === 'running') {
        process.kill(active.owner, 'SIGKILL')
        await delay(100)
      }
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('Outbox revisions save before model work and survive the launching server process group', async () => {
  const f = await fixture()
  try {
    const parent = await f.launch()
    await untilFile(path.join(f.root, 'accepted.json'))
    await untilFile(path.join(f.root, 'started'))
    const accepted: OutboxRecord = JSON.parse(await readFile(path.join(f.root, 'accepted.json'), 'utf8'))
    const exited = once(parent, 'close')
    process.kill(-parent.pid!, 'SIGKILL')
    await exited
    const reconnected = f.client()
    const running = await reconnected.decorate((await f.store.get(ID))!)
    const duplicate = await reconnected.start(ID, f.item.revision, 'My unsaved edit.', 'Make it clearer.')
    await f.release()
    const finished = await until(async () => {
      const value = await reconnected.decorate((await f.store.get(ID))!)
      return value.composition?.status !== 'running' ? value : null
    })
    assert({
      given: 'a revision launched before its entire web-server process group was killed',
      should: 'preserve the submitted words, reuse its worker, and expose the completed revision after reconnecting',
      actual: [
        JSON.parse(await readFile(path.join(f.root, 'started'), 'utf8')),
        running.composition?.status,
        running.replyDirections?.map((direction) => direction.text),
        duplicate.composition?.id === accepted.composition?.id,
        finished.composition?.status,
        finished.composition?.revision === accepted.revision,
        finished.composition?.submittedRevision === f.item.revision,
        finished.draft,
        await readFile(path.join(f.root, 'executions'), 'utf8'),
      ],
      expected: [
        { draft: 'My unsaved edit.', instruction: 'Make it clearer.', saved: 'My unsaved edit.' },
        'running',
        ['Make it clearer.'],
        true,
        'complete',
        true,
        true,
        'The revised draft.',
        'started\n',
      ],
    })
  } finally {
    await f.dispose()
  }
})

test('Outbox revision failures keep saved inputs and competing submissions cannot overwrite them', async () => {
  const f = await fixture()
  try {
    const first = await f.client().start(ID, f.item.revision, 'My working draft.', 'Fail this revision.')
    await untilFile(path.join(f.root, 'started'))
    const competing = await f
      .client()
      .start(ID, first.revision, 'Another draft.', 'Make it clearer.')
      .then(
        () => '',
        (error: Error) => error.message,
      )
    await f.release()
    const failed = await until(async () => {
      const value = await f.client().decorate((await f.store.get(ID))!)
      return value.composition?.status !== 'running' ? value : null
    })
    assert({
      given: 'a second submission arrives during model work and the original model call fails',
      should: 'refuse the competing write and retain the failed revision’s saved text and direction',
      actual: [
        Boolean(competing),
        failed.draft,
        failed.replyDirections?.at(-1)?.text,
        failed.composition?.status,
        failed.composition?.error,
      ],
      expected: [true, 'My working draft.', 'Fail this revision.', 'failed', 'Synthetic writing failure.'],
    })
  } finally {
    await f.dispose()
  }
})

test('a revision worker import failure remains visible after the web host is recreated', async () => {
  const f = await fixture()
  try {
    await writeFile(f.module, "throw new Error('Synthetic worker import failure.')\n")
    const accepted = await f.client().start(ID, f.item.revision, 'Preserve this edit.', 'Make it clearer.')
    const failed = await until(async () => {
      const value = await f.client().decorate((await f.store.get(ID))!)
      return value.composition?.status === 'failed' ? value : null
    })
    assert({
      given: 'the detached revision worker cannot load its task',
      should: 'show a durable failure while preserving the submitted draft and instruction',
      actual: [
        failed.composition?.id === accepted.composition?.id,
        failed.composition?.error,
        failed.draft,
        failed.replyDirections?.at(-1)?.text,
      ],
      expected: [true, 'Synthetic worker import failure.', 'Preserve this edit.', 'Make it clearer.'],
    })
  } finally {
    await f.dispose()
  }
})

test('the production revision worker loads saved input once and checks context before any model call', async () => {
  const f = await fixture()
  try {
    const stale = await f.store.put({ ...f.item, stale: true }, f.item.revision)
    const client = createComposeProcess(f.local, f.env, f.store, (...args) => f.review.prepareCompose(...args))
    await client.start(ID, stale.revision, 'Preserve the working reply.', 'Make it clearer.')
    const failed = await until(async () => {
      const value = await client.decorate((await f.store.get(ID))!)
      return value.composition?.status === 'failed' ? value : null
    })
    assert({
      given: 'the production worker receives an unreviewed context change',
      should: 'use the selected notebook and reject composition without repeating preparation or making a model call',
      actual: [failed.composition?.error, failed.draft, failed.replyDirections?.map((direction) => direction.text)],
      expected: [
        'Review the changed context before asking Sky to draft.',
        'Preserve the working reply.',
        ['Make it clearer.'],
      ],
    })
  } finally {
    await f.dispose()
  }
})

test('finished revision metadata does not follow a newer draft or another request in the same conversation', async () => {
  const f = await fixture()
  try {
    await f.client().start(ID, f.item.revision, 'Working reply.', 'Make it clearer.')
    await f.release()
    const finished = await until(async () => {
      const value = await f.client().decorate((await f.store.get(ID))!)
      return value.composition?.status === 'complete' ? value : null
    })
    const edited = await f.store.put({ ...finished, draft: 'A newer human draft.' }, finished.revision)
    const newerDraft = await f.client().decorate(edited)
    const direction = finished.replyDirections!.at(-1)!
    const newRequest = await f.store.put(
      {
        ...edited,
        draft: finished.draft,
        conversation: { ...edited.conversation, version: 'another-request' },
        replyDirections: [{ ...direction, sourceVersion: 'another-request' }],
      },
      edited.revision,
    )
    const reused = await f.client().decorate(newRequest)
    const reset = await f.store.put({ ...newRequest, replyDirections: undefined }, newRequest.revision)
    assert({
      given: 'a later human edit or a new request reuses the same item ID and instruction wording',
      should: 'show neither the old completion nor its original revision association',
      actual: [newerDraft.composition, reused.composition, (await f.client().decorate(reset)).composition],
      expected: [undefined, undefined, undefined],
    })
  } finally {
    await f.dispose()
  }
})

test('failed revision feedback survives refreshed context but does not label a newer human draft', async () => {
  const f = await fixture()
  try {
    const accepted = await f.client().start(ID, f.item.revision, 'Keep this working reply.', 'Fail this revision.')
    await untilFile(path.join(f.root, 'started'))
    await f.store.put(
      { ...accepted, conversation: { ...accepted.conversation, version: 'new-context' }, stale: true },
      accepted.revision,
    )
    await f.release()
    const failed = await until(async () => {
      const value = await f.client().decorate((await f.store.get(ID))!)
      return value.composition?.status === 'failed' ? value : null
    })
    const changed = await f.store.put({ ...failed, draft: 'A newer human reply.' }, failed.revision)
    assert({
      given: 'the conversation refreshes during a failed revision and the owner later writes new text',
      should: 'retain the failure for its saved instruction, then stop attaching it to the newer draft',
      actual: [
        failed.composition?.error,
        failed.conversation.version,
        failed.replyDirections?.at(-1)?.sourceVersion,
        (await f.client().decorate(changed)).composition,
      ],
      expected: ['Synthetic writing failure.', 'new-context', 'source-v1', undefined],
    })
  } finally {
    await f.dispose()
  }
})
