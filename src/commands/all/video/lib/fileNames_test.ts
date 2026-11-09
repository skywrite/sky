import { assert, test } from '#test'
import { videoAttachmentName, videoFileStem } from './fileNames.ts'

test('video filenames use the existing medium, person and summary convention', () => {
  assert({
    given: 'available speaker, recipient and summary metadata',
    should: 'produce descriptive names without a capture timestamp',
    actual: [
      videoFileStem({ medium: 'Loom', from: 'Jane Doe', to: 'Atlas Team', summary: 'API Review' }),
      videoFileStem({ medium: 'Loom', to: '#atlas-updates', summary: 'Release Planning' }),
      videoFileStem({ medium: 'Zoom', summary: 'Widget Demo' }),
      videoFileStem({ medium: 'Zoom Clip', from: 'Jane Doe', summary: 'API Review' }),
      videoFileStem({ medium: 'Loom' }),
    ],
    expected: [
      'Loom_Jane-Doe_API-Review',
      'Loom_atlas-updates_Release-Planning',
      'Zoom_Widget-Demo',
      'Zoom Clip_Jane-Doe_API-Review',
      'Loom_Recording',
    ],
  })
})

test('video attachments retain a day prefix without adding it twice to legacy names', () => {
  assert({
    given: 'a descriptive stem or an already dated legacy stem',
    should: 'keep the normal day-prefixed media and transcript names',
    actual: [
      videoAttachmentName('2031-04-05', 'Loom_Jane-Doe_API-Review', '.mp4'),
      videoAttachmentName('2031-04-05', 'Loom_Jane-Doe_API-Review', '.srt'),
      videoAttachmentName('2031-04-05', '2031-04-05_Loom_Jane-Doe_API-Review', '.vtt'),
    ],
    expected: [
      '2031-04-05_Loom_Jane-Doe_API-Review.mp4',
      '2031-04-05_Loom_Jane-Doe_API-Review.srt',
      '2031-04-05_Loom_Jane-Doe_API-Review.vtt',
    ],
  })
})
