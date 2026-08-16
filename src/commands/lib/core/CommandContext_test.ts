import * as config from '#config'
import { test } from '#test'
import { assert } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { BufferedOutput } from '../output/BufferedOutput.ts'
import { ConsoleOutput } from '../output/ConsoleOutput.ts'
import CommandContext, { CommandPlatform } from './CommandContext.ts'

// Factory Methods Tests

test('CommandContext.console() creates console context', () => {
  const env = { TEST: 'value' }
  const context = CommandContext.console(config, env, 'test:task')

  assert({
    given: 'console factory with task name',
    should: 'create context with Console platform',
    actual: context.platform,
    expected: CommandPlatform.Console,
  })

  assert({
    given: 'console factory',
    should: 'use ConsoleOutput',
    actual: context.output instanceof ConsoleOutput,
    expected: true,
  })

  assert({
    given: 'console factory',
    should: 'set config',
    actual: context.config,
    expected: config,
  })

  assert({
    given: 'console factory',
    should: 'set env',
    actual: context.env,
    expected: env,
  })
})

test('CommandContext.test() creates test context', () => {
  const context = CommandContext.test(config)

  assert({
    given: 'test factory',
    should: 'create context with Test platform',
    actual: context.platform,
    expected: CommandPlatform.Test,
  })

  assert({
    given: 'test factory',
    should: 'use BufferedOutput',
    actual: context.output instanceof BufferedOutput,
    expected: true,
  })

  assert({
    given: 'test factory',
    should: 'set NODE_ENV to test',
    actual: context.env.NODE_ENV,
    expected: 'test',
  })
})

test('CommandContext.test() accepts env overrides', () => {
  const context = CommandContext.test(config, {
    env: { CUSTOM_VAR: 'custom_value' },
  })

  assert({
    given: 'test factory with env overrides',
    should: 'include custom env var',
    actual: context.env.CUSTOM_VAR,
    expected: 'custom_value',
  })

  assert({
    given: 'test factory with env overrides',
    should: 'still set NODE_ENV to test',
    actual: context.env.NODE_ENV,
    expected: 'test',
  })
})

test('CommandContext.server() creates server context', () => {
  const env = { API_KEY: 'secret' }
  const context = CommandContext.server(config, env)

  assert({
    given: 'server factory',
    should: 'create context with Server platform',
    actual: context.platform,
    expected: CommandPlatform.Server,
  })

  assert({
    given: 'server factory',
    should: 'use BufferedOutput',
    actual: context.output instanceof BufferedOutput,
    expected: true,
  })

  assert({
    given: 'server factory',
    should: 'set env',
    actual: context.env,
    expected: env,
  })
})

// Time Properties Tests

test('CommandContext.console() sets notebookNow and systemNow', () => {
  const env = { TEST: 'value' }
  const mockNotebookNow = new ZonedDateTime('2025-03-15 10:30', 'America/New_York')
  const context = CommandContext.console(config, env, undefined, true, {
    notebookNow: mockNotebookNow,
  })

  assert({
    given: 'console factory',
    should: 'have notebookNow as ZonedDateTime',
    actual: context.notebookNow instanceof ZonedDateTime,
    expected: true,
  })

  assert({
    given: 'console factory',
    should: 'have systemNow as ZonedDateTime',
    actual: context.systemNow instanceof ZonedDateTime,
    expected: true,
  })
})

test('CommandContext.console() defers notebookNow computation until accessed', () => {
  let calls = 0
  const context = CommandContext.console(config, {}, undefined, true, {
    notebookNowProvider: () => {
      calls += 1
      return new ZonedDateTime('2025-03-15 10:30', 'America/New_York')
    },
  })

  assert({
    given: 'console factory with notebookNow provider',
    should: 'not call provider during construction',
    actual: calls,
    expected: 0,
  })

  assert({
    given: 'first notebookNow access',
    should: 'call provider once',
    actual: context.notebookNow.plainDateTime.toString(),
    expected: '2025-03-15 10:30',
  })

  const secondAccess = context.notebookNow

  assert({
    given: 'second notebookNow access',
    should: 'reuse cached notebookNow',
    actual: [calls, secondAccess.plainDateTime.toString()],
    expected: [1, '2025-03-15 10:30'],
  })
})

test('CommandContext.test() allows mocking notebookNow and systemNow', () => {
  const mockTime = new ZonedDateTime('2025-03-15 10:30', 'America/New_York')
  const context = CommandContext.test(config, {
    notebookNow: mockTime,
    systemNow: mockTime,
  })

  assert({
    given: 'test factory with mock notebookNow',
    should: 'use the provided notebookNow',
    actual: context.notebookNow.plainDateTime.toString(),
    expected: '2025-03-15 10:30',
  })

  assert({
    given: 'test factory with mock systemNow',
    should: 'use the provided systemNow',
    actual: context.systemNow.plainDateTime.toString(),
    expected: '2025-03-15 10:30',
  })
})

