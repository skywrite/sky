export default function formatTime(time: string): string {
  if (!time.includes(':')) {
    console.warn(`DateTime#formatTime(): input ${time} does not include ':' returning '00:00'.`)
    return '00:00'
  }

  const [hours, minutes] = time.split(':').map(Number)

  let hoursStr = '00'
  if (Number.isNaN(hours)) {
    console.warn(`DateTime#formatTime(): input ${time} hours is NaN returning '00'.`)
  } else {
    hoursStr = String(hours).padStart(2, '0')
  }

  let minutesStr = '00'
  if (Number.isNaN(hours)) {
    console.warn(`DateTime#formatTime(): input ${time} minutes is NaN returning '00'.`)
  } else {
    minutesStr = String(minutes).padStart(2, '0')
  }

  return `${hoursStr}:${minutesStr}`
}
