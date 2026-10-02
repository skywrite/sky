/**
 * A name in a people field that the notebook has no profile for, added in one press: the person
 * is made as `person:new` makes one, through the People page's own save, from the name alone.
 */

import { blankProfile } from '../../../people/types.ts'
import { rememberResolution, type Resolved } from './complete.ts'

/** Why a person was not added, in words for the row; `exists` when a profile already has the name. */
export class AddPersonError extends Error {
  constructor(
    message: string,
    readonly exists = false,
  ) {
    super(message)
  }
}

/** Whether a chip can become a person: an address is how to reach someone, not their name. */
export function canAddPerson(name: string): boolean {
  return name.trim().length > 0 && !name.includes('@')
}

/** Adds the person and answers where the name now points. */
export async function addPerson(name: string): Promise<Resolved> {
  let response: Response
  try {
    response = await fetch('/people/_api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...blankProfile('person'), name }),
    })
  } catch {
    throw new AddPersonError('Sky could not be reached. Try again.')
  }
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string }
  // The save refuses a second profile under one name unless it is confirmed to be someone else
  if (response.status === 409) throw new AddPersonError('A profile with that name is already in People.', true)
  if (!response.ok || !body.id) throw new AddPersonError(body.message ?? 'The request could not be completed.')
  const resolved: Resolved = { type: 'person', path: body.id }
  rememberResolution(name, resolved)
  return resolved
}
