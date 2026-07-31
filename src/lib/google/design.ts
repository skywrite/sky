/**
 * Sky's slide design tokens. Decks are styled explicitly per element from
 * these values — never via theme masters — so output is consistent by
 * construction regardless of the account's default theme.
 */

export interface RgbColor {
  red: number
  green: number
  blue: number
}

/** #RRGGBB → Slides API rgbColor floats (3-decimal precision). */
export function hexToRgb01(hex: string): RgbColor {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!match) throw new Error(`Not a #RRGGBB color: ${hex}`)
  const value = Number.parseInt(match[1], 16)
  const to01 = (byte: number) => Math.round((byte / 255) * 1000) / 1000
  return { red: to01((value >> 16) & 0xff), green: to01((value >> 8) & 0xff), blue: to01(value & 0xff) }
}

export const EMU_PER_PT = 12700

export type SlideTheme = 'light' | 'dark' | 'warm'

type ColorRole = 'text' | 'mutedText' | 'accent' | 'background' | 'surface'

/** Per-theme color roles; fonts, sizes and geometry are theme-invariant. */
export const SLIDE_THEMES: Record<SlideTheme, Record<ColorRole, string>> = {
  light: {
    text: '#1B1F2A',
    mutedText: '#5C6470',
    accent: '#2557D6',
    background: '#FFFFFF',
    surface: '#F2F5FA',
  },
  dark: {
    text: '#F4F6FA',
    mutedText: '#9AA3B2',
    accent: '#6FA8FF',
    background: '#14161C',
    surface: '#1E222B',
  },
  warm: {
    text: '#2A211B',
    mutedText: '#75685C',
    accent: '#C25E2E',
    background: '#FAF6F0',
    surface: '#F1E9DE',
  },
}

export const SLIDE_DESIGN = {
  // Default 16:9 page
  page: { widthEmu: 9144000, heightEmu: 5143500 },
  marginPt: 48,
  fonts: { heading: 'Montserrat', body: 'Open Sans' },
  sizesPt: {
    deckTitle: 40,
    sectionTitle: 32,
    slideTitle: 26,
    body: 16,
    caption: 12,
    bigNumber: 72,
  },
} as const

/**
 * The tokens rendered as a prompt section: fixed typography and geometry,
 * three ready-made palettes as vocabulary, and the rule for deriving any
 * other palette from mission language. Slides-API-ready values (rgbColor
 * floats, EMU geometry) are precomputed so the agent pastes numbers instead
 * of deriving them.
 */
export function slideDesignPromptSection(): string {
  const d = SLIDE_DESIGN
  const marginEmu = d.marginPt * EMU_PER_PT
  const contentWidthEmu = d.page.widthEmu - 2 * marginEmu
  const contentHeightEmu = d.page.heightEmu - 2 * marginEmu
  const paletteLines = (theme: SlideTheme) =>
    (Object.entries(SLIDE_THEMES[theme]) as Array<[ColorRole, string]>).map(
      ([role, hex]) => `- ${role} ${hex} → \`${JSON.stringify(hexToRgb01(hex))}\``,
    )
  return [
    '# Design Tokens (mandatory)',
    '',
    'Style every element explicitly with exact values. Never rely on the theme, master, or placeholder styling.',
    '',
    '## Palette',
    '',
    'Commit to five role colors BEFORE composing slide one, and use only those, consistently:',
    '',
    '- The mission names a mood matching a ready-made palette below (light, dark, warm) → use it as-is.',
    '- The mission implies anything else (brand colors, "like the reference deck", any described look) → derive your own five role values as concrete hex, convert to rgbColor floats in the same shape.',
    '- The mission says nothing about looks → light.',
    '',
    '### light (default)',
    ...paletteLines('light'),
    '',
    '### dark',
    ...paletteLines('dark'),
    '',
    '### warm',
    ...paletteLines('warm'),
    '',
    'Set pageBackgroundFill (solidFill background, or rendered background art) on EVERY slide — including the first — via updatePageProperties; surface is the alternate for section dividers and panels.',
    '',
    '## Typography',
    `- Headings: ${d.fonts.heading} — deck title ${d.sizesPt.deckTitle}pt, section title ${d.sizesPt.sectionTitle}pt, slide title ${d.sizesPt.slideTitle}pt, all color text`,
    `- Body: ${d.fonts.body} ${d.sizesPt.body}pt color text; captions ${d.sizesPt.caption}pt color mutedText; big numbers ${d.fonts.heading} ${d.sizesPt.bigNumber}pt color accent`,
    '',
    '## Geometry (EMU; 1pt = 12700 EMU)',
    `- Page: ${d.page.widthEmu} x ${d.page.heightEmu}`,
    `- Margin: ${d.marginPt}pt = ${marginEmu} EMU on every side`,
    `- Content box: translate {${marginEmu}, ${marginEmu}}, size ${contentWidthEmu} x ${contentHeightEmu}`,
    `- Slide title box: translate {${marginEmu}, ${marginEmu}}, size ${contentWidthEmu} x ${Math.round(d.sizesPt.slideTitle * 1.6 * EMU_PER_PT)}`,
    '',
    'Spacing law: generous whitespace beats density. Max ~5 bullets or ~80 words per content slide; overflow means a new slide.',
  ].join('\n')
}
