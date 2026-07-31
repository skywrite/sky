/**
 * Shared shape-validation for model-authored batchUpdate request arrays
 * (Docs and Slides). A fixed allowlist per API keeps the blast radius of
 * agent-generated requests known; the APIs themselves validate the payloads.
 * Returns an agent-readable problem description, or null when acceptable.
 */
export function validateBatchRequests(
  requests: unknown,
  allowed: ReadonlySet<string>,
  maxRequests: number,
): string | null {
  if (!Array.isArray(requests)) return 'requests must be an array of API request objects'
  if (requests.length === 0) return 'requests is empty'
  if (requests.length > maxRequests) {
    return `too many requests in one batch (${requests.length} > ${maxRequests})`
  }
  for (const [i, request] of requests.entries()) {
    if (typeof request !== 'object' || request === null || Array.isArray(request)) {
      return `request ${i} is not an object`
    }
    const keys = Object.keys(request)
    if (keys.length !== 1) {
      return `request ${i} must have exactly one key (the request kind), found: ${keys.join(', ') || 'none'}`
    }
    if (!allowed.has(keys[0])) {
      return `request ${i} kind "${keys[0]}" is not allowed. Allowed: ${[...allowed].join(', ')}`
    }
  }
  return null
}
