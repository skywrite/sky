# Google Sheets

## Sheet palette

Use a consistent palette chosen from the mission. Default: dark text #1B1F2A, muted text #5C6470, blue accent #2557D6, white background #FFFFFF, and light surface #F2F5FA. Convert hex colors to Google rgbColor floats between 0 and 1.

## Building Spreadsheets

1. `create_spreadsheet` — comes with one tab; rename it or add tabs via `updateSheetProperties` / `addSheet`. Get numeric sheetIds from `get_spreadsheet_outline`; GridRanges use them, and endRowIndex/endColumnIndex are EXCLUSIVE.
2. Data first via `set_values`: headers in row 1, numbers as numbers, formulas as `=`-strings (`=SUM(B2:B13)`) — Google evaluates them, so put computed totals in formulas, not hardcoded values. **When the mission contains table/CSV data, pass it verbatim through set_values' `csv` parameter** — never hand-transcribe rows into arrays; the harness parses it exactly.
   Chart choice, when the mission doesn't specify: COLUMN for comparing categories, LINE for change over time, BAR for long category labels, pieChart only for shares with ≤5 slices. One message per chart.
3. One styling batch via `batch_update_spreadsheet`:
   - Header row: `repeatCell` over row 0 — bold, background-colored text on a text-colored fill (the sheet palette, i.e. inverted), `fields: 'userEnteredFormat(textFormat,backgroundColor)'`.
   - Freeze it: `updateSheetProperties` `{properties: {sheetId, gridProperties: {frozenRowCount: 1}}, fields: 'gridProperties.frozenRowCount'}`.
   - `autoResizeDimensions` for used columns; number formats via `repeatCell` `numberFormat` (`{type: 'CURRENCY', pattern: '$#,##0'}`, `{type: 'PERCENT', pattern: '0.0%'}`).
   - Banded rows: `addBanding` with surface/background band colors.
4. Charts via `addChart`: `spec` with a `title` plus `basicChart` (chartType COLUMN | BAR | LINE | AREA, `headerCount: 1`, `domains` and `series` from GridRange sources, `legendPosition: 'BOTTOM_LEGEND'`) or `pieChart`; `position` either `{newSheet: true}` or an `overlayPosition` anchored beside the data. The tool result returns the new chartIds.
5. **Dashboard tab** for sheets meant to be looked at: a "Summary" first tab with merged KPI cells (`mergeCells`, value at 24-36pt via `repeatCell`, caption beneath in mutedText), a `=SPARKLINE(Data!B2:B13)` (or `{"charttype","column"}`) beside each KPI, heatmaps via `addConditionalFormatRule` gradientRule (surface → accent), and status traffic lights via booleanRule background fills.
6. Interactivity where the sheet is a tracker: `setDataValidation` with condition BOOLEAN for checkbox columns, ONE_OF_LIST for status dropdowns.
7. "Summarize this data" missions: a pivot via `updateCells` writing a `pivotTable` value on an anchor cell (rows/values from a source GridRange) on its own tab, instead of hand-computed summary rows.

## Verifying Sheets

After all writes finish, get_spreadsheet_outline to verify tabs and charts, then spot-check the edited data and formula results with get_values. Fix concrete defects and check the affected cells again before reporting.

## Feedback in Sheets

For an anchored comment, pass sheetId and range.

- **Cell notes (Sheets)**: for spreadsheet feedback prefer real anchored notes — `updateCells` writing `note` on the exact cell (`fields: 'note'`) — visible on hover at the cell itself; add a panel comment only for points needing discussion.
