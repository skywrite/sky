import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import isParticipant from './isParticipant.ts'

const OWNER = ['Jane Doe', 'Jane']

function doc(markdown: string): Document {
  return Document.fromMarkdown(markdown)
}

test(`isParticipant() with owner as sender`, () => {
  const given = 'a DM the owner sent'
  const should = 'return true'

  const d = doc(`---
from: Jane Doe
to: John Smith
medium: Slack
---

# Topic
`)
  assert({ given, should, actual: isParticipant(d, OWNER), expected: true })
})

test(`isParticipant() with owner in comma-separated to`, () => {
  const given = 'owner listed among several recipients'
  const should = 'return true'

  const d = doc(`---
from: John Smith
to: Wendy Adams, Jane Doe
medium: Slack
---

# Topic
`)
  assert({ given, should, actual: isParticipant(d, OWNER), expected: true })
})

test(`isParticipant() with to as array`, () => {
  const given = 'recipients recorded as a YAML list including the owner'
  const should = 'return true'

  const d = doc(`---
from: John Smith
to:
  - Wendy Adams
  - Jane Doe
medium: Slack
---

# Topic
`)
  assert({ given, should, actual: isParticipant(d, OWNER), expected: true })
})

test(`isParticipant() with owner only in dialogue headers`, () => {
  const given = 'a channel thread the owner replied in (from/to name others)'
  const should = 'return true via the body author headers'

  const d = doc(`---
from: John Smith
to: "#atlas"
medium: Slack
---

# Topic

## 2026-03-01 10:00 - **John Smith**

Kickoff notes.

## 2026-03-01 10:05 - **Jane Doe**

Sounds good.
`)
  assert({ given, should, actual: isParticipant(d, OWNER), expected: true })
})

test(`isParticipant() with owner absent everywhere`, () => {
  const given = 'a channel thread between other people, saved for reference'
  const should = 'return false'

  const d = doc(`---
from: John Smith
to: "#atlas"
medium: Slack
---

# Topic

## 2026-03-01 10:00 - **John Smith**

Kickoff notes.

## 2026-03-01 10:05 - **Wendy Adams**

Agreed.
`)
  assert({ given, should, actual: isParticipant(d, OWNER), expected: false })
})

test(`isParticipant() matches case-insensitively`, () => {
  const given = 'the owner name differing only in case'
  const should = 'still match'

  const d = doc(`---
from: JANE DOE
medium: Slack
---

# Topic
`)
  assert({ given, should, actual: isParticipant(d, OWNER), expected: true })
})

test(`isParticipant() with a DM-thread to entry`, () => {
  const given = 'a capture addressed to "DM with <someone>" the owner never typed in'
  const should = 'return true - the owner is the implicit counterpart of their own DM'

  const d = doc(`---
from: John Smith
to: DM with John Smith
medium: Slack
---

# Topic

## 2026-03-01 10:00 - **John Smith**

Sent you the contract.
`)
  assert({ given, should, actual: isParticipant(d, OWNER), expected: true })
})

test(`isParticipant() with no owner names`, () => {
  const given = 'an empty names list (no owner identity available)'
  const should = 'return true - nothing can be classified as archival'

  const d = doc(`---
from: John Smith
to: "#atlas"
medium: Slack
---

# Topic
`)
  assert({ given, should, actual: isParticipant(d, []), expected: true })
})

test(`isParticipant() ignores bold text in deeper headings`, () => {
  const given = 'an h3 content line ending in bold that mentions the owner'
  const should = 'not count as a dialogue header'

  const d = doc(`---
from: John Smith
to: "#atlas"
medium: Slack
---

# Topic

## 2026-03-01 10:00 - **John Smith**

### Q1 owners - **Jane Doe**

Assignment table pasted from the doc.
`)
  assert({ given, should, actual: isParticipant(d, OWNER), expected: false })
})
