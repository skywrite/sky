import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { createProcessJob, type JobRecord } from '#lib/jobs/mod.ts'
import AutomationStateStore from '#shared/models/Automation/state.ts'
import { assert, test } from '#test'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { FixturePassInput } from './fixtures/process.ts'
import { automationPassInput } from './process.ts'
import type { PassSummary } from './runDue.ts'

async function until(check: () => boolean): Promise<void> {
  const deadline = performance.now() + 5000
  while (!check()) {
    if (performance.now() > deadline) throw new Error('Mock scheduled pass did not reach its expected step.')
    await delay(10)
  }
}

test(
  {
    name: 'a scheduled pass survives its submitting process and records the firing before the next pass',
    timeout: 15_000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'automation-process-test-'))
    const jobDir = path.join(root, 'job')
    const module = new URL('./fixtures/process.ts', import.meta.url)
    const input: FixturePassInput = {
      ...automationPassInput(new ZonedDateTime(new PlainDateTime('09:30', '2026-01-05'), 'America/New_York')),
      root,
    }
    const job = createProcessJob<FixturePassInput, PassSummary>({ dir: jobDir, module })
    let submitter: ReturnType<typeof spawn> | undefined
    try {
      await mkdir(path.join(root, 'charters'))
      await writeFile(path.join(root, 'charters', 'alpha.md'), '---\nrun: mock:check\nat: 09:30\n---\nMock check.\n')
      const source = `
      import { createProcessJob } from ${JSON.stringify(new URL('../jobs/mod.ts', import.meta.url).href)};
      const [dir, module, input] = process.argv.slice(1);
      const job = createProcessJob({ dir, module: new URL(module) });
      console.log(JSON.stringify(await job.start(JSON.parse(input))));
      setInterval(() => {}, 1000);
    `
      submitter = spawn(process.execPath, ['-e', source, jobDir, module.href, JSON.stringify(input)], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      submitter.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
        output += chunk
      })
      await until(() => output.includes('\n'))
      const first = JSON.parse(output.split('\n')[0]) as JobRecord<PassSummary, FixturePassInput>
      await until(() => existsSync(path.join(root, 'started')))
      const exited = new Promise<void>((resolve) => submitter!.once('exit', () => resolve()))
      submitter.kill('SIGTERM')
      await exited

      const rejoined = await job.start(input)
      await writeFile(path.join(root, 'finish'), 'finish')
      const completed = await job.wait(first.id)
      const second = await job.start(input)
      const following = await job.wait(second.id)
      const ledger = await AutomationStateStore.load(path.join(root, 'ledger.json'))
      assert({
        given: 'a scheduled command waiting in its worker when its submitting process is terminated',
        should: 'rejoin that worker, preserve both clock frames, and avoid invoking the completed firing again',
        actual: [
          rejoined.id === first.id,
          rejoined.owner === first.owner,
          rejoined.status,
          completed.ran.map(({ name, outcome }) => [name, outcome]),
          following.notDue,
          await readFile(path.join(root, 'calls'), 'utf8'),
          ledger.runsFor('alpha').map(({ utc, clock }) => [utc, clock]),
        ],
        expected: [
          true,
          true,
          'running',
          [['alpha', 'acted']],
          ['alpha'],
          'alpha\n',
          [['2026-01-05 14:30', '2026-01-05 09:30']],
        ],
      })
    } finally {
      submitter?.kill('SIGTERM')
      const current = await job.status()
      if (current?.status === 'running') process.kill(current.owner, 'SIGTERM')
      await rm(root, { recursive: true, force: true })
    }
  },
)
