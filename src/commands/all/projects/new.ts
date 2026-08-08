import * as path from 'node:path'
import * as p from '@clack/prompts'
import { generateText } from 'ai'
import colors from 'picocolors'
import { z } from 'zod'
import { gatherNotebookContext, runClarifierLoop } from '#commands/lib/interview.ts'
import { Arg, categoryComplete, Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { slugify } from '#lib/string/mod.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { extractJson } from '#shared/ai/extractJson.ts'
import { aiModel } from '#shared/ai/models.ts'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
import ProjectDocument from '#shared/models/Project/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  name: Arg.string('Project name; the interview asks for the description separately', {
    optional: true,
  }),
  dir: Flag.string('Project directory (defaults to slugified name)', {
    short: 'd',
    optional: true,
  }),
  quick: Flag.bool('Skip the AI interview and scaffold an empty overview', {
    short: 'q',
    default: false,
  }),
  when: whenNBTime(),
  category: categoryComplete(),
}

type Params = InferParams<typeof params>
type Result = { filePath: string; projectSlug: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'projects:new': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const CLARIFIER_FILE = new URL('./prompts/projects-clarifier.prompt.md', import.meta.url).pathname
const DONE_FILE = new URL('./prompts/projects-done.prompt.md', import.meta.url).pathname
const FORMAT_FILE = new URL('./prompts/projects-format.prompt.md', import.meta.url).pathname

const MAX_CLARIFICATION_ROUNDS = 4
const MAX_DONE_ROUNDS = 4

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// The AI response is validated against the prompt contract so a malformed
// reply degrades loudly instead of writing a half-empty document.

const formatSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  whatIsIt: z.string().min(1),
  whyItMatters: z.string().min(1),
  doneLooksLike: z.string().min(1),
  firstStep: z.string().min(1),
  rel: z.array(z.string()).nullish(),
})

