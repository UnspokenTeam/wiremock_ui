import type {
  RequestPattern,
  ServeEvent,
  StubMapping
} from '../types/wiremock.ts'

export function routeUrl(pattern: RequestPattern): string {
  return (
    pattern.url ??
    pattern.urlPath ??
    pattern.urlPathTemplate ??
    pattern.urlPattern ??
    pattern.urlPathPattern ??
    '(any URL)'
  )
}

export function mappingName(mapping: StubMapping): string {
  return (
    mapping.name ||
    `${mapping.request.method || 'ANY'} ${routeUrl(mapping.request)}`
  )
}

export function isMatched(event: ServeEvent): boolean {
  return (
    event.wasMatched ??
    event.responseDefinition?.fromConfiguredStub ??
    Boolean(event.stubMapping && !event.stubMapping.isDefault)
  )
}

export function matchedMapping(
  event: ServeEvent | undefined
): StubMapping | undefined {
  // WireMock also attaches a synthetic ANY/404 stub to unmatched serve events.
  return event && isMatched(event) ? event.stubMapping : undefined
}

export function statusCode(event: ServeEvent): number | undefined {
  return event.response?.status ?? event.responseDefinition?.status
}

export function searchMappings(
  mappings: StubMapping[],
  search: string,
  method = 'ALL'
): StubMapping[] {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return mappings.filter((mapping) => {
    if (method !== 'ALL' && mapping.request.method !== method) return false
    const text = [
      mappingName(mapping),
      mapping.id,
      mapping.request.method,
      routeUrl(mapping.request),
      mapping.scenarioName,
      JSON.stringify(mapping.metadata ?? {})
    ]
      .join(' ')
      .toLowerCase()
    return terms.every((term) => text.includes(term))
  })
}
