import { randomUUID } from 'node:crypto'
import { fromNetMapping, toNetMapping, type NetMapping } from '#shared/utils/wiremock-net'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const draft = await mockBody(event)
  const id = draft.id ?? randomUUID()
  const { uuid: _uuid, ...mapping } = draft
  const created = await withInstanceHistory(event, async (store, baseUrl) => {
    await wiremockFetch(event, '/mappings', {
      method: 'POST',
      body: toNetMapping({ ...mapping, id })
    })
    const saved = fromNetMapping(await wiremockFetch<NetMapping>(event, `/mappings/${id}`))
    store.rememberMapping(baseUrl, saved)
    return saved
  })
  setResponseStatus(event, 201)
  return created
})
