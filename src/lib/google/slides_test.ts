import { assert, test } from '#test'
import { presentationUrl, summarizePresentation, validateSlidesRequests } from './slides.ts'

test('validateSlidesRequests', () => {
  assert({
    given: 'a valid compose batch',
    should: 'pass',
    expected: null,
    actual: validateSlidesRequests([
      { createSlide: { objectId: 'slide-1', slideLayoutReference: { predefinedLayout: 'BLANK' } } },
      { createShape: { objectId: 'slide-1-title', shapeType: 'TEXT_BOX' } },
      { insertText: { objectId: 'slide-1-title', text: 'Atlas' } },
      { updateTextStyle: { objectId: 'slide-1-title', textRange: { type: 'ALL' }, style: {}, fields: '*' } },
    ]),
  })

  assert({
    given: 'a request kind outside the allowlist',
    should: 'reject listing the allowlist',
    expected: [true, true],
    actual: [
      (validateSlidesRequests([{ replaceAllShapesWithImage: {} }]) ?? '').includes('replaceAllShapesWithImage'),
      (validateSlidesRequests([{ replaceAllShapesWithImage: {} }]) ?? '').includes('createSlide'),
    ],
  })

  assert({
    given: 'the linked-chart and connector-line request kinds',
    should: 'be allowed',
    expected: null,
    actual: validateSlidesRequests([
      { createSheetsChart: { objectId: 'chart-1', spreadsheetId: 's', chartId: 1, linkingMode: 'LINKED' } },
      { refreshSheetsChart: { objectId: 'chart-1' } },
      { createLine: { objectId: 'line-1', lineCategory: 'BENT' } },
      { updateLineProperties: { objectId: 'line-1', lineProperties: {}, fields: '*' } },
    ]),
  })

  assert({
    given: 'an empty batch',
    should: 'reject',
    expected: 'requests is empty',
    actual: validateSlidesRequests([]),
  })
})

test('presentationUrl', () => {
  assert({
    given: 'a presentation id',
    should: 'build the edit URL',
    expected: 'https://docs.google.com/presentation/d/abc-123/edit',
    actual: presentationUrl('abc-123'),
  })
})

test('summarizePresentation', () => {
  const raw = {
    presentationId: 'pres-1',
    title: 'Atlas Pitch',
    slides: [
      {
        objectId: 'slide-a',
        slideProperties: { notesPage: { notesProperties: { speakerNotesObjectId: 'notes-a' } } },
        pageElements: [
          {
            objectId: 'title-a',
            shape: {
              shapeType: 'TEXT_BOX',
              placeholder: { type: 'CENTERED_TITLE' },
              text: { textElements: [{ textRun: { content: 'Atlas Pitch\n' } }] },
            },
          },
        ],
      },
      {
        objectId: 'slide-b',
        pageElements: [
          { objectId: 'table-b', table: { rows: 2, columns: 3 } },
          { objectId: 'image-b', image: { contentUrl: 'https://example.com/img.png' } },
          {
            objectId: 'body-b',
            shape: {
              shapeType: 'TEXT_BOX',
              text: {
                textElements: [{ textRun: { content: 'Point one\n' } }, { textRun: { content: 'Point two\n' } }],
              },
            },
          },
        ],
      },
    ],
  }

  assert({
    given: 'a presentations.get response',
    should: 'compact to targetable object ids with types and text excerpts',
    expected: {
      presentationId: 'pres-1',
      title: 'Atlas Pitch',
      slideCount: 2,
      slides: [
        {
          objectId: 'slide-a',
          index: 0,
          notesObjectId: 'notes-a',
          elements: [{ objectId: 'title-a', type: 'CENTERED_TITLE', text: 'Atlas Pitch' }],
        },
        {
          objectId: 'slide-b',
          index: 1,
          notesObjectId: undefined,
          elements: [
            { objectId: 'table-b', type: 'TABLE 2x3' },
            { objectId: 'image-b', type: 'IMAGE' },
            { objectId: 'body-b', type: 'TEXT_BOX', text: 'Point one\nPoint two' },
          ],
        },
      ],
    },
    actual: summarizePresentation(raw),
  })
})
