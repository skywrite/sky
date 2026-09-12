import { assert, test } from '#test'
import { isSlackAttachmentPath, relocateSlackFileLinks } from './files.ts'

test('Relocating Slack originals edits destinations without changing notes or examples', () => {
  const markdown =
    '# Atlas\r\n\r\n`[Original](report.pdf)`\r\n\r\n```md\r\n[Original](report.pdf)\r\n```\r\n\r\n## Attachments\r\n\r\n### report.pdf\r\n\r\n[Original](report.pdf)\r\n\r\nKeep this summary. [Download][original]\r\n\r\n[original]: report.pdf "Title"\r\n'
  const updated = relocateSlackFileLinks(markdown, new Map([['report.pdf', 'atlas-follow/report.pdf']]))
  assert({
    given: 'inline links, reference links, a summary, and Markdown examples with CRLF line endings',
    should: 'change only the real destinations',
    actual: updated,
    expected: markdown
      .replace(
        '### report.pdf\r\n\r\n[Original](report.pdf)',
        '### report.pdf\r\n\r\n[Original](atlas-follow/report.pdf)',
      )
      .replace('[original]: report.pdf', '[original]: atlas-follow/report.pdf'),
  })
  assert({
    given: 'an already relocated document',
    should: 'be unchanged on retry',
    actual: relocateSlackFileLinks(updated, new Map([['report.pdf', 'atlas-follow/report.pdf']])),
    expected: updated,
  })
})

test('Slack attachment paths allow folders without allowing traversal or remote locations', () => {
  assert({
    given: 'day-relative files, a follow folder, and unsafe paths',
    should: 'accept only local relative paths',
    actual: [
      'report.pdf',
      'atlas-follow/report [1].pdf',
      '../report.pdf',
      '/report.pdf',
      'atlas/../report.pdf',
      'https://example.com/report.pdf',
      'atlas\\report.pdf',
    ].map(isSlackAttachmentPath),
    expected: [true, true, false, false, false, false, false],
  })
})
