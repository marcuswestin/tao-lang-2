/** jsonResponse is a JSON body with the content type and sniffing guard every Tao server sends. */
export function jsonResponse(value: unknown, status = 200, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
    status,
  })
}
