import * as path from 'node:path'
import { generateText } from 'ai'
import { Prompt } from '#commands/lib/core/Prompt.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { aiModel } from '#shared/ai/models.ts'
import { DIR_BASE } from '#shared/config.ts'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
import { AboutMeDocument } from '#shared/models/AboutMe/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  full: Flag.boolean('Run full questionnaire (ignore quarterly cadence)', {
    short: 'f',
    default: false,
  }),
}

type Params = InferParams<typeof params>

interface ProfileData {
  firstName: string
  lastName: string
  location: string
  family: string
  company: string
  title: string
  companyDescription: string
  communicationStyle: string
  decisionMaking: string
  technicalContext: string
  bio?: string
}

type Result = { filePath: string; updated: boolean }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'journal:me:update': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const ABOUT_ME_PATH = path.join(DIR_BASE, 'journal', 'about-me.md')

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function shouldAskAllQuestions(updatedDate: PlainDate | undefined, forceFull: boolean): boolean {
  if (forceFull || !updatedDate) return true

  const today = PlainDate.today()
  const currentQuarter = Math.floor((today.month - 1) / 3)
  const updatedQuarter = Math.floor((updatedDate.month - 1) / 3)

  return today.year !== updatedDate.year || currentQuarter !== updatedQuarter
}

function profileFromAboutMe(doc: AboutMeDocument): ProfileData {
  return {
    firstName: doc.firstName,
    lastName: doc.lastName,
    location: doc.location,
    family: doc.family,
    company: doc.company,
    title: doc.title,
    companyDescription: doc.companyDescription,
    communicationStyle: doc.communicationStyle,
    decisionMaking: doc.decisionMaking,
    technicalContext: doc.technicalContext,
    bio: doc.bio,
  }
}

function generateMarkdown(data: ProfileData): string {
  const today = PlainDate.today().ymd

  return `---
created: ${today}
updated: ${today}
---

# About Me - ${data.firstName} ${data.lastName}

## Personal

**Location:** ${data.location}

## Family

${data.family}

## Professional

**Company:** ${data.company}
**Title:** ${data.title}
**About:** ${data.companyDescription}

## Preferences

**Communication style:** ${data.communicationStyle}
**Decision-making:** ${data.decisionMaking}
**Technical context:** ${data.technicalContext}

## Bio

${data.bio || 'Bio will be generated...'}
`
}

async function generateBio(data: ProfileData): Promise<string> {
  const prompt = `Generate a 2-3 sentence professional bio for this person. Write in third person. Be concise.

Name: ${data.firstName} ${data.lastName}
Location: ${data.location}
Company: ${data.company}
Title: ${data.title}
Company Description: ${data.companyDescription}
Family: ${data.family}
Communication Style: ${data.communicationStyle}
Technical Context: ${data.technicalContext}

Output ONLY the bio text, nothing else.`

  try {
    const result = await generateText({
      ...aiModel('balanced'),
      prompt,
    })
    return result.text.trim()
  } catch {
    // Fallback if AI fails
    return `${data.firstName} is ${data.title} at ${data.company}. Based in ${data.location}.`
  }
}

