import { writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import colors from 'picocolors'
import { createFileTools, READ_FILE_TOOL } from '#commands/lib/chat/fileTools.ts'
import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_ATTACHMENTS, DIR_STATE } from '#config'
import { askWith } from '#lib/browser/jev/decide.ts'
import { runEpilogue } from '#lib/browser/jev/epilogue.ts'
import { runJevTask } from '#lib/browser/jev/runJevTask.ts'
import { runBrowserTask, WAIT_FOR_PERSON_TOOL } from '#lib/browser/task/runTask.ts'
import { createTaskDir } from '#lib/browser/task/taskDir.ts'
import { PasswordManagerSettingsStore } from '#lib/credentials/passwordManagers.ts'
import { aiModel, getProfile, resolveProfile, roleProfile } from '#shared/ai/models.ts'
import { createTypeSafeClient } from '#shared/ai/typesafe/client.ts'
import { readSkyConfigFile } from '#shared/config/loader.ts'
import type { ChatEngineEvent } from '#shared/models/Chat/ChatEngine/mod.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import { createSaveFileTool, SAVE_FILE_TOOL } from './lib/saveFileTool.ts'

// browser:task — Sky does something in a real browser window on the
// person's behalf: opens sites, signs in with their help, finds things,
// downloads and checks files. The design lives in lib/browser/docs.
//
// Two drivers. By default TypeSafe's Jev picks each move from a table of
// the page, with the reasoning model reading, typing and finishing. With the
// Experimental switch off, the reasoning model reads the page and calls
// the browser tools itself.

/**
 * The Jev driver's language model: the person's reasoning role, one effort
 * rung down. It reads pages and failures for Jev, types into fields, and
 * writes the ending — checks the files, saves them, reports.
 */
const jevLanguageModel = () => resolveProfile(getProfile(roleProfile('reasoning')), { effort: 'medium' })

const params = {
  objective: Arg.string('What to do in the browser, in plain words'),
}

type Params = InferParams<typeof params>

/** One dim line per browser move, in the person's words rather than the tool's. */
function toolLine(name: string, input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>
  const target = String(o.element ?? o.target ?? '')
  switch (name) {
    case 'browser_navigate':
      return `Opening ${o.url}`
    case 'browser_navigate_back':
      return 'Going back'
    case 'browser_snapshot':
      return 'Looking at the page'
    case 'browser_find':
      return `Finding "${o.text ?? o.regex}"`
    case 'browser_click':
      return `Clicking ${target}`
    case 'browser_type':
      return `Typing into ${target}`
    case 'browser_fill_form':
      return 'Filling in the form'
    case 'browser_press_key':
      return `Pressing ${o.key}`
    case 'browser_select_option':
      return `Choosing ${target}`
    case 'browser_wait_for':
      return o.text ? `Waiting for "${o.text}"` : o.textGone ? `Waiting for "${o.textGone}" to go` : 'Waiting'
    case 'browser_tabs':
      return `Tabs: ${o.action}`
    case 'browser_take_screenshot':
      return 'Taking a screenshot'
    case 'browser_file_upload':
      return `Uploading ${(o.paths as string[] | undefined)?.join(', ') ?? 'a file'}`
    case READ_FILE_TOOL:
      return `Reading ${o.path}`
    case SAVE_FILE_TOOL:
      return `Saving ${o.path} to ${o.to}`
    case WAIT_FOR_PERSON_TOOL:
      return ''
    default:
      return `Running: ${name}`
  }
}

export default class BrowserTaskCommand extends Command {
  static override description: CommandDescription = {
    name: 'browser:task',
    description:
      'Do something in a real browser on your behalf: open sites, sign in with your help, find things, download and check files.',
    params,
  }