function buildOverviewBody(sections: z.infer<typeof formatSchema>): string {
  return [
    `# ${sections.title}`,
    '',
    '## What is the project?',
    '',
    sections.whatIsIt.trim(),
    '',
    '## Why does this matter?',
    '',
    sections.whyItMatters.trim(),
    '',
    '## What does "done" look like?',
    '',
    sections.doneLooksLike.trim(),
    '',
    "## What's the first concrete step?",
    '',
    sections.firstStep.trim(),
  ].join('\n')
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class ProjectsNewTask extends Command {
  static override description: CommandDescription = {
    name: 'projects:new',
    description: 'Create a new project with an AI-guided interview.',
    descriptionLong: [
      'Creates a project overview with an AI-guided interview flow:',
      'the AI clarifies the project, dials in what "done" looks like,',
      'and writes the overview sections filled in.',
      'Use --quick to scaffold an empty template without AI.',
    ],
    usage: [
      'sky projects:new                            # Interactive AI-guided flow',
      'sky projects:new "My Project"               # Name it up front; interview fills the rest',
      'sky projects:new "My Project" --quick       # Empty template, no AI',
      'sky projects:new "My Project" -q -d sub/dir # Custom directory',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { name, when, dir, category, quick } = args

    const openRoot = config.DIR_PROJECTS_OPEN as string
    const baseDir = config.DIR_BASE as string

    let projectSlug: string
    let body: string | undefined
    let tags: TagSet | undefined
    let rel: string[] = []
    let dayDetail = ''

    if (quick) {
      if (!name?.trim()) {
        return CommandResult.fail('--quick requires a project name')
      }

      projectSlug = slugify(name, { preserveCase: true })

      if (!projectSlug) {
        return CommandResult.fail('Could not derive a usable slug from the name')
      }
    } else {
      // An explicit --dir that already holds a project would only surface after
      // the whole interview — check before spending the user's time
      if (dir && (await exists(path.join(openRoot, dir, '_project', 'overview.md')))) {
        return CommandResult.fail(`A project overview already exists in --dir "${dir}" — pick a different directory.`)
      }

      p.intro(colors.bold(colors.cyan('New Project')))

      const spinner = p.spinner()

      // Step 1: Always ask for a description — a name arg names the project
      // but is no substitute for describing it, and everything downstream
      // (context queries, clarification) keys off the description
      const projectName = name?.trim()

      const answer = await p.text({
        message: projectName ? `What is "${projectName}" about?\n` : 'What is the project?\n',
        placeholder: 'e.g., "Migrate billing off the legacy API"',
        validate: (value) => {
          if (!value.trim()) return 'Please describe the project'
        },
      })

      if (p.isCancel(answer)) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      const initialDescription = answer as string

      // Step 2: Gather notebook context
      spinner.start('Gathering context...')
      const { notebookContext, relCandidates } = await gatherNotebookContext(tasks, baseDir, initialDescription)
      spinner.stop(notebookContext ? colors.dim('Context loaded') : colors.dim('No additional context found'))

      // Step 3: Clarify the project until it's well-formed
      const projectResult = await runClarifierLoop(initialDescription, {
        promptFile: CLARIFIER_FILE,
        promptName: 'projects-clarifier.prompt.md',
        buildInput: (currentInput, conversationHistory) => ({
          clarifier: {
            currentInput,
            conversationHistory: conversationHistory || undefined,
            notebookContext,
          },
        }),
        clearKey: 'statement',
        labels: {
          thinking: 'Analyzing your project...',
          clear: 'Project is clear',
          confirm: 'Project:',
          edit: 'How would you describe the project?',
        },
        maxRounds: MAX_CLARIFICATION_ROUNDS,
        errorSource: 'projects:new',
        errorStage: 'clarify',
        spinner,
      })

      if (projectResult === null) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      // Step 4: Pin down what "done" looks like. Starts with no user input —
      // the AI extracts the finish line when the description already contains
      // it, and only asks when it's genuinely missing
      const doneResult = await runClarifierLoop('', {
        promptFile: DONE_FILE,
        promptName: 'projects-done.prompt.md',
        buildInput: (currentInput, conversationHistory) => ({
          done: {
            project: projectResult.statement,
            projectConversation: projectResult.conversation || undefined,
            currentInput: currentInput || undefined,
            conversationHistory: conversationHistory || undefined,
            notebookContext,
          },
        }),
        clearKey: 'statement',
        labels: {
          thinking: 'Evaluating your finish line...',
          clear: 'Done-criteria are clear',
          confirm: 'Done looks like:',
          edit: 'How would you describe what done looks like?',
        },
        maxRounds: MAX_DONE_ROUNDS,
        errorSource: 'projects:new',
        errorStage: 'done',
        spinner,
      })

      if (doneResult === null) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      // Step 5: First concrete step (the user's call — no AI loop)
      const firstStep = await p.text({
        message: "What's the first concrete step?\n",
        placeholder: 'e.g., "List every endpoint the old integration calls"',
        validate: (value) => {
          if (!value.trim()) return 'Please name the first step'
        },
      })

      if (p.isCancel(firstStep)) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      // Step 6: Optional tags
      const tagsInput = await p.text({
        message: 'Tags (comma-separated, or press Enter to skip)\n',
        placeholder: 'e.g., billing, infrastructure',
      })

      if (p.isCancel(tagsInput)) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      tags = (tagsInput as string)?.trim() ? TagSet.fromArray((tagsInput as string).split(',')) : undefined

      // Step 7: Synthesize the overview sections
      spinner.start('Formatting your project...')

      const formatContent = await readTextFile(FORMAT_FILE)

      const formatInput: RenderInput = {
        context: { notebookDate: when.date },
        project: {
          statement: projectResult.statement,
          statementConversation: projectResult.conversation || undefined,
          doneStatement: doneResult.statement,
          doneConversation: doneResult.conversation || undefined,
          firstStep: firstStep as string,
          relatedPaths: relCandidates.length > 0 ? relCandidates.join('\n') : undefined,
        },
      }

      const { output: renderedFormat } = renderPromptFile(formatContent, 'projects-format.prompt.md', formatInput)

      let aiResponse: z.infer<typeof formatSchema>

      try {
        const result = await generateText({
          ...aiModel('reasoning'),
          prompt: renderedFormat,
        })

        aiResponse = formatSchema.parse(extractJson(result.text))
        spinner.stop('Project formatted')
      } catch (err) {
        spinner.stop('Failed to format project')
        await logAIError({ source: 'projects:new', stage: 'format', message: (err as Error).message })
        output.error(`AI Error: ${(err as Error).message}`)
        return CommandResult.error(err as Error, 'Failed to format project with AI')
      }

      // Step 8: Determine title + slug — a user-given name wins over the
      // AI's suggestions; every source passes through slugify so no value can
      // smuggle path separators into the directory name
      const title = projectName || aiResponse.title

      projectSlug =
        (projectName ? slugify(projectName, { preserveCase: true }) : '') ||
        slugify(aiResponse.slug, { suggestedLength: 25, preserveCase: true }) ||
        slugify(aiResponse.title, { suggestedLength: 25, preserveCase: true }) ||
        slugify(projectResult.statement, { suggestedLength: 25, preserveCase: true })

      if (!projectSlug) {
        return CommandResult.fail('Could not derive a usable slug — rerun with --quick and a name')
      }

      // Only rel values the AI picked from the offered candidate list survive
      rel = (aiResponse.rel ?? []).filter((r) => relCandidates.includes(r))

      body = buildOverviewBody({ ...aiResponse, title })
      dayDetail = ` | ${title}`
    }

    // Resolve the target without clobbering an existing overview. An
    // auto-derived collision in interview mode re-asks for a name rather than
    // discarding the whole interview; explicit choices (--quick, --dir) fail.
    let projectDir = dir ? path.join(openRoot, dir) : path.join(openRoot, projectSlug)
    let projectOverviewFile = path.join(projectDir, '_project', 'overview.md')

    while (await exists(projectOverviewFile)) {
      if (quick || dir) {
        return CommandResult.fail(
          `A project overview already exists: ${projectOverviewFile} — pick a different name or --dir.`,
        )
      }

      const renamed = await p.text({
        message: `A project named "${projectSlug}" already exists — pick a different name\n`,
        initialValue: projectSlug,
        validate: (value) => {
          if (!slugify(value, { preserveCase: true })) return 'Please provide a usable name'
        },
      })

      if (p.isCancel(renamed)) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      projectSlug = slugify(renamed as string, { preserveCase: true })
      projectDir = path.join(openRoot, projectSlug)
      projectOverviewFile = path.join(projectDir, '_project', 'overview.md')
    }

    const doc = ProjectDocument.create({
      name: projectSlug,
      tags,
      rel: rel.length > 0 ? rel : undefined,
      body,
      created: when.plainDate,
    })

    await outputFile(projectOverviewFile, doc.toMarkdown())

    const dayItem = `${when.time} > projects/${projectSlug} -> Created${dayDetail}`
    await writeDayItems(when.plainDate, category, dayItem)

    await openEditor([{ file: projectOverviewFile, line: 0 }])

    if (!quick) {
      p.outro(colors.green(`Project "${projectSlug}" created successfully`))
    }

    output.log(`\n  Successfully created ${projectOverviewFile}.\n`)

    return CommandResult.success({ filePath: projectOverviewFile, projectSlug })
  }
}
