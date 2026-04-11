import { DIR_TIME } from '#config'
import * as path from 'node:path'
import outputFile from '#shared/fs/outputFile.ts'
import DayDocument from '#shared/models/Day/mod.ts'

import dayFile from './dayFile.ts'

export default async function writeDay(day: DayDocument, timeDir = DIR_TIME): Promise<void> {
  const file = path.join(timeDir, dayFile(day.day))
  await outputFile(file, day.toMarkdown())
}
