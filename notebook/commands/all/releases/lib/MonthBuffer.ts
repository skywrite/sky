import { bgMagentaWhiteBold } from './colors.ts'
import formatDay from './formatDay.ts'
import { padCenter } from '#lib/string/mod.ts'
import { WEEKDAY_HEADER } from './days.ts'
import { PAD_LEN } from './_releases-config.ts'
import dateToDayOfWeekIndex from './dateToDayOfWeekIndex.ts'

const createWeekArr = () => Array(7).fill(''.padStart(PAD_LEN, ' '))

export default class MonthBuffer {
  public dates: Date[] = []
  public headerLines: string[] = []
  public arrLines: string[][] = []
  public year: number
  public jsMonth: number
  public monthShortStr: string

  private firstDayOfMonth: Date

  constructor(year: number, jsMonth: number) {
    this.year = year
    this.jsMonth = jsMonth

    this.firstDayOfMonth = new Date(year, jsMonth, 1)
    this.monthShortStr = this.firstDayOfMonth.toLocaleString('en-US', { month: 'short' })

    this.headerLines.push(bgMagentaWhiteBold(padCenter(this.monthShortStr, WEEKDAY_HEADER.length)))
    this.headerLines.push(WEEKDAY_HEADER)

    // make all months have at least 6 weeks
    // some actually span over 6 weeks
    // e.g. Jan of 2023
    for (let i = 0; i < 6; ++i) {
      this.arrLines.push(createWeekArr())
    }
  }

  addDate(day: Date): void {
    if (day.getFullYear() != this.year) console.warn(`${this.year} does not match ${day}`)
    if (day.getMonth() != this.jsMonth) console.warn(`${this.jsMonth} does not match ${day}`)

    const offset = dateToDayOfWeekIndex(this.firstDayOfMonth)
    const y = Math.floor((offset + day.getDate() - 1) / 7)
    const x = dateToDayOfWeekIndex(day)

    this.arrLines[y][x] = formatDay(day)
  }

  toString(): string {
    return `${this.year} ${this.monthShortStr}`
  }
}
