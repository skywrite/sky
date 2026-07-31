import { assert, test } from '#test'
import { validateSvgSource } from './svgToPng.ts'

const GOOD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#101418"/><stop offset="1" stop-color="#1e3a5f"/></linearGradient></defs>
  <rect width="1920" height="1080" fill="url(#g)"/>
</svg>`

test('validateSvgSource', () => {
  assert({
    given: 'a self-contained gradient background',
    should: 'pass',
    expected: null,
    actual: validateSvgSource(GOOD_SVG),
  })

  assert({
    given: 'scripts, external fetches, foreignObject, junk and empty input',
    should: 'reject each with a named reason',
    expected: [true, true, true, true, true],
    actual: [
      (validateSvgSource('<svg><script>alert(1)</script></svg>') ?? '').includes('<script'),
      (validateSvgSource('<svg><image href="https://example.com/x.png"/></svg>') ?? '').includes('https://'),
      (validateSvgSource('<svg><foreignObject/></svg>') ?? '').includes('foreignobject'),
      (validateSvgSource('just text') ?? '').includes('<svg'),
      (validateSvgSource('  ') ?? '').includes('empty'),
    ],
  })
})
