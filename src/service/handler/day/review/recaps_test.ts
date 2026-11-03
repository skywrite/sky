import type { CommandEntry } from '#commands/all/cli/_commandsManifest.ts'
import { assert, test } from '#test'
import { installedRecaps } from './recaps.ts'

const command = (name: string, description: string, takesDay = true): CommandEntry => ({
  name,
  file: `/commands/${name}.ts`,
  description,
  flags: takesDay ? [{ name: 'day', kind: 'arg', type: 'plainDate', description: 'Day' }] : [],
  aiChatTool: false,
})

test('the review offers every installed day recap, titled as its app writes itself', () => {
  assert({
    given: 'core and local recaps, a recap without a day, and another command',
    should: 'list each day recap once, the local copy winning, sorted by title',
    actual: installedRecaps({
      version: 2,
      commands: {
        core: [
          command('recap:github', "Recap the day's GitHub activity into actions/recaps/"),
          command('recap:claude-code', "Recap the day's Claude Code sessions into actions/recaps/"),
          command('recap:mealbook', 'Core copy, replaced by the local command'),
          command('recap:week', 'Recap the week', false),
          command('day:start', 'Start the day'),
        ],
        local: [
          command('recap:mealbook', "Recap the day's MealBook entries into actions/recaps/"),
          command('recap:lifting', "Recap the day's workouts into actions/recaps/"),
        ],
        global: [],
      },
    }),
    expected: [
      { id: 'claude-code', title: 'Claude Code recap' },
      { id: 'github', title: 'GitHub recap' },
      { id: 'lifting', title: 'Lifting recap' },
      { id: 'mealbook', title: 'MealBook recap' },
    ],
  })
})
