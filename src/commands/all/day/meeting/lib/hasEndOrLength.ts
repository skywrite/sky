// `when:` values carry a duration as a range or a length, or not at all:
// "2026-08-10 15:45 - 16:30", "2026-08-06 08:00 20m", "2026-08-10 15:45".
const RANGE = / - /
const LENGTH = /\s\d+(\.\d+)?[mh]\b/

/** Whether a raw `when:` value states an end time or a length. */
export default function hasEndOrLength(when: string): boolean {
  return RANGE.test(when) || LENGTH.test(when)
}
