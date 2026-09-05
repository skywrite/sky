import { createTheme } from '@mantine/core'

/**
 * The sky theme — the v4.5 design contract as a Mantine theme.
 *
 * Scale: the app HTML sets `html { font-size: 112.5% }` (18px base), which
 * grows every rem-based Mantine size uniformly. Do NOT set `theme.scale` to
 * compensate — bigger elements are the point.
 *
 * Buttons: secondary is the default (ghost). Most primary actions use the
 * soft blue `variant="light"`; the sidebar's New chat uses a neutral fill
 * and subtle border so it is recognizable as a button without dominating the page.
 */
export const skyTheme = createTheme({
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontFamilyMonospace: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  primaryColor: 'blue',
  defaultRadius: 'md',
  radius: {
    xs: '6px',
    sm: '8px',
    md: '11px',
    lg: '16px',
    xl: '18px',
  },
  components: {
    Button: {
      defaultProps: { variant: 'subtle', color: 'gray', size: 'md' },
    },
    ActionIcon: {
      defaultProps: { variant: 'subtle', color: 'gray', size: 'xl', radius: 'lg' },
    },
    Checkbox: {
      defaultProps: { size: 'md', radius: 'sm' },
    },
    Textarea: {
      defaultProps: { size: 'md', radius: 'md' },
    },
  },
})
