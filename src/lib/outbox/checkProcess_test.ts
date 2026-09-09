import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as config from '#config'
import AutomationStateStore from '#shared/models/Automation/state.ts'
import { assert, test } from '#test'
import { createCheckProcess } from './checkProcess.ts'
import { readScanProgress } from './progress.ts'
import { createOutboxRuntime } from './runtime.ts'
import { setupOutbox } from './setup.ts'

test(
  'the Outbox process uses the selected notebook and persists both scan completion and automation history',
  { timeout: 20000 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-process-test-'))
    const local = {
      ...config,
      DIR_BASE: path.join(root, 'notebook'),
      DIR_USER_DATA: path.join(root, 'data'),
      DIR_STATE: path.join(root, 'data', 'state'),
      DIR_AUTOMATIONS: path.join(root, 'notebook', 'automations'),
    }
    const { store } = createOutboxRuntime(local)
    const process = createCheckProcess(local, { ENV_FILE_LOADED: '1' }, store)
    try {
      await setupOutbox(local.DIR_AUTOMATIONS, store.stateDir, '2025-03-15')
      const selected = await store.scanRange('2025-03-15')
      await store.saveScanRange(selected.value, selected.revision, '2025-03-15')
      await process.start()
      // A replacement web host has no in-memory handle to the original command.
      const reconnected = createCheckProcess(local, { ENV_FILE_LOADED: '1' }, store)
      let status = await reconnected.status()
      for (let attempt = 0; status?.running && attempt < 150; attempt++) {
        await delay(100)
        status = await reconnected.status()
      }
      const progress = await readScanProgress(store)
      const history = await AutomationStateStore.load(path.join(local.DIR_STATE, 'automations.json'))
      assert({
        given: 'a real detached Outbox command and a new web host',
        should: 'finish the selected range and stamp the automation outside the web process',
        actual: [
          status?.running,
          status?.result?.outcome,
          progress?.status,
          progress?.range,
          history.last('outbox')?.outcome,
        ],
        expected: [false, 'nothing', 'complete', selected.value, 'nothing'],
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
