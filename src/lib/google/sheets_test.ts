import { assert, test } from '#test'
import { extractChartIds, spreadsheetUrl, summarizeSpreadsheet, validateSheetsRequests } from './sheets.ts'

test('validateSheetsRequests', () => {
  assert({
    given: 'a valid data-and-chart batch',
    should: 'pass',
    expected: null,
    actual: validateSheetsRequests([
      { repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 }, cell: {}, fields: '*' } },
      { updateSheetProperties: { properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } }, fields: '*' } },
      { addChart: { chart: { spec: {}, position: { newSheet: true } } } },
      { setDataValidation: { range: { sheetId: 0 }, rule: { condition: { type: 'BOOLEAN' } } } },
    ]),
  })

  assert({
    given: 'an unknown request kind',
    should: 'reject listing the allowlist',
    expected: [true, true],
    actual: [
      (validateSheetsRequests([{ dropAllData: {} }]) ?? '').includes('dropAllData'),
      (validateSheetsRequests([{ dropAllData: {} }]) ?? '').includes('addChart'),
    ],
  })
})

test('extractChartIds', () => {
  assert({
    given: 'batchUpdate replies with two addChart replies among others',
    should: 'return the minted chart ids in order',
    expected: [111, 222],
    actual: extractChartIds([
      {},
      { addChart: { chart: { chartId: 111 } } },
      { repeatCell: {} },
      { addChart: { chart: { chartId: 222 } } },
      { addChart: {} },
    ]),
  })
})

test('spreadsheetUrl', () => {
  assert({
    given: 'a spreadsheet id',
    should: 'build the edit URL',
    expected: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
    actual: spreadsheetUrl('sheet-1'),
  })
})

test('summarizeSpreadsheet', () => {
  const raw = {
    spreadsheetId: 'sheet-1',
    properties: { title: 'Atlas Budget' },
    sheets: [
      {
        properties: { sheetId: 0, title: 'Data', gridProperties: { rowCount: 100, columnCount: 26 } },
        charts: [{ chartId: 42, spec: { title: 'Spend by month' } }, { chartId: undefined }],
      },
      { properties: { sheetId: 7, title: 'Notes' } },
    ],
  }

  assert({
    given: 'a spreadsheets.get response',
    should: 'compact to tabs with sheetIds and charts with chartIds',
    expected: {
      spreadsheetId: 'sheet-1',
      title: 'Atlas Budget',
      sheets: [
        {
          sheetId: 0,
          title: 'Data',
          rows: 100,
          columns: 26,
          charts: [{ chartId: 42, title: 'Spend by month' }],
        },
        { sheetId: 7, title: 'Notes', rows: undefined, columns: undefined, charts: [] },
      ],
    },
    actual: summarizeSpreadsheet(raw),
  })
})
