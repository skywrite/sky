import dayDir from '../dayDir.ts'
import dayFile from '../dayFile.ts'
import parseDateFromDayPath from '../parseDateFromDayPath.ts'
import parseTimePath from '../parseTimePath.ts'
import weekDir from '../weekDir.ts'
import type { NbfsLayout } from './types.ts'

/**
 * v1.1 - the layout existing notebooks speak: a month container (month of
 * the week's first day) holding DD-DD week ranges, with MM-DD day dirs.
 * The implementation stays in the sibling modules it has always lived in;
 * this wraps them as a selectable layout.
 */
const v1_1: NbfsLayout = {
  pattern: 'YYYY/MM/DD-DD/MM-DD',
  weekDir,
  dayDir,
  dayFile,
  parseDateFromDayPath,
  parseTimePath,
}

export default v1_1
