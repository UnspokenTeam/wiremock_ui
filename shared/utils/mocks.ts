import type { RequestPattern, StubMapping } from '../types/wiremock.ts'

export interface MockDraft {
  id?: string
  name?: string
  priority?: number
  request: RequestPattern
  response: StubMapping['response']
  [key: string]: unknown
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function validateMock(value: unknown): MockDraft {
  if (
    !isRecord(value)
    || !isRecord(value.request)
    || !isRecord(value.response)
  ) {
    throw new Error('A mock needs a request object and a response object.')
  }
  const request = value.request
  const response = value.response
  if (
    value.id !== undefined
    && (typeof value.id !== 'string'
      || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value.id))
  ) {
    throw new Error('The mock ID must be a UUID.')
  }
  if (
    value.request.method !== undefined
    && (typeof value.request.method !== 'string'
      || !/^[A-Z]+$/.test(value.request.method))
  ) {
    throw new Error(
      'The HTTP method must be uppercase, such as GET, POST, or ANY.'
    )
  }
  const urls = [
    'url',
    'urlPath',
    'urlPathTemplate',
    'urlPattern',
    'urlPathPattern'
  ].filter(key => request[key] !== undefined)
  if (urls.length > 1) throw new Error('Choose only one URL matching rule.')
  if (
    urls.some(
      key => typeof request[key] !== 'string' || !String(request[key]).length
    )
  )
    throw new Error('The URL matching rule must contain a non-empty string.')
  if (
    response.status !== undefined
    && (!Number.isInteger(response.status)
      || Number(response.status) < 100
      || Number(response.status) > 599)
  )
    throw new Error('The response status must be between 100 and 599.')
  if (
    value.priority !== undefined
    && (!Number.isInteger(value.priority) || Number(value.priority) < 1)
  )
    throw new Error('Priority must be a positive integer.')
  return value as MockDraft
}

export function duplicateMock(mapping: StubMapping): MockDraft {
  const { id: _id, uuid: _uuid, ...copy } = structuredClone(mapping)
  return { ...copy, name: `${mapping.name || 'Mock'} (copy)` }
}
