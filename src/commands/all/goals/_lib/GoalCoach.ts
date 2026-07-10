/**
 * GoalCoach - AI-assisted goal discovery and review
 *
 * Uses meta-prompting: AI generates domain-expert personas, has real conversations,
 * and outputs natural prose markdown (no custom parsing needed).
 *
 * TODO: Add web search capability to allow AI to reference goal-setting
 *       frameworks, research, etc. Options:
 *       - @ai-sdk/gateway perplexitySearch() - $5/1000 requests
 *       - Exa (https://docs.exa.ai/reference/vercel) - web search API
 */

import * as p from '@clack/prompts'
import { generateText } from 'ai'
import { aiModel } from '#shared/ai/models.ts'
import colors from 'picocolors'
import { readTextFile } from '#shared/fs/mod.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type GoalCategory = 'Personal' | 'Professional'
export type Timeframe = 'weekly' | 'monthly' | 'quarterly' | 'annual'

export interface GoalCoachOptions {
  category: GoalCategory
  output: OutputHandler
  /** If provided, skips the interactive timeframe selection */
  timeframe?: Timeframe
}

export interface DiscoveryResult {
  success: boolean
  /** Raw markdown content to append to goals file */
  markdown: string
}

export interface ReviewResult {
  success: boolean
  updated: boolean
  feedback: string
}

// -----------------------------------------------------------------------------
// AI Helpers
// -----------------------------------------------------------------------------

/**
 * Generate a domain-expert system prompt based on what the user wants to work on
 */
async function generateExpertPrompt(area: string): Promise<string> {
  const result = await generateText({
    ...aiModel('reasoning'),
    instructions: `You create system prompts for domain-expert AI coaches.

Given an area someone wants to improve, write a system prompt for a world-class expert.

The expert should:
- Have deep, specific expertise (not generic life coach stuff)
- Ask about real numbers, metrics, specifics
- Understand what actually moves the needle in this domain
- Be direct, not fluffy
- Know to ask about timeline/deadline

Output ONLY the system prompt. Start with "You are..."`,
    prompt: `Area: ${area}

Write a system prompt for a world-class expert who coaches people on this.`,
  })

  return result.text.trim()
}

/**
 * Have a coaching conversation and return the next question or DONE
 */
async function continueConversation(
  expertPrompt: string,
  conversation: string[],
  isFirst: boolean,
): Promise<{ response: string; done: boolean }> {
  const result = await generateText({
    ...aiModel('reasoning'),
    instructions:
      expertPrompt +
      `

You're having a coaching conversation to help define a clear, actionable goal.

Rules:
- Ask ONE question at a time
- Be specific - ask for numbers, dates, concrete details
- After 3-5 questions, when you have enough for a SMART goal, output "DONE"
- Make sure to ask about their timeline/deadline at some point

Output either:
1. Your next question (just the question, nothing else)
2. The word "DONE" if you have enough information`,
    prompt: isFirst
      ? `Start the conversation. Ask your first question to understand their situation.`
      : `Conversation so far:\n${conversation.join('\n')}\n\nWhat's your next question, or are you DONE?`,
  })

  const text = result.text.trim()
  const done = text.toUpperCase() === 'DONE' || text.toUpperCase().startsWith('DONE')
  return { response: text, done }
}

/**
 * Generate the final goal as natural markdown prose
 */
async function generateGoalMarkdown(
  expertPrompt: string,
  timeframe: Timeframe,
  conversation: string[],
): Promise<string> {
  const timeframeLabel = {
    weekly: 'Weekly',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    annual: 'Annual',
  }[timeframe]

  const result = await generateText({
    ...aiModel('reasoning'),
    instructions:
      expertPrompt +
      `

Based on the conversation, write a goal section in natural markdown prose.

Format:
## ${timeframeLabel}

### [Goal Area] - [quantitative target if discussed]

[2-4 sentences as natural prose: what they want, why it matters, where they're starting, the target]

Use their actual words and numbers. Be specific, not vague. No fluff. No bullet points or bold labels.`,
    prompt: `Conversation:
${conversation.join('\n')}

Write the goal section.`,
  })

  return result.text.trim()
}

// -----------------------------------------------------------------------------
// GoalCoach Class
// -----------------------------------------------------------------------------

export class GoalCoach {
  private category: GoalCategory
  private output: OutputHandler
  private timeframe?: Timeframe

  constructor(options: GoalCoachOptions) {
    this.category = options.category
    this.output = options.output
    this.timeframe = options.timeframe
  }

