import type { H3Event } from 'h3'
import { Buffer } from 'node:buffer'

export function wiremockConnection(event: H3Event) {
  const config = useRuntimeConfig(event)
  let url: URL
  try {
    url = new URL(config.wiremockBaseUrl)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid URL')
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage:
        'Set NUXT_WIREMOCK_BASE_URL to a valid HTTP(S) URL without credentials or query parameters.'
    })
  }
  const baseUrl = url
    .toString()
    .replace(/\/$/, '')
    .replace(/\/__admin$/, '')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (config.wiremockAuthToken)
    headers.Authorization = `Bearer ${config.wiremockAuthToken}`
  else if (config.wiremockUsername)
    headers.Authorization = `Basic ${Buffer.from(`${config.wiremockUsername}:${config.wiremockPassword}`).toString('base64')}`
  return { baseUrl, headers }
}

export async function wiremockFetch<T>(
  event: H3Event,
  path: string,
  options: {
    method?: 'GET' | 'POST'
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
    throw createError({
      statusCode: status === 401 || status === 403 ? 502 : 503,
      statusMessage:
        status === 401 || status === 403
          ? 'WireMock rejected the connection credentials. Check the server authentication settings.'
          : `Cannot read WireMock${status ? ` (HTTP ${status})` : ''}. Check the configured address and that the instance is reachable from this app.`
    })
  }
}
