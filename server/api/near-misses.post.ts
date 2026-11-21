import { fromNetLog, type NetLogEntry, type NetMatchMetadata } from '#shared/utils/wiremock-net'

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
      ?? fromNetLog(await wiremockFetch<NetLogEntry>(
        event,
        `/requests/${encodeURIComponent(body.requestId)}`
      ))
  // WireMock.Net records its closest mapping and engine score in each log.
  // This also works after the upstream journal has been cleared.
  const source = logged.wiremockNet as NetMatchMetadata | undefined
  const mapping = logged.closestMapping ?? logged.stubMapping
    ?? historyStore(event).readWorkspace(baseUrl, 1)?.mappings
      .find(mapping => mapping.id === source?.PartialMappingGuid)
  const score = source?.PartialRequestMatchResult?.AverageTotalScore
  return {
    nearMisses: mapping && typeof score === 'number'
      ? [{ request: logged.request, stubMapping: mapping, matchResult: { distance: 1 - score } }]
      : []
  }
})
