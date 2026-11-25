const STEPS = [25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 5000]

/** The gap between the four gridlines of a chart whose tallest value is `peak`, as a round number. */
export function axisStep(peak: number): number {
  const found = STEPS.find((step) => step * 4 >= peak)
  return found ?? Math.ceil(peak / 4 / 5000) * 5000
}
