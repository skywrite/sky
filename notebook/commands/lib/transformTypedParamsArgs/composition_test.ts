import { assert, test } from '#test'
import transformTypedParamsArgs from './mod.ts'
import { Arg } from '../params.ts'

test('resolves Arg from named key (tasks.run composition)', async () => {
  const params = {
    file: Arg.string('File path'),
  }

  // tasks.run('markdown:pdf', { file: '/path/to/file.md' }) produces this shape
  const result = await transformTypedParamsArgs(
    params,
    { _: ['task'], file: '/path/to/file.md' },
    {
      compositionDepth: 1,
    },
  )

  assert({
    given: 'Arg param passed as named key during composition',
    should: 'resolve the value',
    actual: result.file,
    expected: '/path/to/file.md',
  })
})

test('positional Arg takes precedence over named key', async () => {
  const params = {
    file: Arg.string('File path'),
  }

  // CLI: positional is authoritative
  const result = await transformTypedParamsArgs(params, {
    _: ['task', '/from/positional'],
    file: '/from/named',
  })

  assert({
    given: 'both positional and named key for Arg param',
    should: 'prefer positional value',
    actual: result.file,
    expected: '/from/positional',
  })
})

test('resolves multiple Args from named keys', async () => {
  const params = {
    source: Arg.string('Source file'),
    dest: Arg.string('Destination file'),
  }

  const result = await transformTypedParamsArgs(
    params,
    {
      _: ['task'],
      source: '/src/file.md',
      dest: '/dst/file.pdf',
    },
    { compositionDepth: 1 },
  )

  assert({
    given: 'multiple Arg params as named keys',
    should: 'resolve source',
    actual: result.source,
    expected: '/src/file.md',
  })

  assert({
    given: 'multiple Arg params as named keys',
    should: 'resolve dest',
    actual: result.dest,
    expected: '/dst/file.pdf',
  })
})

test('applies parse to Arg from named key', async () => {
  const params = {
    file: Arg.string('File path', { parse: (v) => v.toUpperCase() }),
  }

  const result = await transformTypedParamsArgs(
    params,
    { _: ['task'], file: '/path/to/file' },
    {
      compositionDepth: 1,
    },
  )

  assert({
    given: 'Arg with parse function passed as named key',
    should: 'apply parse',
    actual: result.file,
    expected: '/PATH/TO/FILE',
  })
})

test('still throws for missing required Arg with no named key', async () => {
  const params = {
    file: Arg.string('File path'),
  }

  let error: Error | null = null
  try {
    await transformTypedParamsArgs(params, { _: ['task'] })
  } catch (e) {
    error = e as Error
  }

  assert({
    given: 'required Arg with neither positional nor named key',
    should: 'throw error',
    actual: error?.message.includes('file'),
    expected: true,
  })
})
