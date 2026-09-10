import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { loadDocument } from '#lib/documents/loadDocument.ts'
import { analyzeAgreements, type ReadableAgreement, type ReviewIntelligence } from './intelligence.ts'
import { LegalReviewStore, reviewNow } from './store.ts'
import {
  activeDocuments,
  AnalysisSchema,
  type Analysis,
  type Evidence,
  type LegalReview,
  type ReviewInput,
} from './types.ts'

export const AGREEMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.rtf', '.odt', '.pages', '.md', '.txt'])
const MAX_BYTES = 20 * 1024 * 1024
const normalized = (value: string) => value.replace(/\s+/g, ' ').trim()

export class LegalReviewer {
  constructor(
    readonly store: LegalReviewStore,
    private readonly analyze: ReviewIntelligence = analyzeAgreements,
  ) {}

  async register(input: ReviewInput): Promise<LegalReview> {
    if (
      input.expectedDocuments !== undefined &&
      (!Number.isSafeInteger(input.expectedDocuments) || input.expectedDocuments < 1 || input.expectedDocuments > 100)
    )
      throw new Error('Expected agreement count must be between 1 and 100.')
    if (input.replaces && input.sources.length !== 1)
      throw new Error('Provide exactly one revised agreement when replacing a version.')
    if (!input.id && input.sources.length === 0)
      throw new Error('Attach an agreement or provide its local path to begin.')
    // Validate before creating a review, so a typo does not link an empty record to the chat.
    const sources = await Promise.all(
      input.sources.map(async (source) => {
        if (!AGREEMENT_EXTENSIONS.has(path.extname(source.path).toLowerCase()))
          throw new Error(`Unsupported agreement: ${source.name}`)
        const info = await stat(source.path)
        if (!info.isFile() || info.size > MAX_BYTES) throw new Error(`${source.name} must be a file of 20 MB or less.`)
        const digest = createHash('sha256')
          .update(await readFile(source.path))
          .digest('hex')
        return { ...source, digest }
      }),
    )
    const initial = input.id ? await this.store.read(input.id) : await this.store.create(input)
    if (!initial) throw new Error('The linked review could not be found. Its context has not been replaced.')
    const review = await this.store.lock(initial.id, async () => {
      const current = (await this.store.read(initial.id))!
      if (input.replaces && !activeDocuments(current).some((document) => document.id === input.replaces))
        throw new Error('The agreement to replace is not an active version in this review.')
      let changed = false
      for (const source of sources) {
        if (
          input.replaces
            ? current.documents.find((document) => document.id === input.replaces)?.hash === source.digest
            : current.documents.some((document) => document.hash === source.digest)
        )
          continue
        const id = randomUUID()
        const file = await this.store.retain(current.id, source.path, source.digest)
        current.documents.push({
          id,
          name: source.name,
          file,
          hash: source.digest,
          added: reviewNow(),
          status: 'pending',
          ...(input.replaces ? { replaces: input.replaces } : {}),
        })
        if (input.replaces) current.documents.find((document) => document.id === input.replaces)!.supersededBy = id
        changed = true
      }
      if (input.focus !== undefined && input.focus !== current.focus) {
        current.focus = input.focus
        changed = true
      }
      if (input.expectedDocuments !== undefined && input.expectedDocuments !== current.expectedDocuments) {
        current.expectedDocuments = input.expectedDocuments
        changed = true
      }
      if (changed) {
        current.revision++
        current.comparison.status = 'needed'
        for (const finding of current.findings) finding.needsRecheck = true
        await this.store.write(current)
      }
      return current
    })
    await input.onCreated?.(review.id)
    return review
  }

