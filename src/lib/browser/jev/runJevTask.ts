import { appendFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { instantNow } from '#universal/dates/nbdt/mod.ts'
import { attachBrowserDriver, closeTab, firstUrl } from '../mcp/browserDriver.ts'
import { type McpClient, McpError } from '../mcp/client.ts'
import { claimDownloads, type DownloadClaim, splitResult, type ToolCaller } from '../mcp/tools.ts'
import { launchPrivateBrowser } from '../signIn/launch.ts'
import { readSignInResult, signInProblem } from '../signIn/outcome.ts'
import { withNativeSignIn } from '../task/host.ts'
import { type Advice, type AdviceTrigger, advise, type AdviseOptions, type AdviseResult } from './advisor.ts'
import { type AskJev, decide, type Decision, JevAnswerError, nextBest } from './decide.ts'
import type { Operation } from './questions.ts'
import { type ActionRow, type ActionTable, buildActionTable, describeRow, fingerprint } from './table.ts'
import { type FieldTextOptions, type FieldTextResult, fieldText } from './typeText.ts'

// The Jev driver: code owns the loop, Jev picks each move. Look at the page
// as a table, ask Jev once, check the answer, make the move, look again.
// A language model, the adviser, reads at the moments Jev cannot: a page
// seen for the first time, a move that failed, a page that stops changing,
// Jev wanting the person. The person is asked when the page needs them;
// the loop stops when Jev says the goal is visibly done, when nothing
// helps, or when the page stops changing.

export const MAX_STEPS = 60
/** Identical pages in a row, without a wait between them, before the loop gives up. */
export const UNCHANGED_LIMIT = 3
export const DONE_GATE = 0.85
export const PERSON_GATE = 0.85
export const RISKY_GATE = 0.5
/** Below this target confidence, look again once before acting. */
export const LOW_CONFIDENCE = 0.25
/** After the person answers a page that then looks unchanged: how long to wait before each further look. */
export const ANSWERED_LOOK_WAITS = [3, 5]
/** Adviser calls per task, so a confused page cannot burn a budget. */
export const MAX_ADVICE = 20
const SCROLL_PX = 560

export type JevOutcome = 'done' | 'blocked' | 'stopped' | 'out_of_steps'

export interface JevStep {
  step: number
  operation: Operation
  target?: string
  text?: string
  option?: string
  probability: number
  confidence: number
  ms: number
  pageChanged?: boolean
  note?: string
}

export interface JevUsage {
  jevRequests: number
  jevInputTokens: number
  jevMs: number
  typingCalls: number
  typingInput: number
  typingOutput: number
  adviserCalls: number
  adviserInput: number
  adviserOutput: number
  adviserMs: number
}

export interface JevTaskResult {
  report: string
  outcome: JevOutcome
  reason?: string
  files: string[]
  downloads: string[]
  steps: JevStep[]
  /** What happened, one line each, as the models saw it */
  history: string[]
  usage: JevUsage
  server?: string
}

/** The browser, as the loop drives it — the real server, or a scripted one in tests. */
export type BrowserSession = ToolCaller & { close(): Promise<void>; serverInfo?: McpClient['serverInfo'] }

export interface JevTaskOptions {
  objective: string
  /** Where to start; otherwise the first address in the objective */
  startUrl?: string
  ask: AskJev
  /** Writes text fields; without one, typing operations are refused */
  typingModel?: ResolvedModel
  /** Test seam over fieldText */
  typeText?: (options: FieldTextOptions) => Promise<FieldTextResult>
  /** Reads pages and failures for Jev; without one, Jev is on its own */
  adviserModel?: ResolvedModel
  /** Test seam over advise */
  advise?: (options: AdviseOptions) => Promise<AdviseResult>
  taskDir: string
  filesDir: string
  onNeedsYou: (message: string) => Promise<boolean>
  onStep?: (line: string) => void
  maxSteps?: number
  abortSignal?: AbortSignal
  headless?: boolean
  /** Where Sky's browser lives; the default is ~/.sky/browser */
  browserRoot?: string
  privateSignIn?: boolean
  /** Test seam over the browser driver: a scripted session in place of the real one */
  browser?: BrowserSession
  /** Test seam over attaching to the driver, for the restart after a crash */
  launch?: () => Promise<BrowserSession>
}

/** The first web address in the objective, if it names one. */
export const startUrlOf = firstUrl

/** A short line for the person: what Jev chose and how sure it was. */
function stepLine(decision: Decision, text?: string): string {
  const sure = `${Math.round((decision.targetProbability ?? decision.probability) * 100)}%, ${decision.ms} ms`
  const target = decision.target ? ` ${describeRow(decision.target)}` : ''
  switch (decision.operation) {
    case 'type':
      return `Jev: type ${text === undefined ? '' : JSON.stringify(text)} into${target} (${sure})`
    case 'select':
      return `Jev: choose "${decision.option}" in${target} (${sure})`
    case 'click':
      return `Jev: click${target} (${sure})`
    default:
      return `Jev: ${decision.operation.replace('_', ' ')} (${sure})`
  }
}

/** Plain words for the person when the page needs them. */
function needsYouMessage(table: ActionTable, decision: Decision): string {
  const page = table.title && table.title !== 'Sign-in needs you' ? `"${table.title}" (${table.url})` : table.url
  if (decision.risky >= RISKY_GATE && decision.target)
    return `Sky is about to use ${describeRow(decision.target)} on ${page}. That may move money, sign, send, or commit you. Continue to allow it, or stop.`
  return `The page ${page} needs you: sign in, enter any code, pass any check, or make the choice it asks for. Then continue.`
}

/** The server writes its own diagnostics beside the downloads; those are not the person's files. */
const SERVER_FILE = /^console-.*\.log$/

async function filesIn(dir: string): Promise<string[]> {
  return (await readdir(dir))
    .filter((name) => !SERVER_FILE.test(name))
    .sort()
    .map((name) => path.join(dir, name))
}

export async function runJevTask(options: JevTaskOptions): Promise<JevTaskResult> {
  const startUrl = options.startUrl ?? startUrlOf(options.objective)
  if (!startUrl) throw new Error('Say which site to open, with its full address (https://…).')
  const maxSteps = options.maxSteps ?? MAX_STEPS
  const typeText = options.typeText ?? fieldText
  const adviserModel = options.adviserModel
  const adviseWith = options.advise ?? advise
  const canAdvise = adviserModel !== undefined || options.advise !== undefined

  const traceFile = path.join(options.taskDir, 'trace.jsonl')
  let claim: DownloadClaim | undefined
  const launch = async (): Promise<BrowserSession> => {
    if (options.launch) return options.launch()
    if (options.privateSignIn)
      return launchPrivateBrowser(
        {
          objective: options.objective,
          filesDir: options.filesDir,
          headless: options.headless,
        },
        options.abortSignal,
      )
    const { client, driver } = await attachBrowserDriver({ headless: options.headless, root: options.browserRoot })
    claim = { from: driver.downloadsDir, to: options.filesDir }
    return client
  }
  let browser: BrowserSession = options.browser ?? (await launch())
  /** The server died mid-task: how many times it has been brought back. Once is a hiccup; twice is a wall. */
  let relaunches = 0
  const MAX_RELAUNCHES = 1
  let lastUrl: string | undefined

  const steps: JevStep[] = []
  const history: string[] = []
  const downloads: string[] = []
  let downloadIssue: string | undefined
  const usage: JevUsage = {
    jevRequests: 0,
    jevInputTokens: 0,
    jevMs: 0,
    typingCalls: 0,
    typingInput: 0,
    typingOutput: 0,
    adviserCalls: 0,
    adviserInput: 0,
    adviserOutput: 0,
    adviserMs: 0,
  }
  let outcome: JevOutcome = 'out_of_steps'
  let reason: string | undefined
  const expectsDownload = /\bdownload/i.test(options.objective)
  /** The control whose click last produced a download — by what it is, since refs change with every snapshot */
  let downloadedFrom: string | undefined
  const attemptedSignIn = new Set<string>()
  const rowKey = (row: ActionRow): string => {
    // A link's own address tells rows apart only when it is a real one of its own;
    // four "Download Document" links sharing one script address are four rows.
    const own = row.href && /^https?:\/\//.test(row.href) && !row.href.endsWith('#') ? row.href : undefined
    return own ?? `${row.index}|${row.role}|${row.name}|${row.near ?? ''}`
  }

  // The trace survives a killed run: one line per thing that happened.
  const trace = (record: Record<string, unknown>) =>
    appendFile(traceFile, `${JSON.stringify({ at: instantNow(), ...record })}\n`).catch(() => undefined)
  const remember = (line: string) => {
    history.push(line)
    void trace({ kind: 'history', line })
  }

  const stopped = (error: unknown): boolean => error instanceof McpError && /stopped|did not answer/.test(error.message)
  const call = async (name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> => {
    let result
    try {
      result = splitResult(await browser.callTool(name, args, { signal: options.abortSignal }))
    } catch (error) {
      // The server died under this call. The profile keeps the session, so a
      // fresh server back on the same page can go on; the call itself is a
      // failed move for the record.
      if (
        options.privateSignIn ||
        !stopped(error) ||
        (options.browser && !options.launch) ||
        relaunches >= MAX_RELAUNCHES
      )
        throw error
      relaunches++
      remember(`The browser server stopped during ${name}; started it again${lastUrl ? ` at ${lastUrl}` : ''}.`)
      say(`The browser server stopped; starting it again${lastUrl ? ` at ${lastUrl}` : ''}`)
      void trace({ kind: 'relaunch', during: name, url: lastUrl })
      browser = await launch()
      if (lastUrl) await browser.callTool('browser_navigate', { url: lastUrl }, { signal: options.abortSignal })
      return { ok: false, text: `The browser server stopped during ${name} and was started again.` }
    }
    const url = result.output.text.match(/^- Page URL: (\S+)/m)?.[1]
    if (url && !url.startsWith('chrome-error://') && url !== 'about:blank') {
      lastUrl = url
      if (!visited.includes(url)) visited.push(url)
    }
    // A download goes straight from the driver's shared folder into this task's own.
    if (claim) result.output.text = (await claimDownloads(result.output.text, claim)).text
    for (const match of result.output.text.matchAll(/Downloaded file (.+?) to "/g)) {
      downloads.push(match[1])
      remember(`Downloaded file ${match[1]}`)
    }
    for (const line of result.output.text.split('\n')) {
      if (!line.startsWith('Browser download notice: ')) continue
      const notice = line.slice('Browser download notice: '.length)
      downloadIssue = notice
      remember(notice)
      say(notice)
    }
    return result.output
  }
  const say = (line: string) => options.onStep?.(line)

  // A model may think while a SPA replaces its controls or completes a delayed
  // navigation. Never send an input using references from that older page.
  const current = async (table: ActionTable): Promise<boolean> => {
    const fresh = await call('browser_snapshot', { boxes: true })
    if (fresh.ok && fingerprint(buildActionTable(fresh.text)) === fingerprint(table)) return true
    remember('The page changed while choosing an action. Taking a fresh look before acting.')
    say('The page changed — checking it again before acting')
    return false
  }

  const isBlank = (table: ActionTable): boolean =>
    table.url === 'about:blank' || table.url === '' || (table.rows.length === 0 && table.text.trim() === '')

  /** Select the tab showing this address, if any; the driver lists tabs as `- 0: (current) [title](url)`. */
  const selectTab = async (url: string): Promise<boolean> => {
    const listed = await call('browser_tabs', { action: 'list' })
    const wanted = url.replace(/\/$/, '')
    for (const line of listed.text.split('\n')) {
      const match = line.match(/^- (\d+): (?:\(current\) )?\[[^\]]*\]\((\S+)\)/)
      if (!match || match[2].replace(/\/$/, '') !== wanted) continue
      if (line.includes('(current)')) return true
      const selected = await call('browser_tabs', { action: 'select', index: Number(match[1]) })
      return selected.ok
    }
    return false
  }

  // What the adviser said about a page, by fingerprint, and which triggers it has answered.
  const advised = new Map<string, Set<AdviceTrigger>>()
  let plan: string | undefined
  let pageNeedsPerson: boolean | undefined
  /** Every address this task has been on, oldest first, no repeats */
  const visited: string[] = [startUrl]
  const askAdviser = async (
    trigger: AdviceTrigger,
    table: ActionTable,
    print: string,
    failure?: string,
  ): Promise<Advice | null> => {
    if (!canAdvise || usage.adviserCalls >= MAX_ADVICE) return null
    const seen = advised.get(print) ?? new Set<AdviceTrigger>()
    if (seen.has(trigger)) return null
    seen.add(trigger)
    advised.set(print, seen)
    const result = await adviseWith({
      model: adviserModel as ResolvedModel,
      goal: options.objective,
      table,
      history,
      trigger,
      failure,
      known: visited,
    })
    usage.adviserCalls++
    usage.adviserInput += result.usage.input
    usage.adviserOutput += result.usage.output
    usage.adviserMs += result.ms
    const { advice } = result
    void trace({ kind: 'advice', trigger, ...advice, ms: result.ms, raw: result.raw?.slice(0, 600) })
    if (advice.failed) {
      say(`Adviser: ${advice.reason}`)
      return null // no reading happened: Jev's own judgment stands
    }
    if (advice.subgoal) {
      plan = advice.subgoal
      remember(`Plan: ${advice.subgoal}`)
    }
    if (trigger === 'new_page' || trigger === 'jev_asks') pageNeedsPerson = advice.needsPerson
    say(
      `Adviser (${result.ms} ms): ${advice.subgoal || advice.reason}${advice.action ? ` — move: ${describeAction(advice.action, table)}` : ''}`,
    )
    return advice
  }

  const describeAction = (action: NonNullable<Advice['action']>, table: ActionTable): string => {
    switch (action.kind) {
      case 'click':
        return `click ${describeRow(table.rows[action.index])}`
      case 'navigate':
        return `open ${action.url}`
      case 'press':
        return `press ${action.key}`
      default:
        return action.kind.replace('_', ' ')
    }
  }

  /** The adviser's move, run as a step of its own. */
  const runAdvice = async (
    action: NonNullable<Advice['action']>,
    table: ActionTable,
    step: number,
    why: string,
  ): Promise<{ ok: boolean; text: string }> => {
    const what = describeAction(action, table)
    let result: { ok: boolean; text: string }
    let operation: Operation = 'wait'
    switch (action.kind) {
      case 'click': {
        const row = table.rows[action.index]
        if (!(await current(table))) return { ok: false, text: 'The page changed before the click. No input was sent.' }
        operation = 'click'
        const before = downloads.length
        result = await call('browser_click', { element: row.name || row.role, target: row.ref })
        if (downloads.length > before) downloadedFrom = rowKey(row)
        break
      }
      case 'navigate':
        operation = 'click'
        result = await call('browser_navigate', { url: action.url })
        break
      case 'press':
        operation = 'wait'
        result = await call('browser_press_key', { key: action.key })
        break
      case 'scroll_down':
        operation = 'scroll_down'
        result = await call('browser_mouse_wheel', { deltaX: 0, deltaY: SCROLL_PX })
        break
      default:
        result = await call('browser_wait_for', { time: 1 })
    }
    steps.push({ step, operation, target: what, probability: 1, confidence: 1, ms: 0, note: `Adviser: ${why}` })
    remember(
      result.ok
        ? `Step ${step}: adviser ${what}`
        : `Step ${step}: adviser ${what} — failed: ${result.text.slice(0, 200)}`,
    )
    void trace({ kind: 'step', step, adviser: true, what, ok: result.ok })
    return result
  }

  try {
    say(`Opening ${startUrl}`)
    const opened = await call('browser_navigate', { url: startUrl })
    remember(opened.ok ? `Opened ${startUrl}` : `Could not open ${startUrl}: ${opened.text.slice(0, 200)}`)

    let lastPrint: string | undefined
    let unchanged = 0
    let doneRefused = 0
    let lookedAgain = false
    let badAnswers = 0
    // The page the person last answered, and how often it has been given another look since.
    let answeredPrint: string | undefined
    let answeredLooks = 0
    let allowedRef: string | undefined
    let lastMoveFailed: string | undefined
    let downloadsSeen = 0

    for (let step = 1; step <= maxSteps; step++) {
      if (options.abortSignal?.aborted) {
        outcome = 'stopped'
        reason = 'The task was stopped.'
        break
      }
      let snapshot = await call('browser_snapshot', { boxes: true })
      if (downloadIssue) {
        outcome = 'blocked'
        reason = downloadIssue
        break
      }
      let table = buildActionTable(snapshot.text)
      // A blank view after a move means the task's tab is gone or another
      // tab is in front: a download popup that closed, most often. Find the
      // task's tab again, or bring its last page back in whatever tab is up.
      if (isBlank(table) && lastUrl && steps.length > 0) {
        const found = await selectTab(lastUrl)
        if (!found) await call('browser_navigate', { url: lastUrl })
        remember(
          `The view went blank after the last move; ${found ? 'went back to the task’s tab' : `opened ${lastUrl} again`}.`,
        )
        say(found ? 'The tab went blank — back to the task’s tab' : `The tab went blank — back to ${lastUrl}`)
        snapshot = await call('browser_snapshot', { boxes: true })
        table = buildActionTable(snapshot.text)
      }
      const print = fingerprint(table)
      void trace({ kind: 'page', step, url: table.url, title: table.title, controls: table.rows.length })
      // A download is progress even when the page looks the same: a page
      // with several forms is downloaded from several times over.
      const progressed = downloads.length > downloadsSeen
      downloadsSeen = downloads.length
      const changed = print !== lastPrint || progressed
      if (steps.length > 0) steps[steps.length - 1].pageChanged = changed
      unchanged = changed ? 0 : unchanged + 1
      lastPrint = print
      if (changed) pageNeedsPerson = undefined
      if (unchanged >= UNCHANGED_LIMIT) {
        outcome = 'blocked'
        reason = `The page did not change after ${UNCHANGED_LIMIT} moves in a row.`
        break
      }

      // The adviser reads first: a new page, a failed move, a page that did not move.
      const trigger: AdviceTrigger | null = lastMoveFailed
        ? 'move_failed'
        : !advised.has(print)
          ? 'new_page'
          : unchanged >= 1
            ? 'no_change'
            : null
      const failure = lastMoveFailed
      lastMoveFailed = undefined
      if (trigger) {
        const advice = await askAdviser(trigger, table, print, failure)
        // A control that just produced a download is not clicked again on the adviser's say-so.
        if (
          advice?.action?.kind === 'click' &&
          downloadedFrom !== undefined &&
          rowKey(table.rows[advice.action.index]) === downloadedFrom
        ) {
          remember(
            `The adviser wanted ${describeRow(table.rows[advice.action.index])} again; it already produced a download.`,
          )
          say('Adviser: wanted the same download again — skipped')
        } else if (advice?.action) {
          const moved = await runAdvice(advice.action, table, step, advice.reason)

          if (!moved.ok) lastMoveFailed = moved.text.slice(0, 400)
          continue
        }
      }

      let decision: Decision
      try {
        decision = await decide({ goal: options.objective, table, history, ask: options.ask, plan })
      } catch (error) {
        if (!(error instanceof JevAnswerError) || ++badAnswers > 1) throw error
        remember(`Jev's answer could not be used: ${error.message}`)
        say(`Jev: ${error.message} Looking again.`)
        continue
      }
      usage.jevRequests++
      usage.jevInputTokens += decision.inputTokens
      usage.jevMs += decision.ms
      const entry: JevStep = {
        step,
        operation: decision.operation,
        probability: decision.probability,
        confidence: decision.confidence,
        ms: decision.ms,
        ...(decision.target ? { target: describeRow(decision.target) } : {}),
        ...(decision.option ? { option: decision.option } : {}),
        ...(decision.note ? { note: decision.note } : {}),
      }
      steps.push(entry)
      void trace({
        kind: 'step',
        ...entry,
        needsPerson: decision.needsPerson,
        done: decision.done,
        risky: decision.risky,
      })

      // Jev wants the person. The adviser, or the person's own earlier answer, may overrule it.
      let asks = decision.operation === 'ask_person' || decision.needsPerson >= PERSON_GATE
      let risky =
        decision.risky >= RISKY_GATE &&
        (decision.operation === 'click' || decision.operation === 'select') &&
        decision.target?.ref !== allowedRef
      if (asks && pageNeedsPerson === undefined && canAdvise) {
        const advice = await askAdviser('jev_asks', table, print)
        if (advice?.action) {
          const moved = await runAdvice(advice.action, table, step, advice.reason)

          if (!moved.ok) lastMoveFailed = moved.text.slice(0, 400)
          continue
        }
      }
      const overruled = asks && (pageNeedsPerson === false || print === answeredPrint)
      if (overruled) {
        if (print === answeredPrint && answeredLooks < ANSWERED_LOOK_WAITS.length) {
          // The person answered this very page. Look again, slowly, before overruling Jev.
          const wait = ANSWERED_LOOK_WAITS[answeredLooks++]
          entry.note = 'Jev asked again on the page the person answered; looked once more.'
          say(`Jev: still wants you, but you answered this page — looking again in ${wait} s`)
          await call('browser_wait_for', { time: wait })
          unchanged = 0 // a deliberate wait, like the wait operation, is not a move that changed nothing
          continue
        }
        const alternative = nextBest(decision, table, new Set(['ask_person', 'blocked']))
        if (!alternative) {
          outcome = 'blocked'
          reason =
            pageNeedsPerson === false
              ? 'The adviser says the page does not need you, but Jev saw no other move.'
              : 'You said you were done, but the page did not change and Jev saw no other move.'
          say(`Jev: blocked — ${reason}`)
          break
        }
        decision = alternative
        entry.operation = decision.operation
        entry.probability = decision.probability
        entry.target = decision.target ? describeRow(decision.target) : undefined
        entry.option = decision.option
        entry.note = decision.note
        say(
          pageNeedsPerson === false
            ? 'Jev: wanted you, but the adviser says this page does not need you — the next-best move runs'
            : 'Jev: you answered this page already, so the next-best move runs',
        )
        asks = false
        risky = decision.risky >= RISKY_GATE && (decision.operation === 'click' || decision.operation === 'select')
      }

      // The gates, in code, before any move.
      if (decision.operation === 'done' || decision.done >= DONE_GATE) {
        if (expectsDownload && (await filesIn(options.filesDir)).length === 0) {
          if (doneRefused >= 1) {
            outcome = 'blocked'
            reason =
              'No downloaded file was collected into the task folder. Check the browser’s actual download location before retrying.'
            say(reason)
            break
          }
          doneRefused++
          entry.note = 'Done refused: the goal asks for a download and no file is in the task folder.'
          remember('Not done yet: no downloaded file is in the task folder; the browser may have saved it elsewhere.')
          say('Jev: done — but no file is in the task folder yet, so looking again')
          continue
        }
        outcome = 'done'
        reason = `Jev judged the goal done (${Math.round(decision.done * 100)}%).`
        say(`Jev: done (${Math.round(Math.max(decision.done, decision.probability) * 100)}%)`)
        break
      }
      if (decision.operation === 'blocked') {
        outcome = 'blocked'
        reason = decision.note ?? 'Jev found no move that makes progress.'
        say(`Jev: blocked — ${reason}`)
        break
      }
      if (asks || risky) {
        if (asks && !risky && options.privateSignIn && !attemptedSignIn.has(table.url)) {
          attemptedSignIn.add(table.url)
          say(`Signing in at ${table.url}; approve this run or unlock 1Password if prompted`)
          const login = splitResult(
            await withNativeSignIn(() =>
              browser.callTool('sign_in', {}, { signal: options.abortSignal, timeoutMs: 300000 }),
            ),
          )
          const signed = login.output.ok ? readSignInResult(login.output.text) : null
          void trace({
            kind: 'sign_in',
            status: signed?.status ?? 'invalid_result',
            operation: signed?.operation,
            reason: signed?.reason,
          })
          if (signed?.status === 'submitted' || signed?.status === 'navigated') {
            remember(
              signed.status === 'submitted'
                ? 'The private browser submitted the approved login. Checking whether sign-in completed.'
                : 'Opened the website’s sign-in link without using credentials. Check the new page and continue.',
            )
            lastPrint = undefined
            continue
          }
          // A failed lookup is not a manual sign-in handoff. Return its fixed,
          // non-secret reason to the parent instead of waiting forever for a page that cannot advance.
          if (!signed || signed.status !== 'needs_user' || signed.reason) {
            outcome = signed?.status === 'declined' ? 'stopped' : 'blocked'
            reason = signInProblem(signed, table.url)
            entry.note = reason
            remember(reason)
            say(reason)
            break
          }
        }
        const message = needsYouMessage(table, decision)
        entry.note = asks ? 'Asked the person.' : 'Asked before a risky move.'
        say(
          asks
            ? `Jev: needs you (${Math.round(decision.needsPerson * 100)}%)`
            : `Jev: asks first (risky ${Math.round(decision.risky * 100)}%)`,
        )
        const continued = await options.onNeedsYou(message)
        if (!continued) {
          outcome = 'stopped'
          reason = 'You stopped the task.'
          remember('Asked the person: they stopped.')
          break
        }
        remember(
          asks
            ? 'The person acted on this page and says they are done and signed in. Do not ask again unless the page changes.'
            : `The person allowed: ${decision.target ? describeRow(decision.target) : decision.operation}.`,
        )
        lastPrint = undefined // they may have changed the page
        if (asks) {
          answeredPrint = print
          answeredLooks = 0
          await call('browser_wait_for', { time: 1 }) // their last step may still be landing
          continue
        }
        allowedRef = decision.target?.ref
      }
      const target = decision.target
      if (target && (decision.targetConfidence ?? 1) < LOW_CONFIDENCE && !lookedAgain) {
        lookedAgain = true
        entry.note = 'Low confidence in the target; looked again.'
        say(`Jev: not sure which control (${Math.round((decision.targetConfidence ?? 0) * 100)}%), looking again`)
        await call('browser_wait_for', { time: 1 })
        continue
      }
      lookedAgain = false

      // The move.
      let text: string | undefined
      let result: { ok: boolean; text: string } = { ok: true, text: '' }
      switch (decision.operation) {
        case 'click': {
          if (!target) break
          if (!(await current(table))) continue
          const before = downloads.length
          result = await call('browser_click', { element: target.name || target.role, target: target.ref })
          if (downloads.length > before) downloadedFrom = rowKey(target)
          break
        }
        case 'type': {
          if (!target) break
          if (target.secret) {
            entry.note = 'A secret field is never typed by a model.'
            remember(`Typed nothing into ${describeRow(target)}: ${entry.note}`)
            say(`Jev: type into ${describeRow(target)} — ${entry.note}`)
            continue
          }
          if (!options.typingModel) {
            entry.note = 'No typing model; nothing typed.'
            remember(`Could not type into ${describeRow(target)}: no typing model.`)
            say('Jev: type — no typing model is set, so nothing was typed')
            continue
          }
          let written: FieldTextResult
          try {
            written = await typeText({
              model: options.typingModel,
              goal: options.objective,
              row: target,
              table,
              history,
            })
          } catch (error) {
            const why = error instanceof Error ? error.message : String(error)
            entry.note = `The typing model failed: ${why.slice(0, 160)}`
            remember(`Typed nothing into ${describeRow(target)}: the typing model failed.`)
            say(`Jev: type into ${describeRow(target)} — the typing model failed: ${why.slice(0, 120)}`)
            continue
          }
          usage.typingCalls++
          usage.typingInput += written.usage.input
          usage.typingOutput += written.usage.output
          if (written.text === null) {
            entry.note = 'The task does not say what goes here.'
            remember(`Typed nothing into ${describeRow(target)}: ${entry.note}`)
            say(`Jev: type into ${describeRow(target)} — ${entry.note}`)
            continue
          }
          text = written.text
          entry.text = text
          if (!(await current(table))) continue
          result = await call('browser_type', {
            element: target.name || target.role,
            target: target.ref,
            text,
            submit: false,
          })
          break
        }
        case 'select':
          if (!target || !decision.option) break
          if (!(await current(table))) continue
          result = await call('browser_select_option', {
            element: target.name || target.role,
            target: target.ref,
            values: [decision.option],
          })
          break
        case 'scroll_down':
          result = await call('browser_mouse_wheel', { deltaX: 0, deltaY: SCROLL_PX })
          break
        case 'scroll_up':
          result = await call('browser_mouse_wheel', { deltaX: 0, deltaY: -SCROLL_PX })
          break
        case 'wait':
          result = await call('browser_wait_for', { time: 1 })
          unchanged = 0 // a wait is allowed to leave the page as it was
          break
        case 'back':
          result = await call('browser_navigate_back', {})
          break
      }
      say(stepLine(decision, text))
      const what =
        decision.operation === 'type'
          ? `typed ${JSON.stringify(text)} into ${describeRow(target!)}`
          : decision.operation === 'select'
            ? `chose "${decision.option}" in ${describeRow(target!)}`
            : decision.operation === 'click'
              ? `clicked ${describeRow(target!)}`
              : decision.operation.replace('_', ' ')
      if (!result.ok) {
        entry.note = `The move failed: ${result.text.slice(0, 200)}`
        remember(`Step ${step}: ${what} — failed: ${result.text.slice(0, 200)}`)
        say(
          `  failed: ${result.text
            .split('\n')
            .filter((line) => line.trim() && !line.startsWith('#'))
            .slice(0, 2)
            .join(' ')
            .slice(0, 160)}`,
        )
        lastMoveFailed = result.text.slice(0, 400)
      } else remember(`Step ${step}: ${what}`)
    }
    if (outcome === 'out_of_steps') reason = `The task used all ${maxSteps} steps.`
  } finally {
    // The private worker releases the browser while retaining its profile and sign-ins.
    if (outcome === 'done' && !options.browser && !options.privateSignIn) await closeTab(browser as McpClient)
    await browser.close()
  }

  const files = await filesIn(options.filesDir)
  void trace({ kind: 'end', outcome, reason, files })
  return {
    report: report({ outcome, reason: reason ?? '', steps, history, files, downloads, usage }),
    outcome,
    reason,
    files,
    downloads,
    steps,
    history,
    usage,
    server: browser.serverInfo ? `${browser.serverInfo.name} ${browser.serverInfo.version}` : undefined,
  }
}

/** The closing words, written by code from the trace: no model writes them. */
function report(input: {
  outcome: JevOutcome
  reason: string
  steps: JevStep[]
  history: string[]
  files: string[]
  downloads: string[]
  usage: JevUsage
}): string {
  const { outcome, reason, steps, history, files, usage } = input
  const head =
    outcome === 'done'
      ? `Done. ${reason}`
      : outcome === 'blocked'
        ? `Could not finish. ${reason}`
        : outcome === 'stopped'
          ? `Stopped. ${reason}`
          : `Ran out of steps. ${reason}`
  const avg = usage.jevRequests > 0 ? Math.round(usage.jevMs / usage.jevRequests) : 0
  const lines = [
    head,
    '',
    `${steps.length} moves, ${usage.jevRequests} Jev decisions at ${avg} ms each, ${usage.adviserCalls} adviser reading${usage.adviserCalls === 1 ? '' : 's'}, ${usage.typingCalls} typed field${usage.typingCalls === 1 ? '' : 's'}.`,
    '',
  ]
  if (files.length > 0) {
    lines.push(
      'Files in the task folder:',
      ...files.map((file) => `- ${file}`),
      '',
      'Not checked: the Jev driver does not read files. Open them to confirm they are what you asked for.',
      '',
    )
  } else if (/\bdownload/i.test(reason) || input.downloads.length > 0)
    lines.push(
      'No files were collected into the task folder. This does not establish whether the browser saved them elsewhere.',
      '',
    )
  lines.push('What happened:', ...history.map((line) => `- ${line}`))
  return lines.join('\n')
}
