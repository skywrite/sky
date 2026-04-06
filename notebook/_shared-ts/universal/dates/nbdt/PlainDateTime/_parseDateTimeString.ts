import { YMD } from '#universal/dates/mod.ts'
import { expandToYMD } from '#universal/dates/mod.ts'
import formatTime from './_formatTime.ts'

function validateCharacters(input: string): boolean {
  const regex = /^[0-9- :]+$/
  return regex.test(input)
}

export default function _parseDateTimeString(dateTime: string): [string, string] {
  // Normalize ISO 8601 "T" separator to space
  const normalized = dateTime.replace('T', ' ')

  if (!validateCharacters(normalized)) {
    throw new Error(`"${dateTime}" contains invalid characters that cannot be parsed in _parseDateTimeString()`)
  }

  const parts = normalized.split(' ')

  // this moves the time to the first element
  // e.g: 10 13:45 becomes 13:45 10
  // or if it's just time
  // 13:45 is 13:45 regardless and a length of 1
  parts.reverse()

  switch (parts.length) {
    case 1:
      return parseTimeOrDate(parts[0])
    case 2:
      return parseTimeAndPartialDate(parts as [string, string])
    default:
      throw new Error(`_parseDateTimeString(): ${dateTime} not valid input.`)
  }
}

function parseTimeOrDate(timeOrDate: string): [string, string] {
  // only time
  if (timeOrDate.includes(':')) return parseOnlyTime(timeOrDate)
  // only date, no time
  if (timeOrDate.includes('-')) return [expandToYMD(timeOrDate), '00:00']
  // we have some other shit
  throw new Error(`parseTimeOrDate(): ${timeOrDate} not valid input.`)
}

function parseOnlyTime(onlyTime: string): [string, string] {
  const today = new Date()
  return [YMD(today).join('-'), formatTime(onlyTime)]
}

function parseTimeAndPartialDate([time, partialDate]: [string, string]): [string, string] {
  const date = expandToYMD(partialDate)

  let newTime = time
  // just has hours, missing the minutes component
  if (!time.includes(':')) {
    newTime = time + ':00'
  }

  return [date, formatTime(newTime)]
}
