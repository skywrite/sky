export function createJsonResponse(payload: string | unknown, statusCode = 200): Response {
  if (typeof payload !== 'string') payload = JSON.stringify(payload, null, 2)

  return new Response(payload as BodyInit, {
    status: statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export function createHtmlResponse(payload: string, statusCode = 200): Response {
  return new Response(payload as BodyInit, {
    status: statusCode,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
