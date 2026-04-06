export interface DateObject {
  year?: string
  month?: string
  day?: string
}

export default function objectToDate(obj: DateObject): Date {
  const year = parseInt(<string>obj.year) || new Date().getFullYear()
  const month = parseInt(<string>obj.month) - 1 || new Date().getMonth()
  const day = parseInt(<string>obj.day) || new Date().getDate()

  return new Date(year, month, day)
}