  async review(input: ReviewInput, progress: (line: string) => void = () => {}): Promise<LegalReview> {
    const registered = await this.register(input)
    try {
      const documents: ReadableAgreement[] = []
      let bytes = 0
      let characters = 0
      for (const record of activeDocuments(registered)) {
        const file = await this.store.sourceFile(registered, record)
        const data = await readFile(file)
        if (createHash('sha256').update(data).digest('hex') !== record.hash)
          throw new Error(`The retained source ${record.name} changed. Add it as a new version before reviewing.`)
        bytes += data.length
        if (bytes > MAX_BYTES)
          throw new Error('This agreement set exceeds the 20 MB review limit. No documents were silently skipped.')
        progress(`Reading ${record.name}`)
        const loaded = await loadDocument(file)
        if (!loaded.success) throw new Error(loaded.error)
        if (loaded.document.kind === 'image') throw new Error('Provide this agreement as a PDF or text document.')
        if (loaded.document.kind === 'text') characters += loaded.document.text.length
        if (characters > 500_000) throw new Error('This set exceeds the review text limit. No agreement was truncated.')
        documents.push({ record, document: loaded.document })
      }
      progress(`Reviewing ${documents.length} agreements and their relationships`)
      const analysis = AnalysisSchema.parse(
        await this.analyze({ review: registered, context: input.context, documents, progress }),
      )
      validateAnalysis(registered, analysis, documents)
      return await this.store.lock(registered.id, async () => {
        const current = (await this.store.read(registered.id))!
        if (current.revision !== registered.revision)
          throw new Error('The agreement set changed during review. Run the comparison again with the new set.')
        applyAnalysis(current, analysis, documents)
        current.revision++
        await this.store.write(current)
        return current
      })
    } catch (error) {
      await this.store.lock(registered.id, async () => {
        const current = (await this.store.read(registered.id))!
        current.lastError = error instanceof Error ? error.message : String(error)
        current.comparison.status = 'needed'
        await this.store.write(current)
      })
      throw error
    }
  }
}

function validateAnalysis(review: LegalReview, analysis: Analysis, documents: ReadableAgreement[]): void {
  const ids = new Set(documents.map(({ record }) => record.id))
  if (
    analysis.documents.length !== ids.size ||
    new Set(analysis.documents.map((document) => document.id)).size !== ids.size ||
    analysis.documents.some((document) => !ids.has(document.id))
  )
    throw new Error('The reviewer did not account for every agreement. The previous findings have been kept.')
  const prior = new Set(review.findings.map((finding) => finding.id))
  const seen = new Set<string>()
  for (const finding of analysis.findings) {
    if (finding.existingId && (!prior.has(finding.existingId) || seen.has(finding.existingId)))
      throw new Error('The reviewer returned an invalid prior finding reference.')
    if (finding.existingId) seen.add(finding.existingId)
    if (finding.evidence.some((item) => !ids.has(item.documentId)))
      throw new Error('The reviewer cited an agreement outside the current set.')
    if (finding.kind === 'interaction' && new Set(finding.evidence.map((item) => item.documentId)).size < 2)
      throw new Error('A cross-agreement finding must cite both agreements.')
  }
  for (const document of analysis.documents) {
    if (document.relationships.some((relation) => !ids.has(relation.documentId) || relation.documentId === document.id))
      throw new Error('The document map contains an invalid relationship.')
  }
}

function applyAnalysis(review: LegalReview, analysis: Analysis, documents: ReadableAgreement[]): void {
  review.title = analysis.title
  review.perspective = analysis.perspective
  review.missingDocuments = analysis.missingDocuments
  delete review.lastError
  for (const details of analysis.documents) {
    const document = review.documents.find((item) => item.id === details.id)!
    document.details = details
    document.status = details.coverage === 'complete' ? 'reviewed' : 'partial'
  }
  // An omitted prior finding remains visible, rather than disappearing or becoming a user decision.
  const findings = new Map(review.findings.map((finding) => [finding.id, { ...finding, needsRecheck: true }]))
  for (const result of analysis.findings) {
    const { existingId, ...finding } = result
    const id = existingId ?? randomUUID()
    const evidence: Evidence[] = finding.evidence.map((item) => {
      const document = documents.find(({ record }) => record.id === item.documentId)!.document
      return {
        ...item,
        verification:
          document.kind === 'pdf'
            ? 'pdf-citation'
            : document.kind === 'text' && normalized(document.text).includes(normalized(item.quote))
              ? 'text-matched'
              : 'unverified',
      }
    })
    const unverified = evidence.some((item) => item.verification === 'unverified')
    findings.set(id, {
      ...finding,
      id,
      evidence,
      needsRecheck: unverified,
      ...(unverified ? { assessment: 'uncertain' as const } : {}),
    })
  }
  review.findings = [...findings.values()]
  review.comparison = {
    status:
      analysis.documents.some((document) => document.coverage === 'partial') ||
      review.findings.some((finding) => finding.needsRecheck)
        ? 'needed'
        : 'current',
    summary: analysis.comparison,
    at: reviewNow(),
  }
}
