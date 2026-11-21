import type { H3Event } from 'h3'
import { validateMock } from '#shared/utils/mocks'

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
    return validateMock(await readBody(event))
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: (error as Error).message
    })
  }
}
