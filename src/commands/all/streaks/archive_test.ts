import * as path from 'node:path'
import { outputFile, readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import StreakDocument from '#shared/models/Streak/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { withDayNotebook } from '../day/_testNotebook.ts'
import ArchiveStreak from './archive.ts'

for (const override of [undefined, 'Personal'] as const) {
  test(`streaks:archive uses ${override ? 'an explicit category override' : 'the saved category'}`, async () => {
    await withDayNotebook(async (notebook) => {
      const { config, notebookNow } = notebook.context
      const today = notebookNow.plainDateTime.plainDate
      const file = path.join(config.DIR_TIME, dayFile(today))
      await outputFile(file, DayDocument.createFutureDay(today).toMarkdown())
      await outputFile(
        path.join(config.DIR_STREAKS, 'active/read-a-chapter.md'),
        StreakDocument.create({
          name: 'read-a-chapter',
          title: 'Read a chapter',
          category: 'Professional',
          start: today,
        }).toMarkdown(),
      )
      await new ArchiveStreak().run({ ...notebook, args: { name: 'read-a-chapter', category: override } })
      const category = override ?? 'Professional'
      assert({
        given: override ? 'an explicit correction while archiving' : 'an existing saved category',
        should: 'persist the chosen category and file the archive in its Complete list',
        actual: [
          StreakDocument.fromMarkdown(await readTextFile(path.join(config.DIR_STREAKS, 'archived/read-a-chapter.md')))
            .category,
          DayDocument.fromMarkdown(await readTextFile(file)).lists.find((list) => list.title === `${category} Complete`)
            ?.items,
        ],
        expected: [category, ['08:00 > streaks/read-a-chapter -> Archived | Read a chapter']],
      })
    })
  })
}
