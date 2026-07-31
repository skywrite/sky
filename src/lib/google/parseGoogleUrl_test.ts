import { assert, test } from '#test'
import { isLikelyFileId, parseGoogleUrl, resolveFileRef } from './parseGoogleUrl.ts'

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abc'

test('parseGoogleUrl workspace links', () => {
  assert({
    given: 'a Docs edit link',
    should: 'extract the id and kind',
    expected: { fileId: ID, kind: 'doc' },
    actual: parseGoogleUrl(`https://docs.google.com/document/d/${ID}/edit`),
  })

  assert({
    given: 'a Sheets link with a fragment',
    should: 'extract the id and kind',
    expected: { fileId: ID, kind: 'sheet' },
    actual: parseGoogleUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`),
  })

  assert({
    given: 'a Slides link without a trailing segment',
    should: 'extract the id and kind',
    expected: { fileId: ID, kind: 'slides' },
    actual: parseGoogleUrl(`https://docs.google.com/presentation/d/${ID}`),
  })
})

test('parseGoogleUrl drive links', () => {
  assert({
    given: 'a Drive file link',
    should: 'extract the id with no kind',
    expected: { fileId: ID },
    actual: parseGoogleUrl(`https://drive.google.com/file/d/${ID}/view`),
  })

  assert({
    given: 'a Drive open?id= link',
    should: 'extract the id from the query',
    expected: { fileId: ID },
    actual: parseGoogleUrl(`https://drive.google.com/open?id=${ID}`),
  })
})

test('parseGoogleUrl rejects non-file inputs', () => {
  assert({
    given: 'unrelated or malformed inputs',
    should: 'return null',
    expected: [null, null, null, null],
    actual: [
      parseGoogleUrl('https://example.com/document/d/abc'),
      parseGoogleUrl('https://docs.google.com/'),
      parseGoogleUrl('not a url'),
      parseGoogleUrl(`https://drive.google.com/drive/folders/${ID}`),
    ],
  })
})

test('resolveFileRef', () => {
  assert({
    given: 'a URL, a bare id, and junk',
    should: 'resolve the first two and reject the third',
    expected: [{ fileId: ID, kind: 'doc' }, { fileId: ID }, null],
    actual: [
      resolveFileRef(`https://docs.google.com/document/d/${ID}/edit`),
      resolveFileRef(ID),
      resolveFileRef('not a file ref'),
    ],
  })
})

test('isLikelyFileId', () => {
  assert({
    given: 'bare strings',
    should: 'accept long id-shaped ones only',
    expected: [true, false, false],
    actual: [isLikelyFileId(ID), isLikelyFileId('short'), isLikelyFileId('has spaces in it definitely not an id')],
  })
})
