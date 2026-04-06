/**
 * Reference field mappings for document types.
 *
 * Maps each document type to its fields that contain references to other entities.
 * Used by `:involves()` to know which fields to check for person involvement.
 *
 * Field types:
 * - 'person': Field contains person reference(s)
 * - 'org': Field contains organization reference(s)
 * - 'any': Field contains mixed references (via RelSet)
 *
 * To regenerate: Run `sky dev:schema:validate` to check mappings match actual models.
 */

export type RefType = 'person' | 'org' | 'any'

export type DocumentTypeName =
  | 'meeting'
  | 'message'
  | 'person'
  | 'org'
  | 'project'
  | 'decision'
  | 'goal'
  | 'idea'
  | 'day'
  | 'event'
  | 'journal'

export const refFields: Record<DocumentTypeName, Record<string, RefType>> = {
  meeting: {
    who: 'person',
    relSet: 'any',
  },
  message: {
    from: 'person',
    to: 'person',
    relSet: 'any',
  },
  person: {
    org: 'org',
    orgs: 'org',
    relSet: 'any',
  },
  org: {
    relSet: 'any',
  },
  project: {
    relSet: 'any',
  },
  decision: {
    relSet: 'any',
  },
  goal: {
    relSet: 'any',
  },
  idea: {
    relSet: 'any',
  },
  day: {
    relSet: 'any',
  },
  event: {
    who: 'person',
    relSet: 'any',
  },
  journal: {
    relSet: 'any',
  },
}

/**
 * Get fields that contain person references for a document type.
 */
export function getPersonFields(docType: DocumentTypeName): string[] {
  const fields = refFields[docType] ?? {}
  return Object.entries(fields)
    .filter(([_, type]) => type === 'person' || type === 'any')
    .map(([field]) => field)
}

/**
 * Get fields that contain org references for a document type.
 */
export function getOrgFields(docType: DocumentTypeName): string[] {
  const fields = refFields[docType] ?? {}
  return Object.entries(fields)
    .filter(([_, type]) => type === 'org' || type === 'any')
    .map(([field]) => field)
}

/**
 * Get all ref fields for a document type.
 */
export function getAllRefFields(docType: DocumentTypeName): string[] {
  const fields = refFields[docType] ?? {}
  return Object.keys(fields)
}
