import { niceStep } from '../tracking/trackingScale.ts'

export interface ChartRange {
  low: number
  high: number
  ticks: number[]
}

const round = (value: number) => Number(value.toPrecision(12))

/** A range of round numbers that holds every value drawn, with a little air above and below. */
export function chartRange(values: number[]): ChartRange {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || Math.abs(max) * 0.1 || 1
  const step = niceStep(span * 1.1)
  const low = round(Math.floor((min - span * 0.05) / step) * step)
  const high = round(Math.ceil((max + span * 0.05) / step) * step)
  const ticks: number[] = []
  for (let tick = low; tick <= high + step / 2; tick = round(tick + step)) ticks.push(tick)
  return { low, high, ticks }
}
