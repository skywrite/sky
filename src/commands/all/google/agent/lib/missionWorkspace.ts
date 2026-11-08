import { jsonSchema } from 'ai'
import type { ModelMessage } from 'ai'
import { slideDesignPromptSection } from '#lib/google/design.ts'
import type { WorkspaceKind } from '#lib/google/drive.ts'
import { cachedInstructions, cacheTailStep } from '#shared/ai/promptCache.ts'
import type { createAgentTools } from './tools.ts'

type AgentTools = ReturnType<typeof createAgentTools>

// Every new tool must declare its workspace so it cannot silently enter every payload.
const TOOL_WORKSPACES = {
  find_files: 'shared',
  read_file: 'shared',
  create_doc: 'doc',
  replace_doc_content: 'doc',
  batch_update_doc: 'doc',
  inspect_doc_visually: 'doc',
  create_presentation: 'slides',
  get_presentation_outline: 'slides',
  batch_update_slides: 'slides',
  inspect_slide_visually: 'slides',
  inspect_deck_visually: 'slides',
  upload_image: 'shared',
  render_svg: 'shared',
  copy_file: 'shared',
  rename_file: 'shared',
  share_file: 'shared',
  add_comment: 'shared',
  list_comments: 'shared',
  add_anchored_comment: 'shared',
  suggest_doc_edit: 'doc',
  list_doc_suggestions: 'doc',
  delete_comment: 'shared',
  reply_to_comment: 'shared',
  create_spreadsheet: 'sheet',
  set_values: 'sheet',
  get_values: 'sheet',
  batch_update_spreadsheet: 'sheet',
  get_spreadsheet_outline: 'sheet',
  restyle_doc: 'doc',
  get_doc_outline: 'doc',
} satisfies Record<keyof AgentTools, WorkspaceKind | 'shared'>

// Every tool also declares whether it only reads, so a new one cannot slip into a read-only mission.
const TOOL_ONLY_READS = {
  find_files: true,
  read_file: true,
  create_doc: false,
  replace_doc_content: false,
  batch_update_doc: false,
  inspect_doc_visually: true,
  create_presentation: false,
  get_presentation_outline: true,
  batch_update_slides: false,
  inspect_slide_visually: true,
  inspect_deck_visually: true,
  upload_image: false,
  render_svg: false,
  copy_file: false,
  rename_file: false,
  share_file: false,
  add_comment: false,
  list_comments: true,
  add_anchored_comment: false,
  suggest_doc_edit: false,
  list_doc_suggestions: true,
  delete_comment: false,
  reply_to_comment: false,
  create_spreadsheet: false,
  set_values: false,
  get_values: true,
  batch_update_spreadsheet: false,
  get_spreadsheet_outline: true,
  restyle_doc: false,
  get_doc_outline: true,
} satisfies Record<keyof AgentTools, boolean>

const READ_ONLY_NOTE =
  '# This mission only reads\n\nTools that create, change, comment on, share or delete files are not available. Read what the mission asks for and report it in your final answer.'

const WORKSPACES: WorkspaceKind[] = ['doc', 'slides', 'sheet']
const WORKSPACE_NAMES: Record<WorkspaceKind, string> = { doc: 'Docs', slides: 'Slides', sheet: 'Sheets' }
const FORMAT_WORDS: Record<WorkspaceKind, RegExp> = {
  doc: /\b(?:docs?|documents?|docx)\b/i,
  slides: /\b(?:slides?|presentations?|decks?|pptx|powerpoint)\b/i,
  sheet: /\b(?:sheets?|spreadsheets?|workbooks?|xlsx|csv)\b/i,
}

/** Infer the opening request, not format names mentioned inside the supplied brief. */
export function missionWorkspaces(mission: string, targetKind?: WorkspaceKind): WorkspaceKind[] {
  let request = mission
    .trim()
    .split(/\r?\n|[.!?](?:\s|$)|\b(?:content|brief|body|data|source text)\s*:/i)[0]!
    .slice(0, 500)
  const conversion = /\b(?:turn|convert|transform|distill|expand)\b.*?\b(?:into|to)\b(.*)/i.exec(request)
  if (conversion) request = conversion[1]!
  else {
    const action = /\b(?:create|build|write|make|draft|prepare|design|generate|update|edit|review)\b/i.exec(request)
    if (action) request = request.slice(action.index)
  }
  request = request.split(
    /\b(?:about|covering|explaining|titled|named|called|for|from|using|without|based on)\b|,\s*not\b/i,
  )[0]!
  const formats = WORKSPACES.filter((kind) => FORMAT_WORDS[kind].test(request))
  // A named output can differ from the target's format. Shared reads suffice
  // for its source; additional editing tools can be loaded when actually needed.
  return formats.length ? formats : targetKind ? [targetKind] : []
}

