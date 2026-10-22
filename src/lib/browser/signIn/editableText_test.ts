import { assert, test } from '#test'
import { addEditableText, MAX_BLOCKS } from './editableText.ts'

// A synthetic editor page as the worker's snapshot shows it: blocks marked
// as textboxes, with placeholders and links but no words, beside an
// ordinary field whose value Playwright already shows.
const SNAPSHOT = `- main [ref=e2] [box=8,8,1264,227]:
  - textbox [ref=e3] [box=8,8,1264,37]:
    - /placeholder: New page
  - textbox [ref=e4] [box=8,66,1264,18]:
    - /placeholder: Heading 2
    - link "Roadmap" [ref=e5] [box=156,66,60,18]:
      - /url: https://example.com/roadmap
  - textbox [ref=e6] [box=8,84,1264,18]
  - textbox [ref=e7] [box=8,102,1264,18]:
    - /placeholder: List
  - textbox [ref=e8] [box=8,120,1264,18]
  - textbox "Name" [ref=e9] [box=8,140,153,21]: Jane Doe
  - iframe [ref=e10] [box=8,170,600,100]:
    - textbox [ref=f1e2] [box=8,8,500,18]`

const WORDS: Record<string, string> = {
  e3: 'Atlas plan',
  e4: 'Atlas launch\n plan with  the Roadmap',
  e6: '- first item',
  e7: '',
  f1e2: 'Status: on track',
}

test('editable blocks get their words back under them', async () => {
  const reads: string[] = []
  const filled = await addEditableText(SNAPSHOT, async (ref) => {
    reads.push(ref)
    if (ref === 'e8') throw new Error('The block is gone.')
    return WORDS[ref]
  })
  assert({
    given:
      'blocks with words, an empty block, a block gone before it was read, a field with a value, a block in a frame',
    should: 'add each block’s words as one text line after its properties, quoted where YAML would misread them',
    actual: filled,
    expected: `- main [ref=e2] [box=8,8,1264,227]:
  - textbox [ref=e3] [box=8,8,1264,37]:
    - /placeholder: New page
    - text: Atlas plan
  - textbox [ref=e4] [box=8,66,1264,18]:
    - /placeholder: Heading 2
    - text: Atlas launch plan with the Roadmap
    - link "Roadmap" [ref=e5] [box=156,66,60,18]:
      - /url: https://example.com/roadmap
  - textbox [ref=e6] [box=8,84,1264,18]:
    - text: "- first item"
  - textbox [ref=e7] [box=8,102,1264,18]:
    - /placeholder: List
  - textbox [ref=e8] [box=8,120,1264,18]
  - textbox "Name" [ref=e9] [box=8,140,153,21]: Jane Doe
  - iframe [ref=e10] [box=8,170,600,100]:
    - textbox [ref=f1e2] [box=8,8,500,18]:
      - text: "Status: on track"`,
  })
  assert({
    given: 'the field that already shows its value',
    should: 'not be read',
    actual: reads.sort(),
    expected: ['e3', 'e4', 'e6', 'e7', 'e8', 'f1e2'],
  })
})

test('one look reads a bounded number of blocks, and a page without any reads none', async () => {
  const long = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => `- textbox [ref=e${i + 1}]`).join('\n')
  let reads = 0
  const read = async () => {
    reads++
    return 'Atlas'
  }
  const filled = await addEditableText(long, read)
  const plain = '- heading "Atlas" [level=1] [ref=e1]\n- button "Save" [ref=e2]'
  const untouched = await addEditableText(plain, read)
  assert({
    given: 'a document with one block more than the bound, then a page with no blocks',
    should: 'read the first blocks only, and leave the plain page as it was',
    actual: [reads, filled.split('\n').at(-1), untouched],
    expected: [MAX_BLOCKS, `- textbox [ref=e${MAX_BLOCKS + 1}]`, plain],
  })
})
