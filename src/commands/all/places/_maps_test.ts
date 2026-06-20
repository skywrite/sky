import { assert, test } from '#test'
import { parseCoordsFromMapsUrl } from './_maps.ts'

const fmt = (coords: { latitude: number; longitude: number } | null) =>
  coords ? `${coords.latitude},${coords.longitude}` : 'null'

const fixtures = [
  {
    given: 'a dropped-pin /search/ URL (the maps.app.goo.gl form)',
    url: 'https://www.google.com/maps/search/48.85837,+2.294481?entry=tts&g_ep=Eg',
    expected: '48.85837,2.294481',
  },
  {
    given: 'a named place URL — prefer the !3d!4d pin over the @ viewport',
    url: 'https://www.google.com/maps/place/Somewhere/@51.5,-0.12,17z/data=!3m1!4b1!3d51.509865!4d-0.118092',
    expected: '51.509865,-0.118092',
  },
  {
    given: 'a URL with only an @ viewport center',
    url: 'https://www.google.com/maps/@40.689247,-74.044502,15z',
    expected: '40.689247,-74.044502',
  },
  {
    given: 'a ?q= coordinate query URL',
    url: 'https://maps.google.com/?q=35.6586,139.7454',
    expected: '35.6586,139.7454',
  },
]

for (const { given, url, expected } of fixtures) {
  test(`parseCoordsFromMapsUrl: ${given}`, () => {
    assert({
      given,
      should: `extract ${expected}`,
      actual: fmt(parseCoordsFromMapsUrl(url)),
      expected,
    })
  })
}

test('parseCoordsFromMapsUrl: returns null when no coordinates are present', () => {
  assert({
    given: 'a place URL with no coordinates',
    should: 'return null',
    actual: fmt(parseCoordsFromMapsUrl('https://www.google.com/maps/place/Big+Ben')),
    expected: 'null',
  })
})
