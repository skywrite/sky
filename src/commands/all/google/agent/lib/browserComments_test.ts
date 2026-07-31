import { assert, test } from '#test'
import { sheetsCommentUrl, slidesCommentUrl } from './browserComments.ts'

test('slidesCommentUrl', () => {
  assert({
    given: 'a presentation id and slide objectId',
    should: 'build the edit URL addressing that slide',
    expected: 'https://docs.google.com/presentation/d/pres-1/edit#slide=id.slide-3',
    actual: slidesCommentUrl('pres-1', 'slide-3'),
  })
})

test('sheetsCommentUrl', () => {
  assert({
    given: 'a spreadsheet id, numeric sheetId and A1 range',
    should: 'build the edit URL that navigates AND selects the cell',
    expected: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=7&range=B12',
    actual: sheetsCommentUrl('sheet-1', 7, 'B12'),
  })
})
