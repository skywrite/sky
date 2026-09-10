import * as path from 'node:path'
import { LegalReviewer } from './agent.ts'
import { LegalReviewStore } from './store.ts'

export function createLegalReviewer(config: { DIR_BASE: string; DIR_TIME: string; DIR_STATE: string }): LegalReviewer {
  return new LegalReviewer(
    new LegalReviewStore(config.DIR_BASE, config.DIR_TIME, path.join(config.DIR_STATE, 'legal-reviews')),
  )
}
