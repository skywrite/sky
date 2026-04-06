export default function padCenter(str = '', len = 0): string {
  return str.padStart((str.length + len) / 2, ' ').padEnd(len, ' ')
}
