import { Command, CommandArgs, CommandDescription, CommandResult } from '#commands/mod.ts'

/**
 * Example task demonstrating CommandService usage and composition patterns
 */
export default class TestServiceTask extends Command {
  static override description: CommandDescription = {
    name: 'test:service',
    description: 'Demonstrate CommandService composition capabilities',
  }

  async run({ context, tasks }: CommandArgs): Promise<CommandResult> {
    const { output } = context

    output.log('CommandService Example Task')
    output.log('=========================')
    output.log('')

    // Demonstrate 1: Run a single task
    output.log('1. Running single task (test:context)')
    output.log('')
    const contextResult = await tasks.run('test:context')

    if (contextResult.status !== 'success') {
      return CommandResult.fail('test:context failed')
    }
    output.log('')

    // Demonstrate 2: Run tasks in parallel
    output.log('2. Running tasks in parallel')
    output.log('')

    const parallelResults = await tasks.runParallel([['test:context'], ['test:context']])

    const parallelFailures = parallelResults.filter((r) => r.status !== 'success')
    if (parallelFailures.length > 0) {
      return CommandResult.fail(`${parallelFailures.length} parallel tasks failed`)
    }
    output.log('')

    // Demonstrate 3: Run tasks sequentially
    output.log('3. Running tasks sequentially')
    output.log('')

    const sequentialResult = await tasks.runSequential([['test:context'], ['test:context']])

    if (sequentialResult.status !== 'success') {
      return CommandResult.fail('Sequential execution failed')
    }
    output.log('')

    // Demonstrate 4: Task with argument overrides
    output.log('4. Running task with custom arguments (coming soon)')
    output.log('   Example: tasks.run("util:location", { mobile: false })')
    output.log('')

    output.log('✓ CommandService demonstration complete!')
    output.log('')
    output.log('Key takeaways:')
    output.log('  - tasks.run() executes single tasks')
    output.log('  - tasks.runParallel() runs multiple tasks concurrently')
    output.log('  - tasks.runSequential() runs tasks in order (stops on failure)')
    output.log('  - Arguments are inherited and can be overridden')
    output.log('  - Output is automatically nested and indented')

    return CommandResult.success({
      testsRun: 3,
      allPassed: true,
    })
  }
}