test('CommandContext.test() defaults to same time for notebookNow and systemNow', () => {
  const context = CommandContext.test(config)

  assert({
    given: 'test factory without time overrides',
    should: 'have notebookNow and systemNow equal',
    actual: context.notebookNow.plainDateTime.toString(),
    expected: context.systemNow.plainDateTime.toString(),
  })
})

test('CommandContext.fork() preserves time properties', () => {
  const mockNbTime = new ZonedDateTime('2025-03-15 10:30', 'America/New_York')
  const mockSystemTime = new ZonedDateTime('2025-03-15 06:30', 'America/New_York')
  const original = CommandContext.test(config, {
    notebookNow: mockNbTime,
    systemNow: mockSystemTime,
  })
  const forked = original.fork({ output: new BufferedOutput() })

  assert({
    given: 'forked context',
    should: 'preserve notebookNow',
    actual: forked.notebookNow.plainDateTime.toString(),
    expected: '2025-03-15 10:30',
  })

  assert({
    given: 'forked context',
    should: 'preserve systemNow',
    actual: forked.systemNow.plainDateTime.toString(),
    expected: '2025-03-15 06:30',
  })
})

// Immutability Tests

test('CommandContext properties are present', () => {
  const context = CommandContext.test(config)

  assert({
    given: 'a CommandContext',
    should: 'have platform property',
    actual: context.platform !== undefined,
    expected: true,
  })

  assert({
    given: 'a CommandContext',
    should: 'have config property',
    actual: context.config !== undefined,
    expected: true,
  })

  assert({
    given: 'a CommandContext',
    should: 'have env property',
    actual: context.env !== undefined,
    expected: true,
  })

  assert({
    given: 'a CommandContext',
    should: 'have output property',
    actual: context.output !== undefined,
    expected: true,
  })
})

// Fork Tests

test('CommandContext.fork() creates new context with overrides', () => {
  const originalEnv = { ORIGINAL: 'value' }
  const original = CommandContext.console(config, originalEnv)

  const newEnv = { NEW: 'value' }
  const forked = original.fork({ env: newEnv })

  assert({
    given: 'forked context with new env',
    should: 'use new env',
    actual: forked.env,
    expected: newEnv,
  })

  assert({
    given: 'forked context',
    should: 'keep original platform',
    actual: forked.platform,
    expected: CommandPlatform.Console,
  })

  assert({
    given: 'forked context',
    should: 'keep original config',
    actual: forked.config,
    expected: config,
  })

  assert({
    given: 'forked context',
    should: 'keep original output',
    actual: forked.output,
    expected: original.output,
  })
})

test('CommandContext.fork() can override platform', () => {
  const original = CommandContext.console(config, {})
  const forked = original.fork({ platform: CommandPlatform.Test })

  assert({
    given: 'forked context with new platform',
    should: 'use new platform',
    actual: forked.platform,
    expected: CommandPlatform.Test,
  })

  assert({
    given: 'original context',
    should: 'remain unchanged',
    actual: original.platform,
    expected: CommandPlatform.Console,
  })
})

test('CommandContext.fork() can override output', () => {
  const original = CommandContext.console(config, {})
  const newOutput = new BufferedOutput()
  const forked = original.fork({ output: newOutput })

  assert({
    given: 'forked context with new output',
    should: 'use new output',
    actual: forked.output,
    expected: newOutput,
  })

  assert({
    given: 'forked context',
    should: 'not modify original output',
    actual: forked.output === original.output,
    expected: false,
  })
})

test('CommandContext.fork() does not mutate original', () => {
  const originalEnv = { ORIGINAL: 'value' }
  const original = CommandContext.console(config, originalEnv)

  const newEnv = { NEW: 'value' }
  const forked = original.fork({ env: newEnv })

  assert({
    given: 'forked context',
    should: 'not change original env',
    actual: original.env,
    expected: originalEnv,
  })

  assert({
    given: 'forked context',
    should: 'create new instance',
    actual: forked === original,
    expected: false,
  })
})

test('CommandContext.fork() with no overrides creates identical context', () => {
  const original = CommandContext.test(config, { env: { TEST: 'value' } })
  const forked = original.fork({})

  assert({
    given: 'forked context with no overrides',
    should: 'have same platform',
    actual: forked.platform,
    expected: original.platform,
  })

  assert({
    given: 'forked context with no overrides',
    should: 'have same config',
    actual: forked.config,
    expected: original.config,
  })

  assert({
    given: 'forked context with no overrides',
    should: 'have same env',
    actual: forked.env,
    expected: original.env,
  })

  assert({
    given: 'forked context with no overrides',
    should: 'have same output',
    actual: forked.output,
    expected: original.output,
  })

  assert({
    given: 'forked context with no overrides',
    should: 'be new instance',
    actual: forked === original,
    expected: false,
  })
})

// CommandPlatform Enum Tests

