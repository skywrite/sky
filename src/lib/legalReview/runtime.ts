import * as path from 'node:path'
import { LegalReviewer } from './agent.ts'
import { LegalReviewStore } from './store.ts'

export function createLegalReviewer(config: { DIR_STATE: string }): LegalReviewer {
  return new LegalReviewer(new LegalReviewStore(path.join(config.DIR_STATE, 'legal-reviews')))
}
