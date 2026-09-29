import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { writeJson } from '#lib/jobs/files.ts'
import { assert, test } from '#test'
import importLinkedIn from './worker.ts'

const PROFILE = 'https://www.linkedin.com/in/jane-doe-example/'
const source = { url: PROFILE, name: 'Jane Doe', text: 'Research lead', companies: [] }

test('Person import closes the browser on invalid evidence and exposes no worker exception details', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-linkedin-job-test-'))
  try {
    for (const invalid of [true, false]) {
      let closed = false
      let extracted = false
      let message = ''
      try {
        await importLinkedIn(
          { url: PROFILE, progressFile: path.join(dir, 'progress.json'), cancelFile: path.join(dir, 'cancel.json') },
          {
            launch: async () => ({
              close: async () => {
                closed = true
              },
              callTool: async () => {
                if (!invalid) throw new Error('Mock sensitive provider diagnostics')
                return {
                  isError: false,
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({
                        status: 'ready',
                        profile: { ...source, url: 'https://www.linkedin.com/in/someone-else-example/' },
                      }),
                    },
                  ],
                }
              },
            }),
            extract: async () => {
              extracted = true
              throw new Error('Unexpected extraction')
            },
          },
        )
      } catch (error) {
        message = (error as Error).message
      }
      assert({
        given: invalid ? 'evidence for a different profile' : 'a failed browser worker',
        should: 'close the session, avoid model extraction, and report a safe error',
        actual: [closed, extracted, message.includes('Retry the import'), message.includes('diagnostics')],
        expected: [true, false, true, false],
      })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an extraction failure preserves an editable name after closing the private browser', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-linkedin-job-test-'))
  let closed = false
  let closedBeforeExtraction = false
  try {
    const draft = await importLinkedIn(
      { url: PROFILE, progressFile: path.join(dir, 'progress.json'), cancelFile: path.join(dir, 'cancel.json') },
      {
        launch: async () => ({
          close: async () => {
            closed = true
          },
          callTool: async () => ({
            isError: false,
            content: [{ type: 'text', text: JSON.stringify({ status: 'ready', profile: source }) }],
          }),
        }),
        extract: async () => {
          closedBeforeExtraction = closed
          throw new Error('Mock private model diagnostics')
        },
      },
    )
    assert({
      given: 'a model failure after successful profile capture',
      should: 'leave a safe editable draft without retaining a browser or provider diagnostics',
      actual: [
        closedBeforeExtraction,
        draft.name,
        draft.url,
        !!draft.warning,
        draft.warning?.includes('diagnostics'),
        await readdir(dir),
        (await readFile(path.join(dir, 'progress.json'), 'utf8')).includes('Preparing'),
      ],
      expected: [true, 'Jane Doe', PROFILE, true, false, ['progress.json'], true],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a cancelled import never starts a private browser', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-linkedin-job-test-'))
  let launched = false
  let message = ''
  try {
    const cancelFile = path.join(dir, 'cancel.json')
    await writeJson(cancelFile, { cancelled: true })
    try {
      await importLinkedIn(
        { url: PROFILE, cancelFile, progressFile: path.join(dir, 'progress.json') },
        {
          launch: async () => {
            launched = true
            throw new Error('Unexpected browser')
          },
          extract: async () => {
            throw new Error('Unexpected extraction')
          },
        },
      )
    } catch (error) {
      message = (error as Error).message
    }
    assert({
      given: 'an import cancelled before its worker runs',
      should: 'stop before any browser or approval prompt',
      actual: [launched, message],
      expected: [false, 'Import cancelled.'],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