  /**
   * Run goal discovery - returns markdown to save
   */
  async discoverGoals(): Promise<DiscoveryResult> {
    p.intro(colors.bold(`${this.category} Goals`))
    this.output.log('')

    // What do they want to work on?
    const areaInput = await p.text({
      message: `What do you want to work on?\n`,
      placeholder: 'e.g., lose weight, get promoted, learn Spanish...',
    })

    if (p.isCancel(areaInput) || !areaInput) {
      p.cancel('Cancelled')
      return { success: false, markdown: '' }
    }

    const area = (areaInput as string).trim()

    // Determine timeframe (use pre-set or ask interactively)
    let timeframe: Timeframe
    if (this.timeframe) {
      timeframe = this.timeframe
    } else {
      const selected = await p.select({
        message: 'What timeframe?\n',
        options: [
          { value: 'weekly', label: 'This week' },
          { value: 'monthly', label: 'This month' },
          { value: 'quarterly', label: 'This quarter' },
          { value: 'annual', label: 'This year' },
        ],
      })

      if (p.isCancel(selected)) {
        p.cancel('Cancelled')
        return { success: false, markdown: '' }
      }
      timeframe = selected as Timeframe
    }

    // Generate expert
    const spinner = p.spinner()
    spinner.start('Finding expert...')
    const expertPrompt = await generateExpertPrompt(area)
    spinner.stop('')

    // Conversation loop
    const conversation: string[] = []
    let isFirst = true

    for (let i = 0; i < 6; i++) {
      const { response, done } = await continueConversation(expertPrompt, conversation, isFirst)
      isFirst = false

      if (done) break

      this.output.log('')
      const answer = await p.text({
        message: response + '\n',
        placeholder: 'Your answer...',
      })

      if (p.isCancel(answer)) {
        p.cancel('Cancelled')
        return { success: false, markdown: '' }
      }

      conversation.push(`Q: ${response}`)
      conversation.push(`A: ${answer}`)
    }

    // Generate goal markdown
    spinner.start('Creating goal...')
    const goalMarkdown = await generateGoalMarkdown(expertPrompt, timeframe, conversation)
    spinner.stop('')

    // Show result
    this.output.log('')
    this.output.log(colors.cyan('─'.repeat(50)))
    this.output.log(goalMarkdown)
    this.output.log(colors.cyan('─'.repeat(50)))

    // Confirm
    this.output.log('')
    const confirm = await p.confirm({
      message: 'Save this goal?',
      initialValue: true,
    })

    if (p.isCancel(confirm) || !confirm) {
      p.cancel('Not saved')
      return { success: false, markdown: '' }
    }

    // Add another?
    const another = await p.confirm({
      message: 'Add another goal?',
      initialValue: false,
    })

    let fullMarkdown = goalMarkdown

    if (!p.isCancel(another) && another) {
      const more = await this.discoverGoals()
      if (more.success) {
        fullMarkdown += '\n\n' + more.markdown
      }
    }

    p.outro(colors.green('Done!'))

    return { success: true, markdown: fullMarkdown }
  }

  /**
   * Review existing goals - reads file, gets AI feedback
   */
  async reviewGoals(goalsFilePath: string): Promise<ReviewResult> {
    const content = await readTextFile(goalsFilePath)

    p.intro(colors.bold(`${this.category} Goals Review`))

    // Show current goals
    this.output.log('')
    this.output.log(colors.gray('Current goals:'))
    this.output.log(colors.gray('─'.repeat(50)))
    this.output.log(content)
    this.output.log(colors.gray('─'.repeat(50)))

    // Ask for update
    this.output.log('')
    const update = await p.text({
      message: 'Any progress or changes to report?\n',
      placeholder: 'Press enter to skip...',
    })

    if (p.isCancel(update)) {
      p.cancel('Cancelled')
      return { success: false, updated: false, feedback: '' }
    }

    if (!update || !(update as string).trim()) {
      p.outro('No updates.')
      return { success: true, updated: false, feedback: '' }
    }

    // Get AI feedback
    const spinner = p.spinner()
    spinner.start('Thinking...')

    const result = await generateText({
      ...aiModel('reasoning'),
      instructions: `You're a direct coach reviewing someone's goal progress.
Be specific and actionable. 2-3 sentences max. No fluff.`,
      prompt: `Goals:\n${content}\n\nUpdate: ${update}\n\nGive feedback.`,
    })

    spinner.stop('')

    this.output.log('')
    this.output.log(colors.bold('Feedback:'))
    this.output.log(result.text)

    p.outro('Done!')

    return { success: true, updated: true, feedback: result.text }
  }
}
