/**
 * Normalize a URL by ensuring it has a protocol and removing trailing slashes
 * @param url - URL string to normalize (e.g., "google.com", "https://google.com/", "example.com")
 * @returns Normalized URL string (e.g., "https://google.com")
 */
export function normalizeUrl(url: string): string {
  // Parse URL, adding https:// if no protocol is present
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    // If URL is invalid (missing protocol), assume https://
    parsedUrl = new URL(`https://${url}`)
  }

  // Build result - remove trailing slash if pathname is just '/'
  const pathname = parsedUrl.pathname === '/' ? '' : parsedUrl.pathname.replace(/\/$/, '')

  return `${parsedUrl.protocol}//${parsedUrl.host}${pathname}${parsedUrl.search}${parsedUrl.hash}`
}
