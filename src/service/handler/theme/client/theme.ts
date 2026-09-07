import { createTheme, defaultVariantColorsResolver, Drawer, Modal, type VariantColorsResolver } from '@mantine/core'

/** Button and ActionIcon roles. Primary follows primaryColor; status and delivery keep their own meaning. */
const actionVariants: Record<string, { variant: string; color?: string }> = {
  primary: { variant: 'light' },
  secondary: { variant: 'subtle', color: 'gray' },
  danger: { variant: 'light', color: 'red' },
  warning: { variant: 'light', color: 'orange' },
  delivery: { variant: 'filled', color: 'indigo' },
}

const actionColors: VariantColorsResolver = (input) => {
  const name =
    input.variant === 'primary-quiet' ? 'primary' : input.variant === 'danger-quiet' ? 'danger' : input.variant
  const role = Object.hasOwn(actionVariants, name) ? actionVariants[name] : undefined
  return defaultVariantColorsResolver(
    role
      ? {
          ...input,
          variant: name === input.variant ? role.variant : 'subtle',
          color: role.color ?? input.theme.primaryColor,
        }
      : input,
  )
}

const dialogClasses = {
  content: 'sky-dialog-content',
  header: 'sky-dialog-header',
  title: 'sky-dialog-title',
  body: 'sky-dialog-body',
}

/**
 * The sky theme — the v4.5 design contract as a Mantine theme.
 *
 * Scale: the app HTML sets `html { font-size: 112.5% }` (18px base), which
 * grows every rem-based Mantine size uniformly. Do NOT set `theme.scale` to
 * compensate — bigger elements are the point.
 *
 * Buttons use roles from actionVariants instead of repeating a palette and
 * appearance at each call site. Built-in Mantine variants remain available
 * for controls such as neutral toggles and the sidebar's New chat button.
 */
export const skyTheme = createTheme({
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontFamilyMonospace: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  primaryColor: 'blue',
  variantColorResolver: actionColors,
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
      defaultProps: { variant: 'secondary', color: 'gray', size: 'md' },
    },
    ActionIcon: {
      defaultProps: { variant: 'secondary', color: 'gray', size: 'xl', radius: 'lg' },
    },
    Modal: Modal.extend({
      defaultProps: {
        padding: 'var(--sky-dialog-padding)',
        radius: 'var(--sky-dialog-radius)',
        shadow: 'var(--sky-dialog-shadow)',
      },
      classNames: dialogClasses,
    }),
    Drawer: Drawer.extend({
      defaultProps: {
        padding: 'var(--sky-dialog-padding)',
        radius: 'var(--sky-sheet-radius)',
        shadow: 'var(--sky-dialog-shadow)',
      },
      classNames: (_, props) => ({
        ...dialogClasses,
        root: props.position === 'bottom' ? 'sky-dialog-sheet' : undefined,
      }),
    }),
    Checkbox: {
      defaultProps: { size: 'md', radius: 'sm' },
    },
    Textarea: {
      defaultProps: { size: 'md', radius: 'md' },
    },
  },
})
