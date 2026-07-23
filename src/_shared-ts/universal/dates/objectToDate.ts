export interface DateObject {
  year?: string
  month?: string
  day?: string
}

export default function objectToDate(obj: DateObject): Date {
  const year = parseInt(obj.year as string) || new Date().getFullYear()
  const month = parseInt(obj.month as string) - 1 || new Date().getMonth()
  const day = parseInt(obj.day as string) || new Date().getDate()

  return new Date(year, month, day)
}
