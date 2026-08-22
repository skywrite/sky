import { Command, type CommandArgs, type CommandDescription, CommandPlatform, CommandResult } from '#commands/mod.ts'

/**
 * Example task demonstrating CommandContext usage
 */
export default class TestContextTask extends Command {
  static override description: CommandDescription = {
    name: 'test:context',
    description: 'Demonstrate CommandContext usage and features',
  }

  async run({ context, args }: CommandArgs): Promise<CommandResult> {
    const { output } = context

    output.log('CommandContext Example Task')
    output.log('========================')
    output.log('')

    // Demonstrate platform access
    output.log(`Platform: ${context.platform}`)
    output.log(`Is Console? ${context.platform === CommandPlatform.Console}`)
    output.log(`Is Test? ${context.platform === CommandPlatform.Test}`)
    output.log('')

    // Demonstrate config access
    output.log('Configuration:')
    output.log(`  DIR_BASE: ${context.config.DIR_BASE}`)
    output.log(`  DIR_DATA: ${context.config.DIR_DATA}`)
    output.log('')

    // Demonstrate environment variables
    output.log('Environment Variables:')
    output.log(`  NODE_ENV: ${context.env.NODE_ENV || 'not set'}`)
    output.log(`  SKY_DIR: ${context.env.SKY_DIR || 'not set'}`)
    output.log('')

    // Demonstrate platform-specific behavior
    output.log('Platform-Specific Behavior:')
    if (context.platform === CommandPlatform.Console) {
      output.log('  Running in console - full features available')
    } else if (context.platform === CommandPlatform.Test) {
      output.log('  Running in test mode - limited features')
    } else if (context.platform === CommandPlatform.Server) {
      output.log('  Running in server mode - API context')
    }
    output.log('')

    // Demonstrate context usage for conditional logic
    const shouldSkipExternalCalls = context.platform === CommandPlatform.Test
    output.log(`Skip external calls? ${shouldSkipExternalCalls}`)
    output.log('')

    // Show that deprecated fields still work
    output.log('Backward Compatibility:')
    output.log('  args: ✓ (preferred way to access arguments)')
    output.log('  context.output: ✓ (preferred way to access output)')
    output.log('  context.config: ✓ (preferred way to access config)')
    output.log('  context.env: ✓ (preferred way to access env)')
    output.log('')

    output.log('✓ CommandContext demonstration complete!')

    return CommandResult.success({
      platform: context.platform,
      hasConfig: !!context.config,
      hasEnv: !!context.env,
      hasOutput: !!context.output,
    })
  }
}
