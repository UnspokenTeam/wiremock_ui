export const pollingIntervals = [
  1000, 5000, 10000, 20000, 30000, 60000
] as const
export const defaultInstanceId = 'default'
export const settingsStorageKey = 'wiretap.preferences.v1'

export interface WireMockInstance {
  id: string
  name: string
  // Empty means use the app server's configured default address and credentials.
  url: string
}

export function normalizeInstanceUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    throw new Error('Enter a WireMock HTTP or HTTPS address.')
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Enter a complete address, such as http://localhost:8080.')
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.href.includes('?')
    || url.href.includes('#')
  ) {
    throw new Error(
      'Use an HTTP(S) address without embedded credentials, query parameters, or a fragment.'
    )
  }
  return url
    .toString()
    .replace(/\/+$/, '')
    .replace(/\/__admin$/, '')
}

export function validPollingInterval(value: unknown): number {
  return pollingIntervals.includes(value as (typeof pollingIntervals)[number])
    ? Number(value)
    : 5000
}

export function readPreferences(value: unknown): {
  instances: WireMockInstance[]
  activeId: string
  pollMs: number
} {
  const defaults: WireMockInstance = {
    id: defaultInstanceId,
    name: 'Default instance',
    url: ''
  }
  if (!value || typeof value !== 'object')
    return { instances: [defaults], activeId: defaultInstanceId, pollMs: 5000 }
  const raw = value as Record<string, unknown>
  const instances = [defaults]
  if (Array.isArray(raw.instances)) {
    for (const item of raw.instances) {
      if (
        !item
        || typeof item !== 'object'
        || typeof item.id !== 'string'
        || !/^[\w-]{1,100}$/.test(item.id)
        || typeof item.name !== 'string'
        || !item.name.trim()
        || instances.some(instance => instance.id === item.id)
      )
        continue
      try {
        instances.push({
          id: item.id,
          name: item.name.trim().slice(0, 80),
          url: normalizeInstanceUrl(item.url)
        })
      } catch {
        /* Ignore corrupt saved profiles. */
      }
    }
  }
  return {
    instances,
    activeId:
      typeof raw.activeId === 'string'
      && instances.some(instance => instance.id === raw.activeId)
        ? raw.activeId
        : defaultInstanceId,
    pollMs: validPollingInterval(raw.pollMs)
  }
}

export function instanceRequestHeaders(url: string): Record<string, string> {
  return url ? { 'X-WireMock-URL': normalizeInstanceUrl(url) } : {}
}
