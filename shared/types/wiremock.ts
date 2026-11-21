// The compatible subset used by the UI. Full upstream contract: docs/openapi/.
export type Matcher = Record<string, unknown>
export type ValueMap = Record<string, unknown>

export interface RequestPattern {
  method?: string
  url?: string
  urlPath?: string
  urlPattern?: string
  urlPathPattern?: string
  urlPathTemplate?: string
  headers?: Record<string, Matcher>
  queryParameters?: Record<string, Matcher>
  pathParameters?: Record<string, Matcher>
  cookies?: Record<string, Matcher>
  formParameters?: Record<string, Matcher>
  bodyPatterns?: Matcher[]
  multipartPatterns?: Matcher[]
  basicAuthCredentials?: { username: string, password: string }
  [key: string]: unknown
}

export interface LoggedRequest {
  url: string
  absoluteUrl?: string
  method: string
  headers?: Record<string, string | string[]>
  cookies?: ValueMap
  body?: string
  bodyAsBase64?: string
  loggedDate?: number
  loggedDateString?: string
  clientIp?: string
  formParams?: ValueMap
  parts?: unknown[]
  [key: string]: unknown
}

export interface StubMapping {
  id: string
  uuid?: string
  name?: string
  request: RequestPattern
  response: Record<string, unknown> & { status?: number }
  priority?: number
  scenarioName?: string
  requiredScenarioState?: string
  metadata?: ValueMap
  [key: string]: unknown
}

export interface ServeEvent {
  id: string
  request: LoggedRequest
  wasMatched?: boolean
  stubMapping?: StubMapping
  responseDefinition?: Record<string, unknown> & {
    status?: number
    fromConfiguredStub?: boolean
  }
  response?: Record<string, unknown> & { status?: number }
  timing?: { totalTime?: number, processTime?: number }
  [key: string]: unknown
}

export interface NearMiss {
  request: LoggedRequest
  stubMapping: StubMapping
  matchResult: { distance: number }
}

export interface Workspace {
  mappings: StubMapping[]
  requests: ServeEvent[]
  total: number
  requestJournalDisabled: boolean
  baseUrl: string
  fetchedAt: string
  history?: WorkspaceHistory
}

export interface MappingHistory {
  firstSeenAt: string
  lastSeenAt: string
  deletedAt: string | null
}

export interface WorkspaceHistory {
  connected: boolean
  connectionError?: string
  lastSyncedAt: string | null
  matchedCount: number
  unmatchedCount: number
  activeMockCount: number
  deletedMockCount: number
  mappingStates: Record<string, MappingHistory>
}
