import { assert, test } from '#test'
import { createWebTools } from '../chat/webTools.ts'

const PAGE = 'https://example.com/brand'
const html = (text: string) => new Response(text, { headers: { 'content-type': 'text/html' } })
const css = (text: string) => new Response(text, { headers: { 'content-type': 'text/css' } })

test('website colors retain exact source declarations and prioritize selectors in the requested page', async () => {
  const requests: string[] = []
  const tools = createWebTools({
    pageFetcher: async (url) => {
      requests.push(url)
      if (url === PAGE)
        return html(`
        <title>Atlas colors</title><link rel="stylesheet" href="/assets/theme.css">
        <style>.badge { border-color: #4af }</style>
        <div class="hero" style="--accent: oklch(65% .2 145)">Atlas</div>
        <span class="badge">Ready</span>`)
      return css(`
        /* .unused { color: #123456 } */
        .unused { color: #e00022; color: #e00022; color: #e00022; }
        @media (min-width: 800px) { .hero { background: linear-gradient(120deg, #18cf65, rgb(121 231 68 / var(--opacity, 1))); color: var(--green-tone); --shade: #38d8; background-image: url('/images/#abcdef.png'); } }
      `)
    },
  })
  const result = await tools.web_colors.execute({ url: PAGE })
  if (!result.ok) throw new Error(result.error)
  const accent = result.colors.find((entry) => entry.color === '#18CF65')
  assert({
    given: 'an HTML page with inline colors and a shared stylesheet containing a nested gradient and unused colors',
    should:
      'return exact declarations with provenance and preserve functional colors without inventing computed values',
    actual: {
      requests,
      title: result.title,
      colors: result.colors.map((entry) => entry.color),
      accent: accent?.declarations[0],
      partial: result.partial,
      computedDisclaimer: result.note.includes('not a computed or visible browser color'),
    },
    expected: {
      requests: [PAGE, 'https://example.com/assets/theme.css'],
      title: 'Atlas colors',
      colors: ['#4AF', 'oklch(65% .2 145)', '#18CF65', 'rgb(121 231 68 / var(--opacity, 1))', '#38D8', '#E00022'],
      accent: {
        source: 'https://example.com/assets/theme.css',
        selector: '.hero',
        property: 'background',
        value: 'linear-gradient(120deg, #18cf65, rgb(121 231 68 / var(--opacity, 1)))',
        matchesPage: true,
      },
      partial: false,
      computedDisclaimer: true,
    },
  })
})

test('website color lookup preserves inline results when linked stylesheets fail or point to private URLs', async () => {
  const requests: string[] = []
  const tools = createWebTools({
    pageFetcher: async (url) => {
      requests.push(url)
      return url === PAGE
        ? html(
            '<style>body { color: #1bce70 }</style><link rel="stylesheet" href="/missing.css"><link rel="stylesheet" href="http://127.0.0.1/private.css">',
          )
        : new Response('Unavailable', { status: 503 })
    },
  })
  const result = await tools.web_colors.execute({ url: PAGE })
  if (!result.ok) throw new Error(result.error)
  assert({
    given: 'one inline color, an unavailable stylesheet and a private stylesheet destination',
    should: 'return available evidence with explicit partial status and never fetch the private destination',
    actual: [requests, result.colors.map((entry) => entry.color), result.errors.length, result.partial],
    expected: [[PAGE, 'https://example.com/missing.css'], ['#1BCE70'], 2, true],
  })
})

test('website color lookup resolves stylesheet links against the final URL and HTML base', async () => {
  const requests: string[] = []
  const tools = createWebTools({
    pageFetcher: async (url) => {
      requests.push(url)
      if (url === PAGE) return new Response(null, { status: 302, headers: { location: '/final/index.html' } })
      if (url.endsWith('index.html'))
        return html('<base href="/theme/"><link REL="stylesheet alternate" href="colors.css"><p class="cash">Atlas</p>')
      return css('.cash{color:#0ad060}')
    },
  })
  const result = await tools.web_colors.execute({ url: PAGE })
  if (!result.ok) throw new Error(result.error)
  assert({
    given: 'a redirect and a relative stylesheet beneath an HTML base',
    should: 'read the actual linked source and retain its selector and final URL',
    actual: [requests, result.url, result.colors[0].declarations[0].matchesPage],
    expected: [
      [PAGE, 'https://example.com/final/index.html', 'https://example.com/theme/colors.css'],
      'https://example.com/final/index.html',
      true,
    ],
  })
})

test('website color lookup identifies uninspected imports and propagates cancellation', async () => {
  const tools = createWebTools({
    pageFetcher: async (url) =>
      url === PAGE
        ? html('<link rel="stylesheet" href="/colors.css"><div class="cash">Atlas</div>')
        : css('@import url("extra.css"); .cash{color:#00bf68}'),
  })
  const result = await tools.web_colors.execute({ url: PAGE })
  if (!result.ok) throw new Error(result.error)
  const controller = new AbortController()
  controller.abort(new Error('Stopped by user'))
  let stopped = ''
  try {
    await tools.web_colors.execute({ url: PAGE }, { abortSignal: controller.signal })
  } catch (error) {
    stopped = (error as Error).message
  }
  assert({
    given: 'an imported stylesheet that is not inspected and a cancelled lookup',
    should: 'mark coverage partial and stop the cancelled lookup',
    actual: [result.partial, result.colors[0].declarations[0].matchesPage, stopped],
    expected: [true, true, 'Stopped by user'],
  })
})
