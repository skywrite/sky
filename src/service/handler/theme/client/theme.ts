import { createTheme, defaultVariantColorsResolver, Drawer, Modal, type VariantColorsResolver } from '@mantine/core'

/** Status and delivery retain their own palettes; ordinary actions use the shared slate and quiet tokens. */
const actionVariants: Record<string, { variant: string; color?: string }> = {
  warning: { variant: 'light', color: 'orange' },
  delivery: { variant: 'filled', color: 'indigo' },
}

const actionColors: VariantColorsResolver = (input) => {
  if (input.variant === 'primary') {
    return {
      background: 'var(--sky-action-primary)',
      hover: 'var(--sky-action-primary-hover)',
      color: 'var(--sky-action-primary-text)',
      hoverColor: 'var(--sky-action-primary-text)',
      border: 'transparent',
    }
  }
  if (input.variant === 'secondary' || input.variant === 'primary-quiet') {
    return {
      background: 'transparent',
      hover: 'var(--sky-action-quiet-hover)',
      color: 'var(--sky-text-2)',
      hoverColor: input.variant === 'primary-quiet' ? 'var(--sky-accent)' : 'var(--sky-text)',
      border: 'transparent',
    }
  }
  if (input.variant === 'danger' || input.variant === 'danger-quiet') {
    return {
      background: input.variant === 'danger' ? 'var(--sky-action-danger-soft)' : 'transparent',
      hover: 'var(--sky-action-danger-hover)',
      color: 'var(--sky-action-danger)',
      hoverColor: 'var(--sky-action-danger)',
      border: 'transparent',
    }
  }
  const role = Object.hasOwn(actionVariants, input.variant) ? actionVariants[input.variant] : undefined
  return defaultVariantColorsResolver(
    role
      ? {
          ...input,
          variant: role.variant,
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
  close: 'sky-dialog-close',
  overlay: 'sky-dialog-overlay',
}

/**
 * Sky's shared controls. Color roles apply to buttons and icon buttons alike.
 *
 * Scale: the app HTML sets `html { font-size: 112.5% }` (18px base), which
 * grows every rem-based Mantine size uniformly. Do NOT set `theme.scale` to
 * compensate — bigger elements are the point.
 *
 * Buttons use action roles instead of repeating a palette and
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
      defaultProps: { variant: 'secondary', color: 'gray', size: 'md', loaderProps: { size: '1.1em' } },
      classNames: { root: 'sky-button' },
    },
    ActionIcon: {
      defaultProps: { variant: 'secondary', color: 'gray', size: 'xl', radius: 'md' },
      classNames: { root: 'sky-action-icon', loader: 'sky-action-icon-loader' },
    },
    Modal: Modal.extend({
      defaultProps: {
        padding: 'var(--sky-dialog-padding)',
        radius: 'var(--sky-dialog-radius)',
        shadow: 'var(--sky-dialog-shadow)',
        overlayProps: { backgroundOpacity: 0.15, blur: 5 },
      },
      classNames: dialogClasses,
    }),
    Drawer: Drawer.extend({
      defaultProps: {
        padding: 'var(--sky-dialog-padding)',
        radius: 'var(--sky-sheet-radius)',
        shadow: 'var(--sky-dialog-shadow)',
        overlayProps: { backgroundOpacity: 0.15, blur: 5 },
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
