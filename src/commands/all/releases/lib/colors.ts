import colors from 'picocolors'

export function bgMagentaWhiteBold(str = ''): string {
  return colors.bgMagenta(colors.white(colors.bold(str)))
}

export function bgCyanWhiteBold(str = ''): string {
  return colors.bgCyan(colors.white(colors.bold(str)))
}
