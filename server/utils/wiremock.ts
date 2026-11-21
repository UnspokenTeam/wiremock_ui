import type { H3Event } from 'h3'
import { normalizeInstanceUrl } from '#shared/utils/instances'
import { headersForInstance } from '../lib/instance-auth'

export function wiremockConnection(event: H3Event) {
  const config = useRuntimeConfig(event)
  const requestedUrl = getHeader(event, 'x-wiremock-url')
  let defaultUrl = ''
  let baseUrl: string
  try {
    defaultUrl = normalizeInstanceUrl(config.wiremockBaseUrl)
  } catch {
    if (!requestedUrl) {
      throw createError({
        statusCode: 500,
        statusMessage:
          'Set NUXT_WIREMOCK_BASE_URL to a valid HTTP(S) URL without credentials or query parameters.'
      })
    }
  }
  try {
    baseUrl = requestedUrl ? normalizeInstanceUrl(requestedUrl) : defaultUrl
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: (error as Error).message
    })
  }
  const headers = headersForInstance(baseUrl, defaultUrl, {
    token: config.wiremockAuthToken,
    username: config.wiremockUsername,
    password: config.wiremockPassword
  })
  return { baseUrl, headers }
}

export async function wiremockFetch<T>(
  event: H3Event,
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    body?: unknown
    query?: Record<string, string | number>
  } = {}
): Promise<T> {
  const { baseUrl, headers } = wiremockConnection(event)
  try {
    return (await $fetch<T>(`${baseUrl}/__admin${path}`, {
      headers,
      method: options.method ?? 'GET',
      body: options.body as Record<string, unknown> | undefined,
      query: options.query,
      timeout: 12000,
      retry: 0,
      redirect: 'error'
    })) as T
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response
      ?.status
    if (status === 400 || status === 422) {
      const upstream = (
        error as { data?: { errors?: { detail?: string, title?: string }[] } }
      ).data
      const details = upstream?.errors
        ?.map(item => item.detail || item.title)
        .filter(Boolean)
        .join('\n')
        .slice(0, 2000)
      throw createError({
        statusCode: status,
        statusMessage:
          'WireMock rejected the mock. Check its request matchers and response definition.',
        data: { details }
      })
    }
    if (status === 404)
      throw createError({
        statusCode: 404,
        statusMessage:
          'This item is no longer available on the selected WireMock instance. Refresh and try again.'
      })
    throw createError({
      statusCode: status === 401 || status === 403 ? 502 : 503,
      statusMessage:
        status === 401 || status === 403
          ? 'WireMock rejected the connection credentials. Check the server authentication settings.'
          : `Cannot reach WireMock${status ? ` (HTTP ${status})` : ''}. Check the selected address and that the instance is reachable from this app.`
    })
  }
}
