// TODO: bring these functions in with the others

export function toUTCDateString(date: Date): string {
  const isoStr = date.toISOString()
  const [ymd, hms] = isoStr.split(/T|\./)

  return `${ymd} ${hms} UTC`
}

export function shortTimeAMPMGMT(date: Date): string {
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat
  // @ts-ignore: timeZoneName is broken... expects 'short' or 'long' not 'shortOffset'
  const options: Intl.DateTimeFormatOptions = { timeZoneName: 'shortOffset', hour: 'numeric', minute: 'numeric' }
  return new Intl.DateTimeFormat('en-US', options).format(date)
}
