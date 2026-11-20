import type { ServeEvent, StubMapping, Workspace } from '#shared/types/wiremock'

export default defineEventHandler(async (event): Promise<Workspace> => {
  setHeader(event, 'Cache-Control', 'no-store')
  const rawLimit = Number(getQuery(event).limit ?? 500)
  const limit = Number.isFinite(rawLimit)
    ? Math.min(10000, Math.max(100, Math.trunc(rawLimit)))
    : 500
  const [mappings, journal] = await Promise.all([
    wiremockFetch<{ mappings: StubMapping[] }>(event, '/mappings'),
    wiremockFetch<{
      requests: ServeEvent[]
      meta?: { total?: number }
      requestJournalDisabled?: boolean
    }>(event, '/requests', { query: { limit } })
  ])
  if (!Array.isArray(mappings.mappings) || !Array.isArray(journal.requests)) {
    throw createError({
      statusCode: 502,
      statusMessage:
        'The configured server did not return a WireMock request journal and stub mappings.'
    })
  }
  return {
    mappings: mappings.mappings,
    requests: journal.requests.sort(
      (a, b) => (b.request.loggedDate ?? 0) - (a.request.loggedDate ?? 0)
    ),
    total: journal.meta?.total ?? journal.requests.length,
    requestJournalDisabled: journal.requestJournalDisabled ?? false,
    baseUrl: wiremockConnection(event).baseUrl,
    fetchedAt: new Date().toISOString()
  }
})
