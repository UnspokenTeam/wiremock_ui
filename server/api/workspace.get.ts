import type { ServeEvent, StubMapping, Workspace } from '#shared/types/wiremock'

export default defineEventHandler(async (event): Promise<Workspace> => {
  setHeader(event, 'Cache-Control', 'no-store')
  const rawLimit = Number(getQuery(event).limit ?? 500)
  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? rawLimit : 500
  return withInstanceHistory(event, async (store, baseUrl) => {
    let mappings: StubMapping[]
    let requests: ServeEvent[]
    let journalDisabled: boolean
    try {
      // Capture the complete journal, independently of the UI's display limit.
      const [routes, journal] = await Promise.all([
        wiremockFetch<{ mappings: StubMapping[] }>(event, '/mappings'),
        wiremockFetch<{
          requests: ServeEvent[]
          requestJournalDisabled?: boolean
        }>(event, '/requests')
      ])
      if (!Array.isArray(routes.mappings) || !Array.isArray(journal.requests))
        throw createError({
          statusCode: 502,
          statusMessage:
            'The configured server did not return a WireMock request journal and stub mappings.'
        })
      mappings = routes.mappings
      requests = journal.requests
      journalDisabled = journal.requestJournalDisabled ?? false
    } catch (cause) {
      const message
        = (cause as { statusMessage?: string }).statusMessage
          ?? 'Cannot reach WireMock.'
      const saved = store.readWorkspace(baseUrl, limit, message)
      if (saved) return saved
      throw cause
    }
    store.synchronize(baseUrl, mappings, requests, journalDisabled)
    return store.readWorkspace(baseUrl, limit)!
  })
})
