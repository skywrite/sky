import * as path from 'node:path'
import * as vscode from 'vscode'
import { DIR_CODE } from '#config'
import insertLifts from './commands/insertLifts.ts'
import openWithEditor from './commands/openWithEditor.ts'
import summarizeAllAttachments from './commands/summarizeAllAttachments/mod.ts'
import summarizeAttachment from './commands/summarizeAttachment/mod.ts'
import summarizeTranscript from './commands/summarizeTranscript/mod.ts'
import AttachmentsCompletionItemProvider from './completions/AttachmentsCompletionItemProvider.ts'
import {
  activate as activateCompleteTimeInsert,
  deactivate as deactivateCompleteTimeInsert,
} from './completions/CompleteTimeInsertProvider.ts'
import CurrentDirCompletionProvider from './completions/CurrentDirCompletionItemProvider.ts'
import DayCompletionProvider from './completions/DayCompletionProvider.ts'
import DayItemCompletionProvider from './completions/DayItemCompletionProvider.ts'
import DecisionsCompletionProvider from './completions/DecisionsCompletionItemProvider.ts'
import IdeasCompletionProvider from './completions/IdeasCompletionItemProvider.ts'
import LibraryCompletionProvider from './completions/NotesCompletionItemProvider.ts'
import OrganizationsCompletionItemProvider from './completions/OrganizationsCompletionItemProvider.ts'
import PeopleCompletionItemProvider from './completions/PeopleCompletionItemProvider.ts'
import PlacesCompletionProvider from './completions/PlacesCompletionItemProvider.ts'
import ProjectsCompletionProvider from './completions/ProjectsCompletionItemProvider.ts'
import RecurringPatternCompletionProvider from './completions/RecurringPatternCompletionProvider.ts'
import { CompletionDataStore } from './completions/store/CompletionDataStore.ts'
import TagsCompletionItemProvider from './completions/TagsCompletionItemProvider.ts'
import TimezoneCompletionItemProvider from './completions/TimezoneCompletionItemProvider.ts'
import {
  activate as activateCBHandler,
  deactivate as deactivateCBHandler,
} from './handlers/dayMarkdownCheckBoxHandler.ts'
import {
  activate as activateDroppedHandler,
  deactivate as deactivateDroppedHandler,
} from './handlers/dayMarkdownDroppedHandler.ts'
import {
  activate as activateReminderHandler,
  deactivate as deactivateReminderHandler,
} from './handlers/dayMarkdownReminderHandler.ts'
import {
  activate as activateTodoHandler,
  deactivate as deactivateTodoHandler,
} from './handlers/dayMarkdownTodoHandler.ts'
import {
  activate as activateNotebookTime,
  deactivate as deactivateNotebookTime,
} from './handlers/notebookTimeStatusBar.ts'
import {
  activate as activatePatternHighlighter,
  deactivate as deactivatePatternHighlighter,
} from './highlighters/RecurringPatternHighlighter.ts'
import AttachmentsFieldDocumentLinkProvider, {
  COMMAND_OPEN_FOLDER,
} from './providers/AttachmentsFieldDocumentLinkProvider.ts'
import PersonFieldDocumentLinkProvider from './providers/PersonFieldDocumentLinkProvider.ts'
import RelDocumentLinkProvider from './providers/RelDocumentLinkProvider.ts'
import {
  activate as activateYamlValidator,
  deactivate as deactivateYamlValidator,
} from './validators/YamlFrontmatterValidator.ts'

export function activate(context: vscode.ExtensionContext) {
  // TODO: Port embedded ENV keys (e.g., ANTHROPIC_API_KEY) to VSCode user settings
  // Load environment variables from .env file
  const envPath = path.join(DIR_CODE, 'src', '.env')
  console.log(`[sky-ext] Loading env file from: ${envPath}`)
  try {
    process.loadEnvFile(envPath)
    console.log(`[sky-ext] Env file loaded successfully`)
    console.log(`[sky-ext] ANTHROPIC_API_KEY present: ${!!process.env.ANTHROPIC_API_KEY}`)
  } catch (err) {
    console.error(`[sky-ext] Failed to load env file from ${envPath}:`, err)
  }

  // Initialize centralized completion data store
  const completionStore = CompletionDataStore.getInstance()
  completionStore.initialize()
  context.subscriptions.push({ dispose: () => completionStore.dispose() })
  // context menu item to treeview
  const disposable5 = vscode.commands.registerCommand('extension.openeditor', openWithEditor)
  context.subscriptions.push(disposable5)

  // AI-powered transcript summary command
  context.subscriptions.push(vscode.commands.registerCommand('transcript.summarize', summarizeTranscript))

  // AI-powered attachment summary command
  context.subscriptions.push(vscode.commands.registerCommand('attachment.summarize', summarizeAttachment))

  // AI-powered summarize ALL attachments command
  context.subscriptions.push(vscode.commands.registerCommand('attachment.summarizeAll', summarizeAllAttachments))

  // Insert lifts from Strong CSV
  context.subscriptions.push(vscode.commands.registerCommand('lifts.insert', insertLifts))

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', new CurrentDirCompletionProvider(), '.', '/'),
  ) // <---- notice these trigger chracters

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', new DayCompletionProvider(), '/'),
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', new DecisionsCompletionProvider(), '/'),
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', new IdeasCompletionProvider(), '/'),
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', new PlacesCompletionProvider(), '/'),
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', new LibraryCompletionProvider(), '/'),
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', new ProjectsCompletionProvider(), '/'),
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', new TagsCompletionItemProvider(), '/'),
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', new PeopleCompletionItemProvider()),
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', new OrganizationsCompletionItemProvider()),
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', new DayItemCompletionProvider(), ','),
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', new AttachmentsCompletionItemProvider(), ' '),
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', new RecurringPatternCompletionProvider(), ' '),
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('markdown', new TimezoneCompletionItemProvider(), '/'),
  )

  // Open a folder in the OS file manager (Finder/Explorer) — used by DocumentLink command URIs
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_OPEN_FOLDER, (folderPath: string) => {
      vscode.env.openExternal(vscode.Uri.file(folderPath))
    }),
  )

  // Cmd+Click on `attachments:` key to open the day's attachment folder
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider('markdown', new AttachmentsFieldDocumentLinkProvider()),
  )

  // Cmd+Click on rel: values in YAML frontmatter
  context.subscriptions.push(vscode.languages.registerDocumentLinkProvider('markdown', new RelDocumentLinkProvider()))

  // Cmd+Click on person names in who/to/from/cc/bcc frontmatter fields
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider('markdown', new PersonFieldDocumentLinkProvider()),
  )

  const didSaveTextDocDisposable = vscode.workspace.onDidSaveTextDocument((doc) => {
    console.log('saved')
    console.log(doc.uri)
    console.log(doc.fileName)
  })

  context.subscriptions.push(didSaveTextDocDisposable)

  activateCBHandler(context)
  activateDroppedHandler(context)
  activateReminderHandler(context)
  activateTodoHandler(context)
  activatePatternHighlighter(context)
  activateNotebookTime(context)
  activateCompleteTimeInsert(context)
  activateYamlValidator(context)
}

export function deactivate() {
  deactivateCBHandler()
  deactivateDroppedHandler()
  deactivateReminderHandler()
  deactivateTodoHandler()
  deactivatePatternHighlighter()
  deactivateNotebookTime()
  deactivateCompleteTimeInsert()
  deactivateYamlValidator()
}
