import type { Page } from 'playwright'
import { assert, test } from '#test'
import {
  docsCommentUrl,
  normalizeCommentText,
  plainCommentNeedle,
  sheetsCommentUrl,
  slidesCommentUrl,
  typeComment,
} from './browserComments.ts'

test('slidesCommentUrl', () => {
  assert({
    given: 'a presentation id and slide objectId',
    should: 'build the edit URL addressing that slide',
    expected: 'https://docs.google.com/presentation/d/pres-1/edit#slide=id.slide-3',
    actual: slidesCommentUrl('pres-1', 'slide-3'),
  })

  assert({
    given: 'a presentation id, slide objectId, and resolved Google account',
    should: 'place authuser before the #slide fragment so multi-account browsers select the right account',
    expected: 'https://docs.google.com/presentation/d/pres-1/edit?authuser=jane%40example.com#slide=id.slide-3',
    actual: slidesCommentUrl('pres-1', 'slide-3', 'jane@example.com'),
  })
})

test('sheetsCommentUrl', () => {
  assert({
    given: 'a spreadsheet id, numeric sheetId and A1 range',
    should: 'build the edit URL that navigates AND selects the cell',
    expected: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=7&range=B12',
    actual: sheetsCommentUrl('sheet-1', 7, 'B12'),
  })

  assert({
    given: 'a spreadsheet id, sheetId, range, and resolved Google account',
    should: 'place authuser before the #gid fragment',
    expected: 'https://docs.google.com/spreadsheets/d/sheet-1/edit?authuser=jane%40example.com#gid=7&range=B12',
    actual: sheetsCommentUrl('sheet-1', 7, 'B12', 'jane@example.com'),
  })
})

test('docsCommentUrl', () => {
  assert({
    given: 'a document id with optional tabId and account',
    should: 'combine tab and authuser query parameters cleanly',
    expected: [
      'https://docs.google.com/document/d/doc-1/edit',
      'https://docs.google.com/document/d/doc-1/edit?tab=t.0',
      'https://docs.google.com/document/d/doc-1/edit?tab=t.0&authuser=jane%40example.com',
    ],
    actual: [
      docsCommentUrl('doc-1'),
      docsCommentUrl('doc-1', 't.0'),
      docsCommentUrl('doc-1', 't.0', 'jane@example.com'),
    ],
  })
})

test('normalizeCommentText and plainCommentNeedle convert Markdown bold and preserve blank-line spacing', () => {
  const raw =
    '  **Make the desired outcome clearer**\r\n\r\n\r\n- State that Atlas seeks a material reduction.\r\n- Keep the threshold internal.  '
  const normalized = normalizeCommentText(raw)

  assert({
    given: 'a multi-line comment with **bold**, CRLF line endings, and extra blank lines',
    should: 'convert **bold** to Google Docs *bold*, cap blank lines at \\n\\n, and extract a plain-text API needle',
    expected: {
      normalized:
        '*Make the desired outcome clearer*\n\n- State that Atlas seeks a material reduction.\n- Keep the threshold internal.',
      needle: 'Make the desired outcome clearer',
    },
    actual: {
      normalized,
      needle: plainCommentNeedle(raw),
    },
  })
})

test('typeComment inserts lines with Shift+Enter breaks and submits with Meta+Enter', async () => {
  const actions: string[] = []
  const page = {
    keyboard: {
      press: async (key: string) => {
        actions.push(`press:${key}`)
      },
      insertText: async (text: string) => {
        actions.push(`insert:${text}`)
      },
    },
    locator: () => ({
      last: () => ({
        waitFor: async () => {},
      }),
    }),
    waitForTimeout: async () => {},
  } as unknown as Page

  await typeComment(page, '**Tighten the closing**\n\n- Request a working session.\n- Confirm owners.')

  assert({
    given: 'a headline, a blank line, and two bullet lines',
    should:
      'open the comment box, insert each line with Shift+Enter breaks preserving the blank line, and press Meta+Enter',
    expected: [
      'press:Meta+Alt+KeyM',
      'insert:*Tighten the closing*',
      'press:Shift+Enter',
      'press:Shift+Enter',
      'insert:- Request a working session.',
      'press:Shift+Enter',
      'insert:- Confirm owners.',
      'press:Meta+Enter',
    ],
    actual: actions,
  })
})
