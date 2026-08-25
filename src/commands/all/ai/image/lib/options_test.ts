import { assert, test } from '#test'
import { parseRefs, validateBackground, validateQuality, validateSize } from './options.ts'

test('validateSize', () => {
  assert({
    given: 'a popular landscape size',
    should: 'accept it',
    expected: null,
    actual: validateSize('1536x1024'),
  })

  assert({
    given: 'the 4K ceiling size',
    should: 'accept it',
    expected: null,
    actual: validateSize('3840x2160'),
  })

  assert({
    given: 'the minimum-area size',
    should: 'accept it',
    expected: null,
    actual: validateSize('1024x640'),
  })

  assert({
    given: 'a word instead of dimensions (auto is expressed by omitting size)',
    should: 'name the expected format',
    expected: true,
    actual: (validateSize('auto') ?? '').includes('WIDTHxHEIGHT'),
  })

  assert({
    given: 'edges not divisible by 16',
    should: 'reject with the multiple rule',
    expected: true,
    actual: (validateSize('1000x1000') ?? '').includes('multiples of 16'),
  })

  assert({
    given: 'an edge past 3840',
    should: 'reject with the edge ceiling',
    expected: true,
    actual: (validateSize('4096x2160') ?? '').includes('at most 3840'),
  })

  assert({
    given: 'an aspect ratio past 3:1',
    should: 'reject with the aspect rule',
    expected: true,
    actual: (validateSize('3840x1024') ?? '').includes('aspect ratio'),
  })

  assert({
    given: 'a size under the pixel floor',
    should: 'reject as too small',
    expected: true,
    actual: (validateSize('512x512') ?? '').includes('too small'),
  })

  assert({
    given: 'a size over the pixel ceiling despite legal edges',
    should: 'reject as too large',
    expected: true,
    actual: (validateSize('3840x2560') ?? '').includes('too large'),
  })
})

test('validateQuality', () => {
  assert({
    given: 'a supported quality',
    should: 'accept it',
    expected: null,
    actual: validateQuality('high'),
  })

  assert({
    given: 'an unknown quality',
    should: 'list the supported ones',
    expected: true,
    actual: (validateQuality('ultra') ?? '').includes('low, medium, high, auto'),
  })
})

test('validateBackground', () => {
  assert({
    given: 'a supported background',
    should: 'accept it',
    expected: null,
    actual: validateBackground('transparent'),
  })

  assert({
    given: 'an unknown background',
    should: 'list the supported ones',
    expected: true,
    actual: (validateBackground('clear') ?? '').includes('transparent, opaque, auto'),
  })
})

test('parseRefs', () => {
  assert({
    given: 'a comma-separated list with stray whitespace',
    should: 'split into trimmed paths',
    expected: ['~/Pictures/lighthouse.png', '/tmp/logo.webp'],
    actual: parseRefs(' ~/Pictures/lighthouse.png , /tmp/logo.webp '),
  })

  assert({
    given: 'empty segments from trailing commas',
    should: 'drop them',
    expected: ['a.png'],
    actual: parseRefs('a.png,,'),
  })
})
