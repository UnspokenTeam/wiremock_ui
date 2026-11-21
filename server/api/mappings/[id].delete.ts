import { fromNetMapping, type NetMapping } from '#shared/utils/wiremock-net'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const id = mappingId(event)
  return withInstanceHistory(event, async (store, baseUrl) => {
    const mapping = fromNetMapping(await wiremockFetch<NetMapping>(event, `/mappings/${id}`))
    // Save before deleting, even if this mock has never appeared in a poll.
    store.rememberMapping(baseUrl, mapping)
    await wiremockFetch(event, `/mappings/${id}`, { method: 'DELETE' })
    return { deleted: true, history: store.markDeleted(baseUrl, id)! }
  })
})
