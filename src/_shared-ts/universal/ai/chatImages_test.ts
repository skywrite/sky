import { assert, test } from '#test'
import { imagesFromToolResult, splitChatImages, withChatImages } from './chatImages.ts'

const image = { name: 'Lighthouse [draft].png', url: '/chat/files/2026-01-27/lighthouse.png' }

test('Generated image links survive Markdown, deduplicate, and retain ordinary reply content', () => {
  const prose = 'Here is the lighthouse.\n\n![External reference](https://example.com/reference.png)'
  const once = withChatImages(prose, [image, image])
  const twice = withChatImages(once, [image])
  assert({
    given: 'the host and model report the same image, including brackets in its name',
    should: 'retain one renderable image and preserve the rest of the reply',
    actual: [twice === once, splitChatImages(twice)],
    expected: [true, { text: prose, images: [image] }],
  })
})

test('Only successful results with local chat image URLs become previews', () => {
  const invalid = [
    { name: 'External', url: 'https://example.com/photo.png' },
    { name: 'Private file', url: 'file:///tmp/private.png' },
    { name: 'Traversal', url: '/chat/files/2026-01-27/../private.png' },
    { name: 'Script', url: 'javascript:alert(1)' },
    { name: '', url: image.url },
  ]
  assert({
    given: 'failed results and untrusted artifact URLs',
    should: 'show only validated results from the successful tool',
    actual: [
      imagesFromToolResult({ success: false, imageArtifacts: [image] }),
      imagesFromToolResult({ success: true, imageArtifacts: [...invalid, image] }),
    ],
    expected: [[], [image]],
  })
})
