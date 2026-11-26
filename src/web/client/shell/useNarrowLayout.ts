import { useMediaQuery } from '@mantine/hooks'

/** The narrow layout, where the sidebar gives way to the bar at the bottom. The stylesheets share the 900px line. */
export const NARROW_LAYOUT = '(max-width: 900px)'

/** True on a phone or a narrow window. Read on the first render, so a phone never paints the desktop shell. */
export function useNarrowLayout(): boolean {
  return useMediaQuery(NARROW_LAYOUT, undefined, { getInitialValueInEffect: false })
}
