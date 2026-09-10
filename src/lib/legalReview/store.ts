import { randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { atomicWrite, hash, missing, readOptional, withLock } from '#lib/outbox/files.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import dayDir from '#shared/nbfs/dayDir.ts'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import {
  DecisionSchema,
  findingBasis,
  SavedReviewSchema,
  type LegalReview,
  type ReviewDocument,
  type ReviewInput,
} from './types.ts'

export const reviewNow = (): string => ZonedDateTime.now().toUTC().normalize().toString()
const ID = /^\d{4}-\d{2}-\d{2}_[a-f0-9-]{36}$/

/** One readable notebook record; its companion folder holds immutable source versions. */
export class LegalReviewStore {
  constructor(
    readonly notebookDir: string,
    readonly timeDir: string,
    readonly stateDir: string,
  ) {}

  file(id: string): string {
    if (!ID.test(id)) throw new Error('Invalid legal review ID.')
    return path.join(this.timeDir, dayDir(new PlainDate(id.slice(0, 10))), 'legal-reviews', `${id}.md`)
  }

  async safe(file: string): Promise<string> {
    const relative = path.relative(this.notebookDir, file)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid review path.')
    let cursor = this.notebookDir
    for (const part of relative.split(path.sep)) {
      cursor = path.join(cursor, part)
      try {
        if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Review records cannot follow symbolic links.')
      } catch (error) {
        if (!missing(error)) throw error
      }
    }
    return file
  }

  async read(id: string): Promise<LegalReview | null> {
    const raw = await readOptional(await this.safe(this.file(id)))
    if (raw === undefined) return null
    const doc = Document.fromMarkdown(raw)
    const review = doc.yaml.review as LegalReview | undefined
    if (
      doc.yamlError ||
      review?.version !== 1 ||
      review.id !== id ||
      !Array.isArray(review.documents) ||
      !Array.isArray(review.findings) ||
      !Array.isArray(review.decisions) ||
      !SavedReviewSchema.safeParse(review).success
    )
      throw new Error('The saved legal review is unreadable. Its file has been preserved.')
    return review
  }

  async lock<T>(id: string, run: () => Promise<T>): Promise<T> {
    this.file(id)
    return withLock(path.join(this.stateDir, hash(this.notebookDir), `${id}.lock`), run)
  }

  async create(input: ReviewInput): Promise<LegalReview> {
    const now = reviewNow()
    const review: LegalReview = {
      version: 1,
      id: `${PlainDate.today().ymd}_${randomUUID()}`,
      created: now,
      updated: now,
      title: 'Agreement review',
      revision: 0,
      focus: input.focus ?? '',
      source: input.context.source,
      documents: [],
      findings: [],
      decisions: [],
      missingDocuments: [],
      comparison: { status: 'needed', summary: 'Add agreements to begin the review.' },
    }
    await this.write(review)
    return review
  }

  async retain(id: string, source: string, digest: string): Promise<string> {
    const target = path.join(this.file(id).slice(0, -3), 'sources', `${digest}${path.extname(source).toLowerCase()}`)
    await this.safe(target)
    await mkdir(path.dirname(target), { recursive: true })
    try {
      await copyFile(source, target, 1)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    return path.relative(this.notebookDir, target)
  }

  async sourceFile(review: LegalReview, document: ReviewDocument): Promise<string> {
    const file = path.resolve(this.notebookDir, document.file)
    if (!file.startsWith(this.file(review.id).slice(0, -3) + path.sep)) throw new Error('Invalid review source.')
    return this.safe(file)
  }

  async write(review: LegalReview): Promise<void> {
    review.updated = reviewNow()
    const lines = [`# ${review.title}`, '', review.comparison.summary, '', '## Agreements', '']
    for (const doc of review.documents) {
      const link = path
        .relative(path.dirname(this.file(review.id)), path.join(this.notebookDir, doc.file))
        .split(path.sep)
        .map(encodeURIComponent)
        .join('/')
      lines.push(
        `- [${doc.name.replaceAll('[', '').replaceAll(']', '')}](${link}) — ${doc.supersededBy ? 'superseded' : doc.status}${doc.details?.purpose ? `: ${doc.details.purpose}` : ''}`,
      )
    }
    lines.push('', '## Findings', '')
    for (const finding of review.findings) {
      lines.push(
        `### ${finding.title}`,
        '',
        `AI assessment: ${finding.assessment}${finding.needsRecheck ? ' · needs another review' : ''}. ${finding.explanation}`,
        '',
        `Suggested next step: ${finding.recommendation}`,
        '',
      )
      for (const evidence of finding.evidence)
        lines.push(
          `> ${evidence.quote.replaceAll('\n', '\n> ')}`,
          '',
          `${review.documents.find((d) => d.id === evidence.documentId)?.name ?? evidence.documentId} · ${evidence.location} · ${evidence.verification}`,
          '',
        )
    }
    lines.push('## Your decisions', '')
    for (const decision of review.decisions)
      lines.push(
        `- ${decision.at} · ${decision.findingId} · ${decision.action}${decision.note ? ` — ${decision.note}` : ''}`,
      )
    await atomicWrite(
      await this.safe(this.file(review.id)),
      new Document(
        { created: review.created.slice(0, 10), updated: review.updated.slice(0, 10), review },
        lines.join('\n'),
      ).toMarkdown(),
    )
  }

  async decide(id: string, raw: unknown, revision?: number): Promise<LegalReview> {
    const input = DecisionSchema.parse(raw)
    return this.lock(id, async () => {
      const review = await this.read(id)
      if (!review?.findings.some((finding) => finding.id === input.findingId)) throw new Error('No such finding.')
      if (revision !== undefined && review.revision !== revision)
        throw new Error('The review changed. Read the updated findings before recording your decision.')
      review.decisions.push({
        ...input,
        id: randomUUID(),
        at: reviewNow(),
        source: 'user',
        basis: findingBasis(review.findings.find((finding) => finding.id === input.findingId)!),
      })
      review.revision++
      await this.write(review)
      return review
    })
  }
}
