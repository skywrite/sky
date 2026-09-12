import { assert, test } from '#test'
import { validateDrawingSize } from './drawingSize.ts'

test('Drawing sizes retain small native grids, arbitrary aspect ratios and their separate canvas budget', () => {
  const sizes = ['auto', '1x1', '64x64', '63x65', '8192x1', '1x8192', '4096x4096', '8192x2048']
  assert({
    given: 'native icons, non-grid sizes, extreme aspect ratios and exact drawing pixel-budget boundaries',
    should: 'accept dimensions independently of Image API minimum area and grid restrictions',
    actual: sizes.map(validateDrawingSize),
    expected: sizes.map(() => null),
  })
})

test('Drawing size errors distinguish malformed dimensions, invalid edges and excessive area', () => {
  assert({
    given: 'malformed input, zero, oversized edges, unsafe numbers and canvases over the drawing pixel budget',
    should: 'return useful errors before drawing allocation or planning',
    actual: [
      ['64', '64.5x64', '-1x64', '64X64', '64x64px', ''].every((size) =>
        validateDrawingSize(size)?.includes('WIDTHxHEIGHT'),
      ),
      ['0x64', '64x0', '8193x1', '1x8193', '999999999999999999999999x1'].every((size) =>
        validateDrawingSize(size)?.includes('1 to 8192'),
      ),
      ['8192x2049', '4097x4096', '8192x8192'].every((size) => validateDrawingSize(size)?.includes('16,777,216 pixels')),
    ],
    expected: [true, true, true],
  })
})
