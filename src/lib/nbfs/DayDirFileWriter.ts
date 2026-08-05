import * as path from 'node:path'
import { DIR_TIME } from '#config'
import { pathNoExt } from '#lib/path/mod.ts'
import { exists, outputFile } from '#shared/fs/mod.ts'
import dayDir from '#shared/nbfs/dayDir.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

export default class DayDirFileWriter {
  private _timeDir = DIR_TIME
  private _day: PlainDate
  private _dayDir: string
  private _fullDir: string

  constructor(day: PlainDate, timeDir = DIR_TIME) {
    this._day = day
    this._timeDir = timeDir
    this._dayDir = dayDir(day)
    this._fullDir = path.join(this._timeDir, this._dayDir)
  }

  get day(): PlainDate {
    return this._day
  }

  get dayDir(): string {
    return this._dayDir
  }

  get fullDir(): string {
    return this._fullDir
  }

  get timeDir(): string {
    return this._timeDir
  }

  async write(fileName: string, contents: string): Promise<string> {
    let fileWithDir = path.join(this._fullDir, fileName)
    let count = 1
    while (await exists(fileWithDir)) {
      count += 1
      const fileBase = pathNoExt(fileName)
      const ext = path.extname(fileName)
      const newFile = `${fileBase}-${count}${ext}`
      fileWithDir = path.join(this._fullDir, newFile)
    }

    await outputFile(fileWithDir, contents)

    return path.relative(this._fullDir, fileWithDir)
  }
}
