export const WHITEBOARD_PATH = '/whiteboard'

export type WhiteboardTab = 'rich' | 'raw'

export function isWhiteboardPath(pathname: string): boolean {
  return pathname === WHITEBOARD_PATH || pathname.startsWith(`${WHITEBOARD_PATH}/`)
}

export function whiteboardTabOf(search: string): WhiteboardTab {
  return new URLSearchParams(search).get('tab') === 'raw' ? 'raw' : 'rich'
}

export function whiteboardHref(tab: WhiteboardTab = 'rich'): string {
  return tab === 'raw' ? `${WHITEBOARD_PATH}?tab=raw` : WHITEBOARD_PATH
}