function selectRandomQuestions(count: number): string[] {
  const allQuestions = [
    'firstName',
    'lastName',
    'location',
    'family',
    'company',
    'title',
    'companyDescription',
    'communicationStyle',
    'decisionMaking',
    'technicalContext',
  ]
  const shuffled = [...allQuestions].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class JournalMeUpdateTask extends Command {
  static override description: CommandDescription = {
    name: 'journal:me:update',
    description: 'Update your personal profile (About Me)',
    descriptionLong: [
      'Creates and updates journal/about-me.md with:',
      'personal info (name, location), family description, professional details',
      '(company, title, description), and preferences (communication style,',
      'decision-making, technical context). Generates an AI bio summary.',
      '',
      'Uses quarterly cadence: full questionnaire on first run or new quarter,',
      'quick check-in (2-3 random questions) otherwise.',
    ],
    usage: [
      'sky journal:me:update         # Run with quarterly cadence',
      'sky journal:me:update --full  # Force full questionnaire',
    ],
    params,
  }

  override async run(args: CommandArgs<Params>): Promise<CommandResult<Result>> {
    return this.processPrompts(args)
  }

  override async *runWithPrompts({
    context,
    args,
  }: CommandArgs<Params>): AsyncGenerator<Prompt, CommandResult<Result>, string> {
    const { output } = context
    const { full } = args

    output.log('Loading profile...')

    // Load existing data if file exists
    let existing: Partial<ProfileData> = {}
    let updatedDate: PlainDate | undefined

    if (await exists(ABOUT_ME_PATH)) {
      const content = await readTextFile(ABOUT_ME_PATH)
      const doc = AboutMeDocument.fromMarkdown(content)
      existing = profileFromAboutMe(doc)
      updatedDate = doc.updated
    }

    const askAll = shouldAskAllQuestions(updatedDate, full)

    // Determine which questions to ask
    let questionsToAsk: string[]
    if (askAll) {
      output.log('Running full questionnaire...')
      questionsToAsk = [
        'firstName',
        'lastName',
        'location',
        'family',
        'company',
        'title',
        'companyDescription',
        'communicationStyle',
        'decisionMaking',
        'technicalContext',
      ]
    } else {
      output.log('Quick check-in (quarterly)...')
      questionsToAsk = selectRandomQuestions(3)
    }

    // Collect data
    const data: ProfileData = {
      firstName: existing.firstName || '',
      lastName: existing.lastName || '',
      location: existing.location || '',
      family: existing.family || '',
      company: existing.company || '',
      title: existing.title || '',
      companyDescription: existing.companyDescription || '',
      communicationStyle: existing.communicationStyle || '',
      decisionMaking: existing.decisionMaking || '',
      technicalContext: existing.technicalContext || '',
    }

    // Ask questions
    for (const q of questionsToAsk) {
      switch (q) {
        case 'firstName': {
          const val = yield Prompt.text('firstName', 'What is your first name?', {
            default: data.firstName,
          })
          data.firstName = val || data.firstName
          break
        }
        case 'lastName': {
          const val = yield Prompt.text('lastName', 'What is your last name?', {
            default: data.lastName,
          })
          data.lastName = val || data.lastName
          break
        }
        case 'location': {
          const val = yield Prompt.text('location', 'Where do you live? (City, State/Country)', {
            default: data.location,
          })
          data.location = val || data.location
          break
        }
        case 'family': {
          const val = yield Prompt.text('family', 'Describe your family (spouse, kids, etc. - free text)', {
            default: data.family,
          })
          data.family = val || data.family
          break
        }
        case 'company': {
          const val = yield Prompt.text('company', 'What company do you work for?', {
            default: data.company,
          })
          data.company = val || data.company
          break
        }
        case 'title': {
          const val = yield Prompt.text('title', 'What is your job title?', {
            default: data.title,
          })
          data.title = val || data.title
          break
        }
        case 'companyDescription': {
          const val = yield Prompt.text('companyDescription', 'Describe what your company does (1-3 sentences)', {
            default: data.companyDescription,
          })
          data.companyDescription = val || data.companyDescription
          break
        }
        case 'communicationStyle': {
          const val = yield Prompt.text(
            'communicationStyle',
            'How would you describe your communication style preferences?',
            { default: data.communicationStyle },
          )
          data.communicationStyle = val || data.communicationStyle
          break
        }
        case 'decisionMaking': {
          const val = yield Prompt.text('decisionMaking', 'How do you approach decision-making?', {
            default: data.decisionMaking,
          })
          data.decisionMaking = val || data.decisionMaking
          break
        }
        case 'technicalContext': {
          const val = yield Prompt.text(
            'technicalContext',
            'What is your technical context? (languages, tools, platforms)',
            { default: data.technicalContext },
          )
          data.technicalContext = val || data.technicalContext
          break
        }
      }
    }

    // Generate bio
    output.log('Generating bio summary...')
    data.bio = await generateBio(data)

    // Generate and save markdown
    const markdown = generateMarkdown(data)

    // Update the created date if file exists
    let finalMarkdown = markdown
    if (await exists(ABOUT_ME_PATH)) {
      const existingContent = await readTextFile(ABOUT_ME_PATH)
      const existingDoc = AboutMeDocument.fromMarkdown(existingContent)
      const createdDate = existingDoc.created?.ymd || PlainDate.today().ymd
      finalMarkdown = markdown.replace(/^created: .+$/m, `created: ${createdDate}`)
    }

    await outputFile(ABOUT_ME_PATH, finalMarkdown)

    output.log(`Saved to ${ABOUT_ME_PATH}`)
    output.log('')
    output.log('Generated bio:')
    output.log(data.bio)

    return CommandResult.success({ filePath: ABOUT_ME_PATH, updated: true })
  }
}
