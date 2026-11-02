import { assert, test } from '#test'
import { groupVideoFiles, videoTranscriptPair } from './importFiles.ts'

test('video selections pair matching sidecars without losing files or guessing between alternatives', () => {
  const files = [
    'Atlas-11111111111111111111111111111111.mp4',
    'Atlas-11111111111111111111111111111111.srt',
    'Demo-22222222222222222222222222222222.txt',
    'Demo-22222222222222222222222222222222.mp4',
    'extra.pdf',
  ].map((name) => ({ name }))
  const groups = groupVideoFiles(files)
  assert({
    given: 'two video/transcript pairs and an unrelated document',
    should: 'keep each recording with its own transcript first',
    actual: groups.map((group) => group.map((file) => file.name)),
    expected: [[files[1].name, files[0].name], [files[2].name, files[3].name], [files[4].name]],
  })
  assert({
    given: 'conflicting Loom IDs',
    should: 'refuse to pair recordings from different sources',
    actual: videoTranscriptPair([files[0], files[2]]),
    expected: null,
  })
  const ambiguous = [...files.slice(0, 2), { name: 'Atlas-11111111111111111111111111111111.txt' }]
  assert({
    given: 'two possible transcripts for one recording',
    should: 'leave the choice explicit while retaining every file',
    actual: groupVideoFiles(ambiguous).map((group) => group.length),
    expected: [1, 1, 1],
  })
})
