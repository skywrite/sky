import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { generateText } from 'ai'
import { DIR_ATTACHMENTS } from '#config'
import slugify from '#lib/string/slugify.ts'
import { aiModel } from '#shared/ai/models.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

export type SlackFileRef = {
  // TODO: remove path.basename() fallback after agent-slack PR #64 is merged
  name?: string
  mimetype?: string
  mode?: string
  path: string
}

// =============================================================================
// Filename intelligence
// =============================================================================

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

/** Patterns that indicate a generic/meaningless filename */
const GENERIC_PATTERNS = [
  /^(image|img|photo|picture|screenshot|screen.?shot|pasted.?image|file|download|untitled|document|attachment)/i,
  /^IMG[_-]\d+/i, // IMG_1234, IMG-20260312
  /^DSC[_-]?\d+/i, // DSC_1234
  /^F[A-Z0-9]{8,}$/i, // Slack file IDs like F08ABCD1234
  /^[a-f0-9]{8,}$/i, // hex hashes
  /^\d{10,}$/, // unix timestamps
]

function isGenericFilename(name: string): boolean {
  const stem = name.replace(/\.[^.]+$/, '')
  return GENERIC_PATTERNS.some((p) => p.test(stem))
}

function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function mediaTypeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

/**
 * Use Haiku vision to generate a descriptive filename for an image.
 * Returns a slugified 5-7 word description, or undefined on failure.
 */
async function describeImageForFilename(imagePath: string): Promise<string | undefined> {
  try {
    const imageData = await readFile(imagePath)
    const { text } = await generateText({
      ...aiModel('fast'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'file' as const, data: imageData, mediaType: mediaTypeFromExt(imagePath) },
            {
              type: 'text' as const,
              text: 'Describe this image in 5-7 words for use as a filename. Return ONLY the description, no quotes or punctuation at the end.',
            },
          ],
        },
      ],
    })
    const description = text.trim()
    if (!description) return undefined
    return slugify(description, { preserveCase: true, suggestedLength: 60 })
  } catch {
    return undefined
  }
}

/**
 * Resolve the best filename for a Slack file attachment.
 * - If the original name is meaningful, keep it.
 * - If generic and an image, use Haiku vision to describe it.
 * - Otherwise, keep the original name.
 */
async function resolveAttachmentName(file: SlackFileRef): Promise<string> {
  // Prefer the human-readable name from Slack (requires agent-slack 0.5.5-jp+)
  // Falls back to path basename for older agent-slack versions without the name field
  const originalName = file.name ?? path.basename(file.path)
  if (!isGenericFilename(originalName)) return originalName

  if (isImageFile(file.path)) {
    const description = await describeImageForFilename(file.path)
    if (description) {
      const ext = path.extname(originalName)
      return `${description}${ext}`
    }
  }

  return originalName
}

// =============================================================================
// File copy with SHA256 dedup
// =============================================================================

async function sha256(filePath: string): Promise<string> {
  const data = await readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Copy a file to the attachments directory, deduplicating by SHA256.
 * - If destination exists with same hash → skip copy, reuse filename.
 * - If destination exists with different hash → append _2, _3, etc.
 * Returns the final filename (not full path) or undefined if source doesn't exist.
 */
async function copyFileDedup(
  sourcePath: string,
  attachDir: string,
  desiredFileName: string,
): Promise<string | undefined> {
  if (!existsSync(sourcePath)) return undefined

  const ext = path.extname(desiredFileName)
  const stem = desiredFileName.slice(0, -ext.length || undefined)
  let targetName = desiredFileName
  let targetPath = path.join(attachDir, targetName)

  if (existsSync(targetPath)) {
    const sourceHash = await sha256(sourcePath)
    const targetHash = await sha256(targetPath)
    if (sourceHash === targetHash) return targetName

    // Different content, find a unique name
    let counter = 2
    do {
      targetName = `${stem}_${counter}${ext}`
      targetPath = path.join(attachDir, targetName)
      if (existsSync(targetPath)) {
        const existingHash = await sha256(targetPath)
        if (existingHash === sourceHash) return targetName
      }
      counter++
    } while (existsSync(targetPath))
  }

  await copyFile(sourcePath, targetPath)
  return targetName
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Copy Slack file attachments to the notebook attachments directory for a given day.
 * Files are named: {date}_Slack_{resolvedName}
 * Generic filenames (image.png, IMG_1234.jpg, etc.) are renamed via AI for images.
 * Deduplicates by SHA256 to avoid copying the same file twice.
 */
export async function copySlackFilesToAttachments(
  files: SlackFileRef[],
  whenDate: PlainDate,
  output: { log: (msg: string) => void },
): Promise<Attachment[]> {
  if (files.length === 0) return []

  const attachDir = path.join(DIR_ATTACHMENTS, dayAttachmentsDir(whenDate))
  await mkdir(attachDir, { recursive: true })

  const attachments: Attachment[] = []
  for (const file of files) {
    const resolvedName = await resolveAttachmentName(file)
    const desiredName = `${whenDate}_Slack_${resolvedName}`
    const finalName = await copyFileDedup(file.path, attachDir, desiredName)
    if (finalName) {
      attachments.push({ file: finalName })
      output.log(`  Attachment: ${finalName}`)
    }
  }
  return attachments
}
