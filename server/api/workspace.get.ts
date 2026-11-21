import type { ServeEvent, StubMapping, Workspace } from '#shared/types/wiremock'
import { fromNetLog, fromNetMapping, type NetLogEntry, type NetMapping } from '#shared/utils/wiremock-net'

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
        wiremockFetch<NetMapping[]>(event, '/mappings'),
        wiremockFetch<NetLogEntry[]>(event, '/requests')
      ])
      if (!Array.isArray(routes) || !Array.isArray(journal)
        || routes.some(mapping => typeof mapping.Guid !== 'string' || !mapping.Guid))
        throw createError({
          statusCode: 502,
          statusMessage:
            'The configured server did not return WireMock.Net requests and mappings.'
        })
      mappings = routes.map(fromNetMapping)
      const saved = store.readWorkspace(baseUrl, 1)
      const definitions = [...mappings, ...(saved?.mappings ?? [])]
      requests = journal.map((entry) => {
        const previous = store.getRequest(baseUrl, entry.Guid)
        const logged = fromNetLog(entry, definitions)
        // .NET logs contain only mapping IDs. Keep the first observed definition.
        if (previous?.stubMapping) logged.stubMapping = previous.stubMapping
        if (previous?.closestMapping) logged.closestMapping = previous.closestMapping
        return logged
      })
      journalDisabled = false
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
