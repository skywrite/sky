import { openai } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import * as config from '#shared/config.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { convertToNotebookTimezone, fetchNowSync } from '#shared/nbfs/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import { env } from '#shared/sys/mod.ts'
import timezoneOffset from '#universal/dates/timezones/timezoneOffset.ts'
import YMD from '#universal/dates/ymd.ts'

const PROMPT_FILE = new URL('./prompts/site-html-to-markdown.prompt.md', import.meta.url).pathname

export interface BrowserExtensionData {
  sourceUrl: string
  content: string
  capturedAt: string
  screenshot: string // base64
  userSupplement: string
}

export interface JsonMarkdownContent {
  markdown: string
  medium: string
  summary: string
  subject?: string
  when?: string
  from?: string
  to?: string
  bcc: string
  cc: string
}

export default async function siteHtmlHandler(jsonBlob: BrowserExtensionData) {
  try {
    const jsonContent = await converHtmlToMarkdown(jsonBlob)

    try {
      // Decode the Base64 string to a Uint8Array
      const binaryData = Uint8Array.from(atob(jsonBlob.screenshot), (char) => char.charCodeAt(0))
      // Write the binary data to a file on disk
      // await writeFile('output.png', binaryData)
    } catch (_) {
      // Screenshot handling error - intentionally ignored
    }

    await executeTask(jsonContent)
  } catch (e) {
    const error = e as Error
    console.log(`siteHtmlHandler Error`)
    console.error(error)
    console.error('Stack trace:', error.stack)
    throw error
  }
}

function sanitizeName(value: string): string {
  // Truncate at first JSON/code syntax character (AI hallucination boundary)
  const truncated = value.replace(/[{}\[\]=].*$/, '')
  // Strip non-Latin/Common script characters
  const cleaned = truncated.replace(/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/gu, '')
  // Collapse whitespace and trim
  return cleaned.replace(/\s+/g, ' ').trim()
}

async function executeTask(contentData: JsonMarkdownContent): Promise<void> {
  // Convert when from system timezone to notebook day's timezone
  // Pre-parse to PlainDateTime since CommandService.run() doesn't parse overrides
  const when = contentData.when ? await convertToNotebookTimezone(contentData.when) : fetchNowSync().plainDateTime

  const commandArgs = {
    ...contentData,
    when,
  }

  // Log extracted data for debugging
  console.log(`[siteHtml] [${new Date().toISOString()}] Extracted data:`, JSON.stringify(contentData, null, 2))

  const context = CommandContext.server(config, env.toObject())
  const tasks = new CommandService(context)
  const medium = contentData.medium

  switch (medium) {
    case 'Email': {
      await tasks.run('email:new', commandArgs)
      return
    }
    case 'Slack': {
      await tasks.run('slack:new', commandArgs)
      return
    }
    default: {
      console.log(`[server:sitehtml] Unknown medium: ${medium}`)
      return
    }
  }
}

async function converHtmlToMarkdown(jsonBlob: BrowserExtensionData): Promise<JsonMarkdownContent> {
  const now = new Date()
  const currentTime = YMD().join('-') + ' ' + now.toTimeString().slice(0, 5) + ' ' + timezoneOffset()

  const promptContent = await readTextFile(PROMPT_FILE)
  const renderInput: RenderInput = {
    capture: {
      userSupplement: jsonBlob.userSupplement ?? '',
      sourceUrl: jsonBlob.sourceUrl,
      currentTime,
      html: jsonBlob.content,
    },
  }
  const { output: prompt } = renderPromptFile(promptContent, 'site-html-to-markdown.prompt.md', renderInput)

  console.log(`[siteHtml] [${new Date().toISOString()}] Prompt sent to AI:`, prompt)

  const jsonMarkdownSchema = z.object({
    markdown: z.string(),
    medium: z.string(),
    summary: z.string(),
    subject: z.string(),
    when: z.string(),
    from: z.string(),
    to: z.string().describe('Recipient name or Slack channel (e.g. "#channel-name" or "Alice"). No extra text.'),
    bcc: z.string(),
    cc: z.string(),
  })

  const result = await generateObject({
    model: openai('gpt-5.2'),
    prompt,
    maxOutputTokens: 64000,
    schema: jsonMarkdownSchema,
  })

  console.log(`[siteHtml] [${new Date().toISOString()}] Response received from AI`)

  const data: JsonMarkdownContent = result.object

  // Sanitize name fields - AI sometimes outputs stray Unicode (e.g. Bengali characters)
  if (data.to) data.to = sanitizeName(data.to)
  if (data.from) data.from = sanitizeName(data.from)

  return data
}
