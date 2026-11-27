/** Sky speaks through GPT-Live; Sol owns reasoning and the existing service tools. */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'
import { type DayItemList, listDayItems } from '#commands/all/day/items/lib/items.ts'
import { checkDayMeetings, renderMeetingCheck } from '#commands/all/day/meeting/lib/meetingCheck.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import { loadVoiceSources, renderVoiceSnapshot } from '#commands/lib/voice/initialContext.ts'
import {
  betterCheck,
  type PageClock,
  renderToday,
  renderVoicePage,
  type TodayParts,
  todayUpdates,
} from '#commands/lib/voice/page.ts'
import {
  AUDITION_PASSAGE,
  auditionSessionConfig,
  DEFAULT_VOICE_MODEL,
  preferredVoice,
  renderVoicePrompts,
  type Voice,
  VOICE_GROUPS,
  VOICES,
  type VoiceClock,
  voiceSessionConfig,
} from '#commands/lib/voice/sessionConfig.ts'
import { openaiKey } from '#shared/ai/llm/openaiProvider.ts'
import type * as ConfigModule from '#shared/config.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import dayFile from '#shared/nbfs/dayFile.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import { renderTemplate } from '#shared/prompts/mod.ts'
import { voiceChatTools } from './chatTools.ts'
import { liveBackend } from './liveBackend.ts'
import type { AuditionHost, LiveSessionConnector, VoiceRoutesOptions, VoiceThreadFactory } from './mod.ts'
import { APPROVAL_TOOLS } from './mod.ts'
import { notebookSearchTool, SEARCH_NOTEBOOK_TOOL } from './notebookSearch.ts'

function clockOf(context: CommandContext): VoiceClock {
  return {
    notebookDate: context.notebookNow.date,
    notebookTime: context.notebookNow.time,
    notebookTimezone: context.notebookNow.timezone,
    systemDate: context.systemNow.date,
    systemTime: context.systemNow.time,
    systemTimezone: context.systemNow.timezone,
  }
}

/** A day file's lists as the page reads them; unknown when the file cannot be parsed. */
function listsOf(text: string): DayItemList[] | undefined {
  try {
    return listDayItems(DayDocument.fromMarkdown(text))
  } catch {
    return undefined
  }
}

/** The day file's lists now: none when the day has no file yet, unknown when it cannot be read. */
async function readLists(file: string): Promise<DayItemList[] | undefined> {
  try {
    return listsOf(await readTextFile(file))
  } catch (error) {
    return (error as { code?: string }).code === 'ENOENT' ? [] : undefined
  }
}