  async run({ context, args }: CommandArgs<Params>): Promise<CommandResult> {
    const { output, prompt } = context
    const now = context.notebookNow
    const objective = args.objective.trim()
    if (!objective) return CommandResult.fail('Say what to do in the browser, in plain words.')
    const passwordManagers = await new PasswordManagerSettingsStore(
      path.join(DIR_STATE, 'credentials', 'sources.json'),
    ).read()
    const privateSignIn =
      process.platform === 'darwin' || passwordManagers.sources.length > 0 || !!passwordManagers.nativeBrowser

    const task = await createTaskDir(now, objective)
    output.log(colors.dim(`Task folder: ${task.dir}`))
    output.log(
      colors.dim(
        privateSignIn
          ? 'Sky opens a private browser for this task. Approve sign-in in the native dialog; the session closes when the task ends.'
          : 'Sky’s browser opens a tab of its own for this task; the window stays open after.',
      ),
    )
    // Jev drives unless the Experimental switch is set off; then the reasoning model does.
    const jev = readSkyConfigFile()?.parsed.experimental?.jevBrowser !== false
    output.log(
      colors.dim(
        jev
          ? 'Driver: Jev picks the moves; your reasoning model reads, types, and finishes.'
          : 'Driver: your reasoning model reads the page and makes the moves.',
      ),
    )

    // The streamed reply leaves the line open between deltas; a tool line
    // or a question closes it first.
    let midLine = false
    const closeLine = () => {
      if (!midLine) return
      output.write('\n')
      midLine = false
    }
    const onEvent = (event: ChatEngineEvent) => {
      switch (event.type) {
        case 'text-delta': {
          const text = midLine ? event.text : event.text.replace(/^\n+/, '')
          if (!text) return
          output.write(text)
          midLine = !text.endsWith('\n')
          return
        }
        case 'tool-call': {
          const line = toolLine(event.toolName, event.input)
          if (!line) return
          closeLine()
          output.log(colors.dim(line))
          return
        }
        case 'tool-execution-end':
          if (!event.error) return
          closeLine()
          output.log(colors.yellow(`  ${event.toolName}: ${event.error}`))
          return
        case 'turn-complete':
          closeLine()
          return
      }
    }

    // The person is needed: say why, then wait at the terminal. Enter means
    // they are done; no one at the keyboard means the task cannot go on.
    const onNeedsYou = async (message: string): Promise<boolean> => {
      closeLine()
      output.log('')
      output.log(colors.bold('Sky needs you in the browser window:'))
      output.log(message)
      if (!prompt.interactive) {
        output.log(colors.yellow('No one is at the keyboard to help, so the task stops here.'))
        return false
      }
      const done = await prompt.confirm({ message: 'Done — should Sky look again?', initial: true })
      return done === true
    }

    const writeReport = (body: string, files: string[], server?: string) =>
      writeFile(
        path.join(task.dir, 'report.md'),
        [
          '---',
          `created: ${now.date}`,
          `updated: ${now.date}`,
          `task: ${JSON.stringify(objective)}`,
          ...(server ? [`browser: ${server}`] : []),
          '---',
          '',
          body.trim(),
          '',
          ...(files.length > 0 ? ['## Files', '', ...files.map((file) => `- ${file}`), ''] : []),
        ].join('\n'),
      )

    const attachments: Attachment[] = []
    const tools = {
      ...createFileTools({
        today: now.plainDateTime.plainDate,
        attachmentsRoot: DIR_ATTACHMENTS,
        cwd: task.filesDir,
        allowedRoot: privateSignIn ? task.filesDir : undefined,
        onAttachments: (files) => attachments.push(...files),
      }),
      ...createSaveFileTool({ filesDir: task.filesDir, cwd: process.cwd() }),
    }

    if (jev) {
      const language = jevLanguageModel()
      let jevResult
      try {
        jevResult = await runJevTask({
          objective,
          ask: askWith(createTypeSafeClient({ secrets: context.secrets })),
          typingModel: language,
          adviserModel: language,
          taskDir: task.dir,
          filesDir: task.filesDir,
          onNeedsYou,
          privateSignIn,
          onStep: (line) => output.log(colors.dim(line)),
          abortSignal: context.signal,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await writeReport(`The task failed before it finished.\n\n${message}`, [])
        output.log('')
        output.log(colors.red(`The task failed: ${message}`))
        output.log(colors.dim(`Task folder: ${task.dir}`))
        return CommandResult.error(error instanceof Error ? error : new Error(message))
      }
      // The ending: the language model checks the files, saves them where
      // the task says, and writes the report. Without files there is
      // nothing to check, and the loop's own account stands.
      let report = jevResult.report
      if (jevResult.files.length > 0) {
        output.log('')
        output.log(
          colors.dim(
            `Checking ${jevResult.files.length === 1 ? 'the file' : `${jevResult.files.length} files`}, one at a time, then finishing up…`,
          ),
        )
        try {
          const ending = await runEpilogue({
            model: language,
            goal: objective,
            tools,
            history: jevResult.history,
            files: jevResult.files,
            outcome: jevResult.reason ?? jevResult.outcome,
            when: `${now.date} ${now.time}`,
            onEvent,
            abortSignal: context.signal,
          })
          closeLine()
          report = ending.report
        } catch (error) {
          closeLine()
          const message = error instanceof Error ? error.message : String(error)
          output.log(colors.yellow(`The ending failed: ${message}`))
          report = `${jevResult.report}\n\nThe ending failed: ${message}`
        }
      } else {
        output.log('')
        output.log(jevResult.report)
      }
      await writeReport(report, jevResult.files, jevResult.server)
      return CommandResult.success({
        id: task.id,
        dir: task.dir,
        driver: 'jev',
        outcome: jevResult.outcome,
        files: jevResult.files,
        attachments: attachments.map((a) => a.file),
        steps: jevResult.steps.length,
      })
    }

    let result
    try {
      result = await runBrowserTask({
        objective,
        model: aiModel('reasoning'),
        taskDir: task.dir,
        filesDir: task.filesDir,
        when: `${now.date} ${now.time}`,
        tools,
        onNeedsYou,
        privateSignIn,
        onEvent,
        abortSignal: context.signal,
      })
    } catch (error) {
      // A task that died keeps its folder and says so in the report, so
      // what it did before failing is still there to read.
      closeLine()
      const message = error instanceof Error ? error.message : String(error)
      await writeReport(`The task failed before it finished.\n\n${message}`, [])
      output.log('')
      output.log(colors.red(`The task failed: ${message}`))
      output.log(colors.dim(`Task folder: ${task.dir}`))
      return CommandResult.error(error instanceof Error ? error : new Error(message))
    }

    closeLine()
    output.log('')
    if (result.cutShort === 'steps') output.log(colors.yellow('The task ran out of steps before it finished.'))
    if (result.cutShort === 'repetition')
      output.log(colors.yellow('The task stopped: the same move kept giving the same result.'))
    if (result.stopped) output.log(colors.yellow('The task was stopped.'))
    if (result.files.length > 0) {
      output.log(colors.dim('Files in the task folder:'))
      for (const file of result.files) output.log(colors.dim(`  ${file}`))
    }

    await writeReport(result.report, result.files, result.server)

    return CommandResult.success({
      id: task.id,
      dir: task.dir,
      files: result.files,
      attachments: attachments.map((a) => a.file),
      ...(result.cutShort ? { cutShort: result.cutShort } : {}),
      ...(result.stopped ? { stopped: true } : {}),
    })
  }
}
