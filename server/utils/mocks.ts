import type { H3Event } from 'h3'
import { validateMock } from '#shared/utils/mocks'
import { toNetMapping } from '#shared/utils/wiremock-net'

export function mappingId(event: H3Event): string {
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A valid mock UUID is required.'
    })
  }
  return id
}

export async function mockBody(event: H3Event) {
  try {
    const draft = validateMock(await readBody(event))
    toNetMapping(draft)
    return draft
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: (error as Error).message
    })
  }
}
