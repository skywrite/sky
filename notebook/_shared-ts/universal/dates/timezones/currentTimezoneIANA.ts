export default function currentTimezoneIANA(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
