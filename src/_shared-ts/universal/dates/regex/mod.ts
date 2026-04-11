export const REGEX_HHMM_EXACT = /^(?<hour>[01]?\d|2[0-3]):(?<minute>[0-5]?\d)$/

export const REGEX_HHMM25_EXACT = /^(?<hour>0?\d|[1-9]\d):(?<minute>[0-5]?\d)$/
// export const REGEX_HHMM25_SUBSTR = /.*?(?<hour>0?\d|[1-9]\d):(?<minute>[0-5]?\d).*/

// consider renaming to include YYYYMMDD so it's obvious
export const REGEX_YMD_EXACT = /^(?<year>\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12][0-9]|3[01])$/
export const REGEX_YMD_SUBSTR = /.*(?<year>\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12][0-9]|3[01]).*/

export const REGEX_YM_EXACT = /^(?<year>\d{4})-(?<month>0[1-9]|1[0-2])$/

export const REGEX_MMDD_SUBSTR = /.*(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12][0-9]|3[01]).*/

export const REGEX_DD_SUBSTR = /.*(?<day>0[1-9]|[12][0-9]|3[01]).*/

// use this with exec and post - see util:desktop-rename
// buggy... don't use
export const REGEX_YMD_POS = /(?<year>\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12][0-9]|3[01])/g
