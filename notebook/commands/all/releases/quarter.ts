import colors from 'picocolors'
import { bgCyanWhiteBold } from './lib/colors.ts'
import stripAnsi from 'strip-ansi'
import * as sys from '#lib/sys/mod.ts'
import { daysOfMonth } from '#universal/dates/mod.ts'
import { padCenter } from '#lib/string/mod.ts'
import expandQuarterToMonths from './lib/expandQuarterToMonths.ts'
import MonthBuffer from './lib/MonthBuffer.ts'
import { YEAR } from './lib/_releases-config.ts'

const quarter = parseInt(sys.parsedArgs._[0] as string) || 1

function task() {
  const months = expandQuarterToMonths(quarter)
  const mbs = Array(months.length)

  months.forEach((month, i) => {
    const mb = new MonthBuffer(YEAR, month)
    mbs[i] = mb

    const daysInMonth = daysOfMonth(YEAR, month)
    daysInMonth.forEach((day) => {
      mb.addDate(day)
    })
  })

  const headers = Array(2).fill('')
  const body = Array(6).fill('')
  const sep = '  ' + colors.bgYellow(' ') + '  '

  mbs.forEach((mb: MonthBuffer, i: number) => {
    mb.headerLines.forEach((line: string, x: number) => {
      headers[x] = headers[x] + sep + line

      if (i === mbs.length - 1) headers[x] += sep
    })

    mb.arrLines.forEach((lineData: string[], x: number) => {
      body[x] = body[x] + sep + lineData.join('')

      if (i === mbs.length - 1) body[x] += sep
    })
  })

  console.log('\n')

  // print master header
  const len = stripAnsi(headers[0]).length
  const text = `${YEAR} Q${quarter}`
  console.log(bgCyanWhiteBold(padCenter(text, len)))
  console.log('')

  headers.forEach((line) => {
    console.log(line)
  })

  body.forEach((line) => {
    console.log(line)
  })

  console.log('\n')
}

task()
