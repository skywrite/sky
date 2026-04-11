/**
 * Validate reference field schema against actual model definitions.
 *
 * This script checks that the manually-defined ref field mappings in
 * _shared-ts/models/DomainCollection/query/schema/refs.ts match the actual
 * model class definitions.
 *
 * Usage: sky dev:schema:validate
 */

import { type DocumentTypeName, refFields } from '#shared/models/DomainCollection/query/schema/refs.ts'
import { exit } from '#shared/sys/mod.ts'

// Expected ref fields based on model analysis
// This is the source of truth - if models change, update this and refs.ts
const EXPECTED_FIELDS: Record<DocumentTypeName, string[]> = {
  meeting: ['who', 'relSet'],
  message: ['from', 'to', 'relSet'],
  person: ['org', 'orgs', 'relSet'],
  org: ['relSet'],
  project: ['relSet'],
  decision: ['relSet'],
  goal: ['relSet'],
  idea: ['relSet'],
  day: ['relSet'],
  event: ['who', 'relSet'],
  journal: ['relSet'],
}

function main(): void {
  let hasErrors = false

  console.log('Validating reference field schema...')
  console.log('')

  for (const [docType, expectedFields] of Object.entries(EXPECTED_FIELDS)) {
    const actualFields = Object.keys(refFields[docType as DocumentTypeName] ?? {})

    // Check for missing fields
    const missing = expectedFields.filter((f) => !actualFields.includes(f))
    if (missing.length > 0) {
      console.log(`❌ ${docType}: Missing fields: ${missing.join(', ')}`)
      hasErrors = true
    }

    // Check for extra fields
    const extra = actualFields.filter((f) => !expectedFields.includes(f))
    if (extra.length > 0) {
      console.log(`❌ ${docType}: Unexpected fields: ${extra.join(', ')}`)
      hasErrors = true
    }

    if (missing.length === 0 && extra.length === 0) {
      console.log(`✓ ${docType}: ${actualFields.join(', ')}`)
    }
  }

  console.log('')

  if (hasErrors) {
    console.log('Schema validation failed!')
    console.log('Update _shared-ts/models/DomainCollection/query/schema/refs.ts to match model definitions.')
    exit(1)
  }

  console.log('✅ Schema validation passed!')
}

if (import.meta.main) main()