export function createVoiceHost(config: typeof ConfigModule, env: Record<string, string>): VoiceRoutesOptions {
  const createThread: VoiceThreadFactory = async (_id, signal = new AbortController().signal, chat) => {
    if (!chat) throw new Error('Start voice from a chat so its tools and results stay with the conversation.')
    const context = CommandContext.server(config, env).fork({ signal })
    const clock = clockOf(context)
    const today = context.notebookNow.plainDateTime.plainDate
    // The page's "today" is kept current from the day file: stamped before it is read, so a save made
    // while the call sets up shows up at the first refresh.
    const dayPath = path.join(config.DIR_TIME, dayFile(today))
    const mtimeOf = () =>
      stat(dayPath).then(
        (info) => info.mtimeMs,
        () => 0,
      )
    let dayStamp = await mtimeOf()
    const [check, initial, sources] = await Promise.all([
      checkDayMeetings(context.secrets, today, config.DIR_TIME),
      voiceChatTools(chat, [], signal),
      loadVoiceSources(config, clock),
    ])
    signal.throwIfAborted()
    const pageClock: PageClock = {
      date: clock.notebookDate,
      time: clock.notebookTime,
      timezone: clock.notebookTimezone,
      systemDate: clock.systemDate,
      systemTime: clock.systemTime,
      systemTimezone: clock.systemTimezone,
    }
    // No day file, or an empty one, has nothing open; one that could not be read is unknown.
    const dayUnreadable = sources.unavailable.includes(`Unreadable source: ${path.relative(config.DIR_BASE, dayPath)}`)
    const lists = sources.day ? listsOf(sources.day.body) : dayUnreadable ? undefined : []
    const page = renderVoicePage({
      clock: pageClock,
      profileText: sources.profile?.body,
      goals: sources.goals,
      decisions: sources.entities.decisionsRead ? sources.entities.decisions : undefined,
      people: sources.entities.people,
      check,
      lists,
      memories: sources.memories,
    })
    const prompts = await renderVoicePrompts({
      ...clock,
      calendar: renderMeetingCheck(check, { date: clock.notebookDate, time: clock.notebookTime }),
      notebookContext: renderVoiceSnapshot(sources, config, clock),
      page,
    })
    // Voice's own search, since a spoken turn skips the retrieval a typed message runs first. The spoken
    // approval tools (APPROVAL_TOOLS, below) are voice's own too.
    const voiceOnly = new Map([
      [SEARCH_NOTEBOOK_TOOL, notebookSearchTool({ port: config.PORT_SERVER, notebookDir: config.DIR_BASE })],
    ])
    const tools = new Map([...initial.tools, ...voiceOnly])
    const delegations = new Map<string, ReturnType<typeof voiceChatTools>>()
    const gated = [...tools.values()].some((tool) => tool.needsApproval)

    // What the speaking model was last told about today, and what the day file and calendar say now.
    let currentLists = lists
    let currentCheck = check
    let told: TodayParts = renderToday({ check, lists, clock: pageClock })
    const refreshOnce = async (tool: string | undefined, deliver: (notes: string[]) => Promise<void>) => {
      const stamp = await mtimeOf()
      if (stamp !== dayStamp) {
        // A read that fails keeps the lists the call has, and the next refresh tries again.
        const read = await readLists(dayPath)
        if (read !== undefined) {
          currentLists = read
          dayStamp = stamp
        }
      }
      // A re-read less complete than the one the call has (an account failing, no answer) keeps the earlier one.
      if (tool?.startsWith('calendar_'))
        currentCheck = betterCheck(currentCheck, await checkDayMeetings(context.secrets, today, config.DIR_TIME))
      // The notebook clock as it is now; the call's day stays the page's day, even past midnight.
      let time = pageClock.time
      try {
        const now = fetchNowSync({ timeDir: config.DIR_TIME })
        if (now.date === pageClock.date) time = now.time
      } catch {
        // No started day to read a clock from: keep the call's.
      }
      const next = renderToday({ check: currentCheck, lists: currentLists, clock: { ...pageClock, time } })
      const notes = todayUpdates(told, next, time)
      // Told only once delivered: a note that fails goes again with the next refresh.
      if (notes.length) await deliver(notes)
      told = next
    }
    let refreshing: Promise<unknown> = Promise.resolve()

    return {
      session: voiceSessionConfig({
        voice: preferredVoice(),
        instructions: prompts.instructions,
        backendInstructions: [initial.instructions, prompts.askPrompt].join('\n\n'),
        tools: [...tools.values()].map((tool) => tool.definition).concat(gated ? APPROVAL_TOOLS : []),
      }),
      greeting: prompts.greeting,
      tools,
      toolsFor: async (id, turns) => {
        let built = delegations.get(id)
        if (!built) {
          built = voiceChatTools(chat, turns, signal)
          delegations.set(id, built)
          if (delegations.size > 32) delegations.delete(delegations.keys().next().value!)
        }
        return new Map([...(await built).tools, ...voiceOnly])
      },
      // One refresh at a time, delivery included, so two never compare against the same last-told version
      // and one's notes never land between another's.
      refresh: ({ tool }, deliver) => {
        const run = refreshing.then(() => refreshOnce(tool, deliver))
        refreshing = run.catch(() => {})
        return run
      },
    }
  }

  const connect: LiveSessionConnector = async (session, sdp, signal) => {
    const client = new OpenAI({ apiKey: await openaiKey(), timeout: 30_000, maxRetries: 0 })
    const answer = await client.live.create({ session, transport: { type: 'webrtc', sdp } }, { signal })
    return {
      sessionId: answer.session.id,
      sdp: answer.transport.sdp,
      ...(session.delegation?.type === 'responses' ? { backend: liveBackend(client, answer.session.id) } : {}),
    }
  }

  const audition: AuditionHost = {
    describe: () =>
      Promise.resolve({
        passage: renderTemplate(AUDITION_PASSAGE).output,
        groups: VOICE_GROUPS,
        current: preferredVoice(),
        model: DEFAULT_VOICE_MODEL,
      }),
    prepare: async (voice, passage) => {
      if (!(VOICES as readonly string[]).includes(voice)) return null
      return {
        session: auditionSessionConfig(voice as Voice),
        opening: `The audio is ready. Immediately say this preview passage once, exactly, then remain silent: ${JSON.stringify(passage)}`,
      }
    },
  }
  return { createThread, connect, audition }
}
