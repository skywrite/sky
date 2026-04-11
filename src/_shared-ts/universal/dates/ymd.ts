export default function YMD(date = new Date()): Array<string> {
  const year = date.getFullYear().toString()
  const month = ('0' + (1 + date.getMonth())).slice(-2)
  const day = ('0' + date.getDate()).slice(-2)

  return [year, month, day]
}
