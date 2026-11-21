import { randomUUID } from 'node:crypto'
import type { StubMapping } from '#shared/types/wiremock'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const draft = await mockBody(event)
  const id = draft.id ?? randomUUID()
  const { uuid: _uuid, ...mapping } = draft
  const created = await withInstanceHistory(event, async (store, baseUrl) => {
    const saved = await wiremockFetch<StubMapping>(event, '/mappings', {
      method: 'POST',
      body: { ...mapping, id }
    })
    store.rememberMapping(baseUrl, saved)
    return saved
  })
  setResponseStatus(event, 201)
  return created
})
