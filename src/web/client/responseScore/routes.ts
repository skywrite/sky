export const RESPONSE_SCORE_PATH = '/responses'

export function isResponseScorePath(pathname: string): boolean {
  return pathname === RESPONSE_SCORE_PATH
}
