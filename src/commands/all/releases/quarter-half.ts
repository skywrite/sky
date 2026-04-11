import { Command, CommandResult } from '#commands/mod.ts'
import colors from 'picocolors'
import stripAnsi from 'strip-ansi'
import * as sys from '#lib/sys/mod.ts'
import { daysOfQuarter } from '#universal/dates/mod.ts'
import dateToDayOfWeekIndex from './lib/dateToDayOfWeekIndex.ts'
import MonthBuffer from './lib/MonthBuffer.ts'
import { isReleaseDay } from '#universal/dates/delivery/mod.ts'
import { YEAR } from './lib/_releases-config.ts'
import { bgCyanWhiteBold } from './lib/colors.ts'
import padCenter from '#lib/string/padCenter.ts'

const quarter = parseInt(sys.parsedArgs._[0] as string) || 1
const SHOW_PLANNING = sys.parsedArgs.planning

function createQuarterHeader(ndx: number): string {
  if (ndx === 0) return `Q${quarter}A`
  if (ndx === 1) return `Q${quarter}B`
  if (ndx === 2) return `PLANNING`
  return '<unknown>' // shouldn't hit this condition
}

export default function task(): CommandResult {
  const splits = getQuarterSplits(YEAR, quarter)
  const mbsSplits = quarterSplitsToMonthBuffers(splits)

  if (!SHOW_PLANNING) mbsSplits.pop() // cut-off last part of the quarter

  const buffers: string[][] = []
  mbsSplits.forEach((mbs: MonthBuffer[]) => {
    buffers.push(joinMonthBuffers(mbs))
  })

  const sep = ' ' + colors.bgYellow(' ') + ' '
  const lines = Array(10).fill('')

  // lines[0] is for quarter headers, lines[1] is the space
  // lienes[2] through lines[9] is for actual months

  buffers.forEach((bufferLines: string[], i: number) => {
    const headerLen = stripAnsi(bufferLines[0]).length // measure month headers
    const headerText = createQuarterHeader(i)
    lines[0] = lines[0] + bgCyanWhiteBold(padCenter(headerText, headerLen)) + sep
    bufferLines.forEach((line: string, x: number) => {
      lines[x + 2] = lines[x + 2] + line + sep // offset by 2 for quarter header + space
      // if (i === buffers.length - 1) lines[x] += sep
    })
  })

  console.log('\n')

  lines.forEach((line) => {
    console.log(line)
  })

  console.log('')

  return CommandResult.success()
}

function joinMonthBuffers(mbs: MonthBuffer[]): string[] {
  const headers = Array(2).fill('')
  const body = Array(6).fill('')
  const sep = '  '

  mbs.forEach((mb: MonthBuffer, _i: number) => {
    mb.headerLines.forEach((line: string, x: number) => {
      headers[x] = headers[x] + line + sep
    })

    mb.arrLines.forEach((lineData: string[], x: number) => {
      body[x] = body[x] + lineData.join('') + sep
    })
  })

  // cut off last sep
  let lines = headers.concat(body)
  lines = lines.map((line) => line.replace(new RegExp(sep + '$'), ''))

  return lines
}

function getQuarterSplits(year: number, quarter: number): Date[][] {
  const splits: Date[][] = []
  const splitReleases = 3
  const daysInQuarter = daysOfQuarter(year, quarter)

  let releaseCounter = 0
  let currentSplit: Date[] = []
  splits.push(currentSplit)

  while (daysInQuarter.length > 0) {
    const day = daysInQuarter.shift()
    if (!day) break // fucking typescript

    const dayOfWeekNdx = dateToDayOfWeekIndex(day)
    currentSplit.push(day)

    if (isReleaseDay(day)) releaseCounter += 1

    if (releaseCounter === splitReleases && dayOfWeekNdx === 6) {
      currentSplit = []
      splits.push(currentSplit)
      releaseCounter = 0
    }
  }

  return splits
}

function quarterSplitsToMonthBuffers(dateSplits: Date[][]): MonthBuffer[][] {
  const mbsSplits: MonthBuffer[][] = []

  dateSplits.forEach((split: Date[]) => {
    let month = -1
    const currentSplit: MonthBuffer[] = []
    mbsSplits.push(currentSplit)
    let currentMb: MonthBuffer
    split.forEach((day: Date) => {
      if (day.getMonth() !== month) {
        month = day.getMonth()
        currentMb = new MonthBuffer(day.getFullYear(), month)
        currentSplit.push(currentMb)
      }

      currentMb.addDate(day)
    })
  })

  return mbsSplits
}

task()
