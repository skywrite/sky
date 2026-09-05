import { assert, test } from '#test'
import { entriesOf, filesRouteOf, holdsLine, removedLine, shortLabel, shortName } from './dayFiles.tsx'
import { type DayListing, filesHref } from './files.tsx'

const listing: DayListing = {
  path: '',
  label: 'Thursday, September 3, 2026',
  folders: [{ name: 'photos', files: 12, size: 30 * 1024 * 1024, modified: '2026-09-03T10:00:00.000Z' }],
  files: [
    { name: 'a.pdf', size: 2 * 1024 * 1024, modified: '2026-09-03T10:00:00.000Z', kind: 'pdf' },
    { name: 'b.png', size: 512 * 1024, modified: '2026-09-03T10:00:00.000Z', kind: 'image' },
  ],
}

test({ name: 'day files page - the route is the day and the folder open in it' }, () => {
  assert({
    given: "the day's files, a folder two deep with an encoded space, and other pages",
    should: 'name the day and the folder, and nothing for the rest',
    actual: [
      filesRouteOf('/2026-09-03/files'),
      filesRouteOf('/2026-09-03/files/photos/raw%20shots'),
      filesRouteOf('/2026-09-03'),
      filesRouteOf('/explorer/time/x.md'),
    ],
    expected: [{ ymd: '2026-09-03', folder: '' }, { ymd: '2026-09-03', folder: 'photos/raw shots' }, null, null],
  })
  assert({
    given: 'a folder with a space',
    should: 'write the page path the route reads back',
    actual: filesRouteOf(filesHref('2026-09-03', 'photos/raw shots')),
    expected: { ymd: '2026-09-03', folder: 'photos/raw shots' },
  })
})

test({ name: 'day files page - rows are folders first, then files, each by its path' }, () => {
  assert({
    given: 'a listing of one folder and two files inside a folder',
    should: 'put the folder first and path every row under the folder open',
    actual: entriesOf({ ...listing, path: 'sets' }).map((e) => [e.path, e.folder]),
    expected: [
      ['sets/photos', true],
      ['sets/a.pdf', false],
      ['sets/b.png', false],
    ],
  })
})

test({ name: 'day files page - the page says what it holds, folders counted through in the bytes' }, () => {
  assert({
    given: 'two files and a folder of thirty megabytes',
    should: 'count the files and the folder and add the bytes together',
    actual: [
      holdsLine(listing),
      holdsLine({ ...listing, folders: [] }),
      holdsLine({ ...listing, files: [], folders: [] }),
    ],
    expected: ['2 files, 1 folder · 32.5 MB', '2 files · 2.5 MB', '0 files'],
  })
})

test({ name: 'day files page - the toast says what went to the Trash' }, () => {
  const file = { path: 'a.pdf', name: 'a.pdf', folder: false, files: 1, moveId: '1' }
  const folder = { path: 'photos', name: 'photos', folder: true, files: 12, moveId: '2' }
  const empty = { ...folder, name: 'empty', files: 0 }
  assert({
    given: 'one file, one folder with files, an empty folder, and a batch of both',
    should: 'name the one, count what a folder takes with it, and sum a batch',
    actual: [removedLine([file]), removedLine([folder]), removedLine([empty]), removedLine([file, folder, file])],
    expected: [
      'Moved “a.pdf” to the Trash',
      'Moved “photos” and its 12 files to the Trash',
      'Moved “empty” to the Trash',
      'Moved 1 folder and 2 files to the Trash',
    ],
  })
})

test({ name: 'day files page - a narrow crumb gets a short day, a toast a shortened name' }, () => {
  assert({
    given: 'a day, a short name and a long one',
    should: 'write the weekday and date short, keep the short name, and fold the long one in the middle',
    actual: [
      shortLabel('2026-09-03'),
      shortName('a.pdf'),
      shortName('2026-09-03_Slack_transactions_2026-08-30.parquet'),
    ],
    expected: ['Thu, Sep 3', 'a.pdf', '2026-09-03_Slack_tran…ns_2026-08-30.parquet'],
  })
})
