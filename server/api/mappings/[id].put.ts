import { fromNetMapping, toNetMapping, type NetMapping } from '#shared/utils/wiremock-net'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const id = mappingId(event)
  const draft = await mockBody(event)
  if (draft.id && draft.id !== id)
    throw createError({
      statusCode: 400,
      statusMessage: 'The mock ID cannot be changed when editing.'
    })
  const { uuid: _uuid, ...mapping } = draft
  return withInstanceHistory(event, async (store, baseUrl) => {
    await wiremockFetch(event, `/mappings/${id}`, {
      method: 'PUT',
      body: toNetMapping({ ...mapping, id })
    })
    const saved = fromNetMapping(await wiremockFetch<NetMapping>(event, `/mappings/${id}`))
    store.rememberMapping(baseUrl, saved)
    return saved
  })
})
