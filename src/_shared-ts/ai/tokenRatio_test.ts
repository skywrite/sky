import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir, readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import {
  flushTokenRatios,
  learnedRatio,
  observeTokens,
  openTokenRatioStore,
  ratioFor,
  sampleEstimate,
} from './tokenRatio.ts'

test({ name: 'tokenRatio store - a seed until observed, then the learned ratio, written and read back' }, async () => {
  const dir = await makeTempDir({ prefix: 'sky-token-ratio-' })
  const file = path.join(dir, 'token-ratios.json')
  try {
    const store = await openTokenRatioStore(file)
    const seeded = ratioFor('claude-opus-5-5', store)
    observeTokens('claude-opus-5-5', 100_000, 178_000, store)
    observeTokens('claude-opus-5-5', 500, 2_000, store)
    await flushTokenRatios(store)
    const reopened = await openTokenRatioStore(file)
    assert({
      given: 'a fresh store, one real observation and one too small to count',
      should: 'answer the seed first, learn 1.78 from the one sample, persist it, and read it back',
      actual: {
        seeded,
        learned: learnedRatio('claude-opus-5-5', store)?.ratio,
        samples: learnedRatio('claude-opus-5-5', store)?.samples,
        onDisk: JSON.parse(await readTextFile(file))['claude-opus-5-5'].ratio,
        reopened: ratioFor('claude-opus-5-5', reopened),
        untouched: ratioFor('gpt-6-astra', reopened),
      },
      expected: { seeded: 1.75, learned: 1.78, samples: 1, onDisk: 1.78, reopened: 1.78, untouched: 1.15 },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test({ name: 'tokenRatio store - two processes sharing the file keep each other’s better record' }, async () => {
  const dir = await makeTempDir({ prefix: 'sky-token-ratio-' })
  const file = path.join(dir, 'token-ratios.json')
  try {
    const service = await openTokenRatioStore(file)
    const cli = await openTokenRatioStore(file)
    observeTokens('claude-opus-5-5', 100_000, 170_000, service)
    observeTokens('claude-opus-5-5', 100_000, 175_000, service)
    await flushTokenRatios(service)
    observeTokens('gpt-6-astra', 100_000, 112_000, cli)
    observeTokens('claude-opus-5-5', 100_000, 160_000, cli)
    await flushTokenRatios(cli)
    const reopened = await openTokenRatioStore(file)
    assert({
      given: 'the service with two Opus samples, then a command process writing one Opus sample and one GPT-6 sample',
      should: 'end with the service’s two-sample Opus record and the command’s GPT-6 record both on disk',
      actual: {
        opus: learnedRatio('claude-opus-5-5', reopened),
        gpt: learnedRatio('gpt-6-astra', reopened)?.ratio,
      },
      expected: {
        opus: { ratio: 1.71, samples: 2, updated: learnedRatio('claude-opus-5-5', service)!.updated },
        gpt: 1.12,
      },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test({ name: 'tokenRatio meter - a request carrying tool results is not a sample' }, () => {
  const plain = sampleEstimate({ prompt: [{ role: 'system' }, { role: 'user' }], tools: [] })
  const withTool = sampleEstimate({ prompt: [{ role: 'user' }, { role: 'assistant' }, { role: 'tool' }], tools: [] })
  assert({
    given: 'a prose request and one that carries a tool result',
    should: 'measure the first and skip the second',
    actual: { plain: typeof plain === 'number' && plain > 0, withTool },
    expected: { plain: true, withTool: null },
  })
})
