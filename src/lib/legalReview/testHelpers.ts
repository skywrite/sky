import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { LegalReviewer } from './agent.ts'
import type { ReviewIntelligence } from './intelligence.ts'
import { LegalReviewStore } from './store.ts'
import type { Analysis, ReviewContext, ReviewSource } from './types.ts'

export const REVIEW_CONTEXT: ReviewContext = {
  source: 'chat:mock-review',
  instructions:
    'Jane Doe leads Atlas, the customer. Atlas owns its deliverables and wants a short cancellation window.',
  conversation: [
    { role: 'user', content: 'Review five related agreements for Atlas. Only flag material problems here.' },
  ],
}

/** A valid one-page synthetic PDF: tests pass its original bytes through the same native input path. */
export function agreementPdf(text: string): Uint8Array {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
  const stream = `BT /F1 12 Tf 50 750 Td (${escaped}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

export function scriptedAnalysis(input: Parameters<ReviewIntelligence>[0]): Analysis {
  const { documents, review } = input
  const first = documents[0].record
  const second = documents[1]?.record
  const evidence = [{ documentId: first.id, location: 'Section 2', quote: 'Cancellation requires 90 days notice.' }]
  if (second)
    evidence.push({
      documentId: second.id,
      location: 'Page 1, section 1',
      quote: 'Cancellation requires 30 days notice.',
    })
  return {
    title: 'Atlas agreement review',
    perspective: {
      party: 'Atlas (customer)',
      basis: 'The supplied profile establishes Jane’s role at Atlas.',
      priorities: ['Short cancellation window'],
      uncertainties: [],
    },
    documents: documents.map(({ record }) => ({
      id: record.id,
      title: record.name,
      version: 'Version not stated',
      purpose: 'Defines terms for the Atlas arrangement',
      coverage: 'complete',
      limitations: [],
      relationships:
        record.id === second?.id
          ? [{ documentId: first.id, kind: 'related', explanation: 'Both address cancellation.' }]
          : [],
    })),
    findings: [
      {
        existingId: review.findings[0]?.id ?? null,
        title: second ? 'Cancellation windows conflict' : 'Long cancellation window',
        severity: 'material',
        kind: second ? 'interaction' : 'clause',
        assessment: 'open',
        explanation: second
          ? 'The agreements specify different notice periods without an express override.'
          : 'Ninety days limits flexibility.',
        recommendation: 'Ask the team to align the cancellation terms.',
        evidence,
      },
    ],
    missingDocuments: documents.length < 5 ? ['Remaining agreements'] : [],
    comparison: second
      ? 'The 90-day and 30-day notice terms have no clear order of precedence.'
      : 'Only one agreement is available; compare later documents when added.',
  }
}

export async function reviewFixture(analyze: ReviewIntelligence = async (input) => scriptedAnalysis(input)) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-legal-test-'))
  const store = new LegalReviewStore(root, path.join(root, 'time'), path.join(root, 'state'))
  const reviewer = new LegalReviewer(store, analyze)
  const sourceDir = path.join(root, 'incoming')
  await mkdir(sourceDir)
  const sources: ReviewSource[] = []
  const terms = [
    'Cancellation requires 90 days notice.',
    'Cancellation requires 30 days notice.',
    'Customer owns all deliverables.',
    'Schedule A describes the services.',
    'Security incidents must be reported within 24 hours.',
  ]
  for (const [index, text] of terms.entries()) {
    const name = `agreement-${index + 1}.${index === 1 ? 'pdf' : 'md'}`
    const file = path.join(sourceDir, name)
    await writeFile(file, index === 1 ? agreementPdf(text) : `# Agreement ${index + 1}\n\n${text}\n`)
    sources.push({ path: file, name })
  }
  return { root, store, reviewer, sources }
}