export async function createMissionWorkspace(deps: {
  tools: AgentTools
  initial: WorkspaceKind[]
  commonPrompt: string
  loadPrompt: (kind: WorkspaceKind) => Promise<string>
  log: (line: string) => void
  /** Offer only the tools that read: the mission changes nothing */
  readOnly?: boolean
}) {
  // A read-only mission is never offered a tool that changes a file, and one it names anyway refuses.
  const offered = (name: keyof AgentTools) => !deps.readOnly || TOOL_ONLY_READS[name]
  const loaded = new Map<WorkspaceKind, string>()
  const enable = async (formats: WorkspaceKind[]) => {
    const added = [...new Set(formats)].filter((kind) => !loaded.has(kind))
    // Load all requested prompts before changing the toolset; a failed read leaves it intact.
    const prompts = await Promise.all(added.map((kind) => deps.loadPrompt(kind)))
    for (const [index, kind] of added.entries()) {
      loaded.set(kind, kind === 'slides' ? `${prompts[index]}\n\n${slideDesignPromptSection()}` : prompts[index]!)
    }
    return added
  }
  await enable(deps.initial)

  const workspaceTools = Object.fromEntries(
    Object.entries(deps.tools).map(([name, tool]) => [name, { ...tool }]),
  ) as AgentTools
  for (const [name, tool] of Object.entries(workspaceTools)) {
    if (!offered(name as keyof AgentTools)) {
      tool.execute = (async () =>
        `Error: this mission only reads; ${name} changes files and is not available.`) as typeof tool.execute
      continue
    }
    const kind = TOOL_WORKSPACES[name as keyof AgentTools]
    if (kind === 'shared') continue
    const execute = tool.execute as (...args: unknown[]) => Promise<unknown>
    tool.execute = (async (...args: unknown[]) => {
      if (!loaded.has(kind))
        return `Error: ${WORKSPACE_NAMES[kind]} tools are not enabled. If this mission requires them, call load_workspace_tools with formats: ["${kind}"] first.`
      return execute(...args)
    }) as typeof tool.execute
  }
  const tools = {
    ...workspaceTools,
    load_workspace_tools: {
      description:
        'Load Docs, Slides, or Sheets editing tools and instructions when the mission requires a format that is not enabled. Takes effect on the next step. Shared Drive reads work across formats already. Load only formats needed for the actual mission, never just in case. Native charts in Slides require Sheets; ordinary text, numbers, tables, and diagrams do not.',
      inputSchema: jsonSchema<{ formats: WorkspaceKind[] }>({
        type: 'object',
        properties: {
          formats: { type: 'array', items: { type: 'string', enum: WORKSPACES }, minItems: 1, uniqueItems: true },
        },
        required: ['formats'],
      }),
      execute: async ({ formats }: { formats: WorkspaceKind[] }) => {
        if (!Array.isArray(formats) || !formats.length || formats.some((kind) => !WORKSPACES.includes(kind)))
          return 'Error: formats must be a nonempty list of doc, slides, or sheet.'
        try {
          const added = await enable(formats)
          if (added.length) deps.log(`Loaded ${added.map((kind) => WORKSPACE_NAMES[kind]).join(' and ')} tools`)
          return { enabled: [...loaded.keys()], added }
        } catch (err) {
          return `Error: workspace tools could not be loaded: ${(err as Error).message}. No new formats were enabled.`
        }
      },
    },
  }
  const activeTools = (): Array<keyof typeof tools> => [
    ...(Object.keys(deps.tools) as Array<keyof AgentTools>).filter((name) => {
      if (!offered(name)) return false
      const kind = TOOL_WORKSPACES[name]
      return kind === 'shared' || loaded.has(kind)
    }),
    'load_workspace_tools',
  ]
  const instructions = () => {
    const messages = cachedInstructions([
      deps.commonPrompt,
      ...loaded.values(),
      `# Enabled Workspace formats\n\n${loaded.size ? [...loaded.keys()].map((kind) => WORKSPACE_NAMES[kind]).join(', ') : 'Shared Drive tools only'}. If this mission needs another format, call load_workspace_tools before using its editing tools.${deps.readOnly ? `\n\n${READ_ONLY_NOTE}` : ''}`,
    ])
    // Anthropic permits four breakpoints total. Cache the common prefix and
    // assembled instructions, leaving room for the moving history breakpoint.
    return messages.map((message, index) =>
      index === 0 || index === messages.length - 1 ? message : { role: 'system' as const, content: message.content },
    )
  }

  return {
    tools,
    get formats() {
      return [...loaded.keys()]
    },
    activeTools,
    instructions,
    prepareStep: (step: { messages: ModelMessage[] }) => ({
      ...cacheTailStep(step),
      activeTools: activeTools(),
      instructions: instructions(),
    }),
  }
}
