import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_ATTACHMENTS } from '#config'
import slugify from '#lib/string/slugify.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

export type DownloadedAttachment = {
  filename: string
  data: Buffer
}

async function sha256(filePath: string): Promise<string> {
  const data = await readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

function sha256Buffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Write a buffer to the attachments directory, deduplicating by SHA256.
 * Returns the final filename or undefined if nothing was written.
 */
async function writeFileDedup(data: Buffer, attachDir: string, desiredFileName: string): Promise<string | undefined> {
  const ext = path.extname(desiredFileName)
  const stem = desiredFileName.slice(0, -ext.length || undefined)
  let targetName = desiredFileName
  let targetPath = path.join(attachDir, targetName)

  if (existsSync(targetPath)) {
    const sourceHash = sha256Buffer(data)
    const targetHash = await sha256(targetPath)
    if (sourceHash === targetHash) return targetName

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

  await writeFile(targetPath, data)
  return targetName
}

/**
 * Save pre-downloaded email attachments to the notebook attachments directory.
 * Files are named: {date}_Email_{slugifiedFilename}
 * Deduplicates by SHA256.
 */
export async function copyEmailFilesToAttachments(
  files: DownloadedAttachment[],
  whenDate: PlainDate,
  output: { log: (msg: string) => void },
): Promise<Attachment[]> {
  if (files.length === 0) return []

  const attachDir = path.join(DIR_ATTACHMENTS, dayAttachmentsDir(whenDate))
  await mkdir(attachDir, { recursive: true })

  const attachments: Attachment[] = []
  for (const file of files) {
    const ext = path.extname(file.filename)
    const stem = file.filename.slice(0, -ext.length || undefined)
    const sluggedStem = slugify(stem, { preserveCase: true, suggestedLength: 60 })
    const desiredName = `${whenDate}_Email_${sluggedStem}${ext}`

    const finalName = await writeFileDedup(file.data, attachDir, desiredName)
    if (finalName) {
      attachments.push({ file: finalName })
      output.log(`  Attachment: ${finalName}`)
    }
  }
  return attachments
}
