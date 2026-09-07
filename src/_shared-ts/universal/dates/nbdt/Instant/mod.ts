/** Exact moments from external event streams, including seconds and fractions. */
type Instant = Temporal.Instant

// Resolve Temporal only when used: the shared barrel also loads in editor hosts.
const Instant = {
  from(value: string): Instant {
    return Temporal.Instant.from(value)
  },
  fromEpochMilliseconds(value: number): Instant {
    return Temporal.Instant.fromEpochMilliseconds(value)
  },
  compare(a: Instant, b: Instant): number {
    return Temporal.Instant.compare(a, b)
  },
}

export default Instant
