import { lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { z } from 'zod'
import { atomicWrite, hash, missing, readOptional, withLock } from '#lib/outbox/files.ts'
import { weekDir } from '#shared/nbfs/mod.ts'
import { type PlainDate, Week } from '#universal/dates/nbdt/mod.ts'

export class WeekCaptureError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 400,
  ) {
    super(message)
  }
}

const Capture = z.object({
  text: z.string().max(20_000),
  requestId: z.string().trim().min(1).max(200),
})
const Receipt = z.object({ id: z.string(), textHash: z.string(), complete: z.boolean() })

export interface WeekCaptureOptions {
  markdownBaseDir: string
  timeDir: string
  stateDir?: string
}

export interface WeekCaptureResult {
  id: string
  path: string
}

function goalText(text: string): string {
  const value = text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-*+]\s+(?:\[[ xX]\]\s+)?/, '')
    .trim()
  if (!value) throw new WeekCaptureError('Describe what you want to get done this week.')
  // This text is also opened as Markdown; raw HTML could hide the goal or
  // become active markup there, even though the week page renders plain text.
  if (/<(?:\/?[a-z][\w:-]*(?:\s|\/?>)|!--|!\[CDATA\[|\?|![a-z])/i.test(value))
    throw new WeekCaptureError('Use plain text for your weekly goal, without HTML tags or comments.')
  return value
}

/** Keep existing prose and frontmatter verbatim; the neutral category also works in the week reader. */
function withGoal(content: string | undefined, week: Week, today: PlainDate, text: string, marker: string): string {
  const source = content ?? `---\ncreated: ${today.ymd}\nupdated: ${today.ymd}\n---\n\n# ${week}: Week Plan\n`
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(newline)
  if (lines.includes(marker)) return source
  const goals = lines.findIndex((line) => /^##\s+Goals\s*$/.test(line))
  const item = [`- ${text}`, marker, '']
  if (goals < 0) {
    lines.push('', '## Goals', '', '### To do', '', ...item)
  } else {
    let end = lines.findIndex((line, i) => i > goals && /^#{1,2}\s/.test(line))
    if (end < 0) end = lines.length
    const category = lines.findIndex((line, i) => i > goals && i < end && /^###\s+To do\s*$/.test(line))
    if (category < 0) lines.splice(end, 0, '', '### To do', '', ...item)
    else {
      let categoryEnd = lines.findIndex((line, i) => i > category && /^#{1,3}\s/.test(line))
      if (categoryEnd < 0) categoryEnd = lines.length
      lines.splice(categoryEnd, 0, '', ...item)
    }
  }
  return lines.join(newline)
}

async function safePlanFile(timeDir: string, week: Week): Promise<string> {
  const root = path.resolve(timeDir)
  const file = path.resolve(root, weekDir(week.startInYear), 'week.md')
  const relative = path.relative(root, file)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new WeekCaptureError('Invalid week path.')
  let cursor = root
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part)
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new WeekCaptureError('The week plan cannot be a symbolic link.')
    } catch (error) {
      if (!missing(error)) throw error
    }
  }
  return file
}

/** A retry keeps its original week, including across a week boundary or a lost response. */
export async function captureWeekGoal(
  options: WeekCaptureOptions,
  currentWeek: Week,
  today: PlainDate,
  input: unknown,
): Promise<WeekCaptureResult> {
  const parsed = Capture.safeParse(input)
  if (!parsed.success) throw new WeekCaptureError('Expected {text, requestId}; text must be at most 20,000 characters.')
  const text = goalText(parsed.data.text)
  const textHash = hash(text)
  const requestHash = hash(parsed.data.requestId)
  const stateDir = options.stateDir ?? path.join(tmpdir(), `sky-week-capture-${hash(path.resolve(options.timeDir))}`)
  return withLock(path.join(stateDir, 'write.lock'), async () => {
    const receiptFile = path.join(stateDir, `${requestHash}.json`)
    const saved = await readOptional(receiptFile)
    const receipt = saved ? Receipt.parse(JSON.parse(saved)) : undefined
    if (receipt && receipt.textHash !== textHash)
      throw new WeekCaptureError('This request was already used for a different goal. Start a new request.', 409)
    const week = receipt ? Week.parse(receipt.id) : currentWeek
    const file = await safePlanFile(options.timeDir, week)
    const result = { id: week.toString(), path: path.relative(options.markdownBaseDir, file) }
    if (receipt?.complete) return result

    // Record the target before writing; the in-file marker closes the crash window
    // between saving the goal and completing its receipt.
    if (!receipt) await atomicWrite(receiptFile, JSON.stringify({ id: result.id, textHash, complete: false }))
    const marker = `<!-- sky-week-capture:${requestHash} -->`
    const before = await readOptional(file)
    const after = withGoal(before, week, today, text, marker)
    if (after !== before) await atomicWrite(file, after)
    await atomicWrite(receiptFile, JSON.stringify({ id: result.id, textHash, complete: true }))
    return result
  })
}