test('CommandPlatform enum has expected values', () => {
  assert({
    given: 'CommandPlatform enum',
    should: 'have Console value',
    actual: CommandPlatform.Console,
    expected: 'console',
  })

  assert({
    given: 'CommandPlatform enum',
    should: 'have VSCode value',
    actual: CommandPlatform.VSCode,
    expected: 'vscode',
  })

  assert({
    given: 'CommandPlatform enum',
    should: 'have Server value',
    actual: CommandPlatform.Server,
    expected: 'server',
  })

  assert({
    given: 'CommandPlatform enum',
    should: 'have Test value',
    actual: CommandPlatform.Test,
    expected: 'test',
  })
})

// Composition Depth Tests

test('CommandContext.compositionDepth defaults to 0', () => {
  const context = CommandContext.test(config)

  assert({
    given: 'a new CommandContext',
    should: 'have compositionDepth of 0',
    actual: context.compositionDepth,
    expected: 0,
  })
})

test('CommandContext.console() has compositionDepth of 0', () => {
  const context = CommandContext.console(config, {})

  assert({
    given: 'console factory',
    should: 'have compositionDepth of 0',
    actual: context.compositionDepth,
    expected: 0,
  })
})

test('CommandContext.fork() preserves compositionDepth by default', () => {
  const original = CommandContext.test(config)
  const forked = original.fork({})

  assert({
    given: 'forked context without compositionDepth override',
    should: 'preserve compositionDepth from parent',
    actual: forked.compositionDepth,
    expected: 0,
  })
})

test('CommandContext.fork() can override compositionDepth', () => {
  const original = CommandContext.test(config)
  const forked = original.fork({ compositionDepth: 1 })

  assert({
    given: 'forked context with compositionDepth override',
    should: 'use the overridden compositionDepth',
    actual: forked.compositionDepth,
    expected: 1,
  })

  assert({
    given: 'original context after fork',
    should: 'remain unchanged',
    actual: original.compositionDepth,
    expected: 0,
  })
})

test('CommandContext.fork() twice with incremented depth results in depth 2', () => {
  const root = CommandContext.test(config)

  // Simulate CommandService.run() behavior: increment depth on each fork
  const child1 = root.fork({ compositionDepth: root.compositionDepth + 1 })
  const child2 = child1.fork({ compositionDepth: child1.compositionDepth + 1 })

  assert({
    given: 'root context',
    should: 'have compositionDepth of 0',
    actual: root.compositionDepth,
    expected: 0,
  })

  assert({
    given: 'first child context',
    should: 'have compositionDepth of 1',
    actual: child1.compositionDepth,
    expected: 1,
  })

  assert({
    given: 'second child context (forked twice)',
    should: 'have compositionDepth of 2',
    actual: child2.compositionDepth,
    expected: 2,
  })
})

// Parent Task Name Tests

test('CommandContext.parentTaskName is undefined by default', () => {
  const context = CommandContext.test(config)

  assert({
    given: 'a new CommandContext',
    should: 'have undefined parentTaskName',
    actual: context.parentTaskName,
    expected: undefined,
  })
})

test('CommandContext.console() has undefined parentTaskName', () => {
  const context = CommandContext.console(config, {})

  assert({
    given: 'console factory',
    should: 'have undefined parentTaskName (root task)',
    actual: context.parentTaskName,
    expected: undefined,
  })
})

test('CommandContext.fork() can set parentTaskName', () => {
  const original = CommandContext.test(config)
  const forked = original.fork({ parentTaskName: 'parent:task' })

  assert({
    given: 'forked context with parentTaskName',
    should: 'have the specified parentTaskName',
    actual: forked.parentTaskName,
    expected: 'parent:task',
  })

  assert({
    given: 'original context after fork',
    should: 'remain undefined',
    actual: original.parentTaskName,
    expected: undefined,
  })
})

test('CommandContext.fork() preserves parentTaskName by default', () => {
  const original = CommandContext.test(config)
  const child = original.fork({ parentTaskName: 'parent:task' })
  const grandchild = child.fork({})

  assert({
    given: 'grandchild context forked without parentTaskName override',
    should: 'preserve parentTaskName from parent',
    actual: grandchild.parentTaskName,
    expected: 'parent:task',
  })
})

test('CommandContext.fork() simulates task composition chain', () => {
  // Simulate: CLI -> task:a -> task:b -> task:c
  const root = CommandContext.test(config)

  // task:a called from CLI (no parent)
  const taskA = root.fork({
    compositionDepth: 1,
    parentTaskName: undefined, // root has no parent
  })

  // task:b called from task:a
  const taskB = taskA.fork({
    compositionDepth: 2,
    parentTaskName: 'task:a',
  })

  // task:c called from task:b
  const taskC = taskB.fork({
    compositionDepth: 3,
    parentTaskName: 'task:b',
  })

  assert({
    given: 'task:a (called from CLI)',
    should: 'have undefined parentTaskName',
    actual: taskA.parentTaskName,
    expected: undefined,
  })

  assert({
    given: 'task:b (called from task:a)',
    should: 'have parentTaskName of task:a',
    actual: taskB.parentTaskName,
    expected: 'task:a',
  })

  assert({
    given: 'task:c (called from task:b)',
    should: 'have parentTaskName of task:b',
    actual: taskC.parentTaskName,
    expected: 'task:b',
  })
})
