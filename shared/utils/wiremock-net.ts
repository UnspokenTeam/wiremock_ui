import type { LoggedRequest, Matcher, RequestPattern, ServeEvent, StubMapping } from '../types/wiremock.ts'

// Keep unrecognized .NET fields intact: custom matchers, webhooks, faults, etc.
export interface NetMapping extends Record<string, unknown> {
  Guid?: string
  Request: Record<string, unknown>
  Response: Record<string, unknown>
}

export interface NetMatchMetadata {
  MappingGuid?: string
  RequestMatchResult?: { IsPerfectMatch?: boolean }
  PartialMappingGuid?: string
  PartialRequestMatchResult?: { AverageTotalScore?: number }
}

export interface NetLogEntry extends NetMatchMetadata, Record<string, unknown> {
  Guid: string
  Request: Record<string, unknown> & { Method: string, Url: string }
  Response: Record<string, unknown> & { StatusCode?: number | string }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function renamed(source: Record<string, unknown>, keys: Record<string, string>) {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [keys[key] ?? key, value]))
}

const mappingKeys = {
  Guid: 'id', Title: 'name', Priority: 'priority', Scenario: 'scenarioName',
  WhenStateIs: 'requiredScenarioState', SaveToFile: 'persistent', Data: 'metadata'
}
const responseKeys = { StatusCode: 'status', Body: 'body', BodyAsJson: 'jsonBody', Headers: 'headers', BodyAsBytes: 'base64Body' }
const reverse = (keys: Record<string, string>) => Object.fromEntries(Object.entries(keys).map(([a, b]) => [b, a]))

function namedMatchers(value: unknown): Record<string, Matcher> {
  return Object.fromEntries((Array.isArray(value) ? value : []).map(({ Name, ...matcher }) => [Name, matcher]))
}

function urlRule(value: unknown, path: boolean): RequestPattern {
  const key = path ? 'urlPath' : 'url'
  if (typeof value === 'string' && !/[?*]/.test(value)) return { [key]: value }
  const rule = object(value)
  const matchers = rule.Matchers as Matcher[] | undefined
  const matcher = matchers?.length === 1 ? matchers[0] : undefined
  // Only collapse a plain, positive rule. Keep every option on complex rules.
  if (matcher && Object.keys(rule).every(key => key === 'Matchers')
    && Object.keys(matcher).every(key => ['Name', 'Pattern', 'IgnoreCase', 'RejectOnMatch'].includes(key))
    && !matcher.IgnoreCase && !matcher.RejectOnMatch && typeof matcher.Pattern === 'string') {
    if (matcher.Name === 'ExactMatcher') return { [key]: matcher.Pattern }
    if (matcher.Name === 'RegexMatcher') return { [path ? 'urlPathPattern' : 'urlPattern']: matcher.Pattern }
  }
  return value === undefined ? {} : { [path ? 'Path' : 'Url']: value }
}

export function fromNetMapping(mapping: NetMapping): StubMapping {
  if (!mapping?.Request || !mapping.Response) throw new Error('Invalid WireMock.Net mapping.')
  const { Request, Response, ...fields } = mapping
  const { Methods, Path, Url, Headers, Params, Cookies, Body, ...extra } = Request
  return {
    ...renamed(fields, mappingKeys),
    // The admin API omits the default priority (zero).
    priority: (mapping.Priority as number | undefined) ?? 0,
    request: {
      ...extra,
      method: Array.isArray(Methods) && Methods.length ? Methods.map(method => String(method).toUpperCase()).join(', ') : 'ANY',
      ...urlRule(Path, true), ...urlRule(Url, false),
      ...(Headers !== undefined ? { headers: namedMatchers(Headers) } : {}),
      ...(Params !== undefined ? { queryParameters: namedMatchers(Params) } : {}),
      ...(Cookies !== undefined ? { cookies: namedMatchers(Cookies) } : {}),
      ...(Body !== undefined ? { bodyPatterns: [object(Body)] } : {})
    },
    response: renamed(Response, responseKeys)
  } as StubMapping
}

function netMatcher(value: Matcher): Matcher {
  if ('Matchers' in value || 'Matcher' in value || 'MatchOperator' in value) return value
  const names: Record<string, string> = {
    equalTo: 'ExactMatcher', matches: 'RegexMatcher', contains: 'WildcardMatcher',
    equalToJson: 'JsonMatcher', matchesJsonPath: 'JsonPathMatcher'
  }
  const key = Object.keys(value).find(key => names[key])
  if (!key) throw new Error('Use WireMock.Net Matcher/Matchers syntax for this matching rule.')
  const { [key]: pattern, ...options } = value
  if (Object.keys(options).length) throw new Error('Use native WireMock.Net matchers to configure matching options.')
  return { Matchers: [{ Name: names[key], Pattern: key === 'contains' ? `*${pattern}*` : pattern }] }
}

function netNamed(map: Record<string, Matcher>) {
  return Object.entries(map).map(([Name, rule]) => ({ Name, ...netMatcher(rule) }))
}

