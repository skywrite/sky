import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'

// -----------------------------------------------------------------------------
// Categories & Prompts
// -----------------------------------------------------------------------------

const categories = [
  'hardwork',
  'chinese',
  'bible',
  'stoic',
  'zen',
  'greek',
  'japanese',
  'arabic',
  'african',
  'latin',
  'entrepreneur',
  'leadership',
  'science',
  'poetry',
] as const

type Category = (typeof categories)[number]
type Result = { quote: string; category: Category }

const prompts: Record<Category, string> = {
  hardwork: `Give me one short, powerful quote about hard work, discipline, or perseverance.
Include the author if known. Just the quote and attribution, nothing else.`,

  chinese: `Give me one Chinese proverb with deep wisdom.
Include the original Chinese characters if possible, followed by the English translation.
Just the proverb, nothing else.`,

  bible: `Give me one verse from Psalms or Proverbs that provides wisdom or encouragement.
Include the book, chapter, and verse reference.
Just the verse and reference, nothing else.`,

  stoic: `Give me one powerful quote from a Stoic philosopher (Marcus Aurelius, Seneca, or Epictetus).
Include the author. Just the quote and attribution, nothing else.`,

  zen: `Give me one Zen Buddhist saying, koan, or piece of wisdom.
Keep it brief and thought-provoking. Just the wisdom, nothing else.`,

  greek: `Give me one profound quote from an ancient Greek philosopher (Aristotle, Plato, Socrates, Heraclitus, etc.).
Include the author. Just the quote and attribution, nothing else.`,

  japanese: `Give me one Japanese proverb (kotowaza) with deep wisdom.
Include the original Japanese if possible, followed by the English translation.
Just the proverb, nothing else.`,

  arabic: `Give me one Arabic proverb with timeless wisdom.
Include the original Arabic if possible, followed by the English translation.
Just the proverb, nothing else.`,

  african: `Give me one African proverb with deep wisdom.
Include the country or region of origin if known.
Just the proverb and origin, nothing else.`,

  latin: `Give me one Latin proverb or saying with timeless wisdom.
Include the original Latin followed by the English translation.
Just the proverb and translation, nothing else.`,

  entrepreneur: `Give me one powerful quote about entrepreneurship, building businesses, or taking risks.
Include the author if known. Just the quote and attribution, nothing else.`,

  leadership: `Give me one powerful quote about leadership, inspiring others, or making hard decisions.
Include the author if known. Just the quote and attribution, nothing else.`,

  science: `Give me one inspiring quote from a scientist about curiosity, discovery, or the pursuit of knowledge.
Include the author. Just the quote and attribution, nothing else.`,

  poetry: `Give me 2-4 lines from a classic poem that are inspiring or thought-provoking.
Include the poet and poem title. Just the excerpt and attribution, nothing else.`,
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:wisdom': { params: Record<string, never>; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class DayWisdomTask extends Command {
  static override description: CommandDescription = {
    name: 'day:wisdom',
    description: 'Generate an inspirational quote using AI',
    descriptionLong: [
      'Generates wisdom from a random category: hard work, Chinese proverbs,',
      'Bible verses, Stoic philosophy, Zen Buddhism, Greek philosophers,',
      'Japanese proverbs, Arabic proverbs, African proverbs, Latin sayings,',
      'entrepreneurship, leadership, science, or poetry.',
      '',
      'Uses GPT-5-mini for fast generation.',
    ],
    usage: ['sky day:wisdom    # Random wisdom from any category'],
  }

  async run({ context }: CommandArgs): Promise<CommandResult<Result>> {
    const { output } = context

    const category = categories[Math.floor(Math.random() * categories.length)]
    const prompt = prompts[category]

    const result = await generateText({
      model: openai('gpt-5-mini'),
      prompt,
    })

    const quote = result.text.trim()
    output.log('')
    output.log(quote)
    output.log('')

    return CommandResult.success({ quote, category })
  }
}
