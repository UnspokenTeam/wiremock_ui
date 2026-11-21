import type { NearMiss, ServeEvent } from '#shared/types/wiremock'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const body = await readBody<{ requestId?: string }>(event)
  if (
    typeof body?.requestId !== 'string'
    || !/^[a-zA-Z0-9-]{1,128}$/.test(body.requestId)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A valid request ID is required.'
    })
  }
  const baseUrl = wiremockConnection(event).baseUrl
  const logged
    = historyStore(event).getRequest(baseUrl, body.requestId)
      ?? (await wiremockFetch<ServeEvent>(
        event,
        `/requests/${encodeURIComponent(body.requestId)}`
      ))
  return wiremockFetch<{ nearMisses: NearMiss[] }>(
    event,
    '/near-misses/request',
    { method: 'POST', body: logged.request }
  )
})