function templateRegex(template: string, params: Record<string, Matcher> = {}) {
  return '^' + template.split(/(\{[^{}]+\})/g).map((part) => {
    if (!part.startsWith('{')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const name = part.slice(1, -1)
    if (!/^[A-Za-z_]\w*$/.test(name)) throw new Error('Path parameter names must be valid named regex groups.')
    const rule = params[name]
    const pattern = rule && 'equalTo' in rule
      ? String(rule.equalTo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      : rule && typeof rule.matches === 'string' ? rule.matches : '[^/]+'
    return `(?<${name}>${pattern})`
  }).join('') + '$'
}

export function toNetMapping(mapping: { id?: string, request: RequestPattern, response: StubMapping['response'], [key: string]: unknown }): NetMapping {
  const { request, response, uuid: _uuid, ...fields } = mapping
  const {
    method, url, urlPath, urlPattern, urlPathPattern, urlPathTemplate, pathParameters,
    headers, queryParameters, cookies, bodyPatterns, ...extra
  } = request
  const Request: Record<string, unknown> = { ...extra }
  if (method && method !== 'ANY') Request.Methods = method.split(/\s*,\s*/)
  const rule = (Name: string, Pattern: string) => ({ Matchers: [{ Name, Pattern }] })
  if (url !== undefined) Request.Url = rule('ExactMatcher', url)
  if (urlPath !== undefined) Request.Path = rule('ExactMatcher', urlPath)
  if (urlPattern !== undefined) Request.Url = rule('RegexMatcher', urlPattern)
  if (urlPathPattern !== undefined) Request.Path = rule('RegexMatcher', urlPathPattern)
  if (urlPathTemplate !== undefined) Request.Path = rule('RegexMatcher', templateRegex(urlPathTemplate, pathParameters))
  if (headers) Request.Headers = netNamed(headers)
  if (queryParameters) Request.Params = netNamed(queryParameters)
  if (cookies) Request.Cookies = netNamed(cookies)
  if (bodyPatterns?.length) {
    if (bodyPatterns.length !== 1) throw new Error('Use one WireMock.Net Body object with Matchers and MatchOperator.')
    Request.Body = netMatcher(bodyPatterns[0]!)
  }
  // Lowercase extensions from another backend must never be silently ignored.
  if (Object.keys(Request).some(key => /^[a-z]/.test(key))) throw new Error('Use native WireMock.Net request fields for additional matchers.')
  return {
    ...renamed(fields, reverse(mappingKeys)),
    ...(mapping.id ? { Guid: mapping.id } : {}), Request, Response: renamed(response, reverse(responseKeys))
  }
}

export function fromNetLog(entry: NetLogEntry, mappings: StubMapping[] = []): ServeEvent {
  if (!entry?.Guid || typeof entry.Request?.Method !== 'string' || typeof entry.Request.Url !== 'string') throw new Error('Invalid WireMock.Net request log.')
  const { Request: source, Response, ...metadata } = entry
  const { BodyAsJson, ...requestFields } = source
  const absoluteUrl = String(source.AbsoluteUrl ?? source.Url)
  let url = source.Url
  try {
    const parsed = new URL(absoluteUrl)
    url = parsed.pathname + parsed.search
  } catch { /* Relative URL. */ }
  const request: LoggedRequest = {
    ...renamed(requestFields, {
      Headers: 'headers', Cookies: 'cookies', Body: 'body', BodyAsBytes: 'bodyAsBase64',
      Method: 'method', Url: 'url', AbsoluteUrl: 'absoluteUrl', DateTime: 'loggedDateString', ClientIP: 'clientIp'
    }), url, absoluteUrl, method: source.Method.toUpperCase(),
    headers: source.Headers as LoggedRequest['headers'], cookies: source.Cookies as LoggedRequest['cookies'],
    body: source.Body as string | undefined ?? (BodyAsJson === undefined ? undefined : JSON.stringify(BodyAsJson)),
    bodyAsBase64: source.BodyAsBytes as string | undefined,
    loggedDateString: source.DateTime as string | undefined,
    loggedDate: source.DateTime ? Date.parse(String(source.DateTime)) : undefined,
    clientIp: source.ClientIP as string | undefined
  }
  const wasMatched = Boolean(entry.MappingGuid) && entry.RequestMatchResult?.IsPerfectMatch !== false
  const mapping = wasMatched ? mappings.find(mapping => mapping.id === entry.MappingGuid) : undefined
  return {
    id: entry.Guid, request, wasMatched, stubMapping: mapping,
    closestMapping: !wasMatched ? mappings.find(mapping => mapping.id === entry.PartialMappingGuid) : undefined,
    response: { ...renamed(Response, responseKeys), status: Number(Response.StatusCode) },
    responseDefinition: { status: Number(Response.StatusCode), fromConfiguredStub: wasMatched },
    wiremockNet: metadata
  }
}
