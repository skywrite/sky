import { assert, test } from '#test'
import { buildActionTable, describeRow, fingerprint } from './table.ts'

// A real snapshot of a synthetic page, boxes included: every control kind,
// a password field, a dropdown, a checkbox, a disabled button, a frame,
// and a link far below the fold.
const SNAPSHOT = `### Page
- Page URL: http://localhost:55981/
- Page Title: Atlas Forms
### Snapshot
\`\`\`yaml
- generic [active] [ref=e1] [box=8,8,1264,1722]:
  - heading "Atlas Forms" [level=1] [ref=e2] [box=8,8,1264,37]
  - generic [ref=e3] [box=8,66,1264,42]:
    - generic [ref=e4] [box=8,88,201,18]:
      - text: Search
      - textbox "Search" [ref=e5] [box=56,87,153,21]: coffee
    - generic [ref=e6] [box=213,88,222,18]:
      - text: Username
      - textbox "Username" [ref=e7] [box=281,87,153,21]:
        - /placeholder: you@example.com
    - generic [ref=e8] [box=438,88,218,18]:
      - text: Password
      - textbox "Password" [ref=e9] [box=504,87,153,21]
    - generic [ref=e10] [box=660,88,85,18]:
      - text: Year
      - combobox "Year" [ref=e11] [box=694,88,52,19]:
        - option "2024" [box=0,0,0,0]
        - option "2025" [selected] [box=0,0,0,0]
    - generic [ref=e12] [box=750,88,118,18]:
      - checkbox "Remember me" [checked] [ref=e13] [box=754,89,13,13]
      - text: Remember me
    - generic [ref=e14] [box=871,88,223,18]:
      - text: Notes
      - textbox "Notes" [ref=e15] [box=913,66,182,36]: hello
    - button "Sign in" [ref=e16] [box=1099,87,57,21]
    - button "Disabled" [disabled] [ref=e17] [box=1160,87,68,21]
  - link "Documents" [ref=e18] [cursor=pointer] [box=8,194,73,18]:
    - /url: /docs
  - iframe [ref=e19] [box=85,124,304,84]:
    - button "Inside frame" [ref=f1e2] [box=8,8,89,21]
  - link "Far below the fold" [ref=e21] [cursor=pointer] [box=8,1712,118,18]:
    - /url: /far
\`\`\``

test('the table lists the controls in view with their kind, value, and nearby text', () => {
  const table = buildActionTable(SNAPSHOT)
  assert({
    given: 'the page header',
    should: 'carry the url and title',
    actual: [table.url, table.title],
    expected: ['http://localhost:55981/', 'Atlas Forms'],
  })
  assert({
    given: 'every control kind on the page',
    should: 'become rows in order, disabled and off-screen ones left out',
    actual: table.rows.map((row) => `${row.index}:${row.role}:${row.name}:${row.kind}`),
    expected: [
      '0:textbox:Search:type',
      '1:textbox:Username:type',
      '2:textbox:Password:type',
      '3:combobox:Year:select',
      '4:checkbox:Remember me:click',
      '5:textbox:Notes:type',
      '6:button:Sign in:click',
      '7:link:Documents:click',
      '8:button:Inside frame:click',
    ],
  })
  assert({
    given: 'values, placeholders, options and flags',
    should: 'ride on their rows',
    actual: {
      search: table.rows[0].value,
      placeholder: table.rows[1].placeholder,
      year: [table.rows[3].value, table.rows[3].options],
      remember: table.rows[4].flags,
      near: [table.rows[0].near, table.rows[7].near],
    },
    expected: {
      search: 'coffee',
      placeholder: 'you@example.com',
      year: ['2025', ['2024', '2025']],
      remember: ['checked'],
      near: ['Search', 'Notes'],
    },
  })
  assert({
    given: 'a field labelled Password',
    should: 'be marked secret, the others not',
    actual: table.rows.filter((row) => row.secret).map((row) => row.name),
    expected: ['Password'],
  })
  assert({
    given: 'a link 1700px down and a button inside a frame at the top',
    should: 'count the link below and keep the frame button in view',
    actual: { below: table.below, above: table.above, frameButton: table.rows[8].ref },
    expected: { below: 1, above: 0, frameButton: 'f1e2' },
  })
  assert({
    given: 'the page text',
    should: 'read in order from headings and text',
    actual: table.text.startsWith('Atlas Forms Search Username Password Year Remember me Notes'),
    expected: true,
  })
})

test('viewport metadata keeps wide-window controls and excludes controls below a small window', () => {
  const wide = '- Viewport: 1920x1200\n- button "Documents" [ref=e1] [box=1550,1000,140,40]'
  const small = SNAPSHOT.replace('### Page', '### Page\n- Viewport: 390x160')
  assert({
    given: 'snapshots from windows with different dimensions',
    should: 'use the measured viewport while retaining an explicit caller override',
    actual: [
      buildActionTable(wide).rows.map((row) => row.name),
      buildActionTable(wide, { width: 1280, height: 900 }).rows.length,
      buildActionTable(small).rows.map((row) => row.name),
      buildActionTable(small).below,
    ],
    expected: [['Documents'], 0, ['Search', 'Username', 'Inside frame'], 2],
  })
})

test('rows describe themselves for Jev and pages fingerprint by their content', () => {
  const table = buildActionTable(SNAPSHOT)
  assert({
    given: 'a textbox with a value and a combobox with options',
    should: 'describe as one line each',
    actual: [describeRow(table.rows[0]), describeRow(table.rows[3])],
    expected: ['[0] textbox "Search" = "coffee"', '[3] combobox "Year" = "2025" options: 2024 / 2025'],
  })
  const changed = buildActionTable(SNAPSHOT.replace(': coffee', ': tea'))
  assert({
    given: 'the same page with one value changed',
    should: 'fingerprint differently',
    actual:
      fingerprint(table) !== fingerprint(changed) && fingerprint(table) === fingerprint(buildActionTable(SNAPSHOT)),
    expected: true,
  })
})
