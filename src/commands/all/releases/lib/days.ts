import { PAD_LEN } from './_releases-config.ts'

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
export default DAYS

export const WEEKDAY_HEADER = DAYS.map((d) => d.padEnd(PAD_LEN)).join('')
