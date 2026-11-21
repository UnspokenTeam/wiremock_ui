import { createTwoFilesPatch, diffLines } from 'diff'
import type {
  LoggedRequest,
  Matcher,
  RequestPattern,
  StubMapping,
  ValueMap
} from '../types/wiremock.ts'

export interface DiffLine {
  kind: 'context' | 'added' | 'removed'
  text: string
  oldLine?: number
  newLine?: number
}
export interface SplitLine {
  left?: DiffLine
  right?: DiffLine
}
export interface ComparisonBlock {
  id: string
  title: string
  hint: string
  expected: string
  actual: string
  lines: DiffLine[]
  split: SplitLine[]
  additions: number
  removals: number
  changed: boolean
}

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableValue(entry)])
    )
  return value
}

export function pretty(value: unknown): string {
  if (value === undefined) return ''
  return typeof value === 'string'
    ? value
    : JSON.stringify(stableValue(value), null, 2)
}

function literal(matcher: unknown): unknown {
  if (!matcher || typeof matcher !== 'object' || Array.isArray(matcher))
    return matcher
  const object = matcher as Matcher
  if (Object.keys(object).length === 1 && 'equalTo' in object)
    return object.equalTo
  return matcher
}

function mapValues(
  map: ValueMap | undefined,
  expected = false,
  lowerKeys = false
): string {
  if (!map || !Object.keys(map).length) return ''
  return pretty(
    Object.fromEntries(
      Object.entries(map).map(([key, value]) => {
        let normalized = expected ? literal(value) : value
        if (!expected && Array.isArray(normalized) && normalized.length === 1)
          normalized = normalized[0]
        // WireMock serializes cookies as either strings or { name, value }.
        if (
          !expected
          && normalized
          && typeof normalized === 'object'
          && 'value' in normalized
        )
          normalized = (normalized as { value: unknown }).value
        return [lowerKeys ? key.toLowerCase() : key, normalized]
      })
    )
  )
}

function parameters(search: string): ValueMap {
  const entries = new URLSearchParams(search)
  return Object.fromEntries(
    [...new Set(entries.keys())].map((key) => {
      const values = entries.getAll(key)
      return [key, values.length === 1 ? values[0] : values]
    })
  )
}

export function pathParameters(
  template: string | undefined,
  pathname: string
): ValueMap {
  if (!template) return {}
  const names: string[] = []
  let source = ''
  let cursor = 0
  for (const match of template.matchAll(/\{([^{}]+)\}/g)) {
    source
      += template
        .slice(cursor, match.index)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^/]+)'
    names.push(match[1]!)
    cursor = match.index! + match[0].length
  }
  source += template.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^${source}$`).exec(pathname)
  if (!match) return { '(path)': 'Does not fit the selected URL template' }
  return Object.fromEntries(
    names.map((name, i) => {
      let value = match[i + 1]!
      try {
        value = decodeURIComponent(value)
      } catch {
        /* Keep malformed escapes visible. */
      }
      return [name, value]
    })
  )
}

function bodyText(
  pattern: RequestPattern,
  request: LoggedRequest
): { expected: string, actual: string, hint: string } {
  const patterns = pattern.bodyPatterns ?? []
  const single = patterns.length === 1 ? patterns[0] : undefined
  let expected: unknown = patterns.length ? patterns : ''
  let actual: unknown
    = request.body
      ?? (request.bodyAsBase64 ? `[base64] ${request.bodyAsBase64}` : '')
  let hint = patterns.length ? 'Configured body matchers' : 'No body constraint'
  if (
    single
    && ('equalToJson' in single
      || 'equalTo' in single
      || 'equalToXml' in single
      || 'binaryEqualTo' in single)
  ) {
    const key = ['equalToJson', 'equalTo', 'equalToXml', 'binaryEqualTo'].find(
      key => key in single
    )!
    expected = single[key]
    const options = Object.fromEntries(
      Object.entries(single).filter(([name]) => name !== key)
    )
    hint = `${key}${Object.keys(options).length ? ` · ${JSON.stringify(options)}` : ''}`
    if (key === 'equalToJson') {
      hint += ' · JSON keys sorted for readability'
      try {
        if (typeof expected === 'string') expected = JSON.parse(expected)
      } catch {
        /* Show original. */
      }
      try {
        if (typeof actual === 'string') actual = JSON.parse(actual)
      } catch {
        /* Show original. */
      }
    }
    if (key === 'binaryEqualTo') actual = request.bodyAsBase64 ?? ''
  }
  return { expected: pretty(expected), actual: pretty(actual), hint }
}

export function lineDiff(expected: string, actual: string): DiffLine[] {
  const left = expected
  const right = actual
  // Bound pathological comparisons; fallback still preserves every line.
  const changes = diffLines(left, right, { timeout: 80 }) ?? [
    ...(left ? [{ value: left, removed: true, added: false }] : []),
    ...(right ? [{ value: right, added: true, removed: false }] : [])
  ]
  let oldLine = 1
  let newLine = 1
  return changes.flatMap(change =>
    change.value
      .replace(/\n$/, '')
      .split('\n')
      .map(text => ({
        text,
        kind: change.added
          ? ('added' as const)
          : change.removed
            ? ('removed' as const)
            : ('context' as const),
        oldLine: change.added ? undefined : oldLine++,
        newLine: change.removed ? undefined : newLine++
      }))
  )
}

export function splitLines(lines: DiffLine[]): SplitLine[] {
  const rows: SplitLine[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i]!.kind === 'context') {
      rows.push({ left: lines[i], right: lines[i] })
      i++
      continue
    }
    const removed: DiffLine[] = []
    const added: DiffLine[] = []
    while (i < lines.length && lines[i]!.kind !== 'context') {
      const line = lines[i++]!
      if (line.kind === 'removed') removed.push(line)
      else added.push(line)
    }
    for (let j = 0; j < Math.max(removed.length, added.length); j++)
      rows.push({ left: removed[j], right: added[j] })
  }
  return rows
}

function block(
  id: string,
  title: string,
  expected: string,
  actual: string,
  hint = ''
): ComparisonBlock {
  const lines = lineDiff(expected, actual)
  return {
    id,
    title,
    hint,
    expected,
    actual,
    lines,
    split: splitLines(lines),
    additions: lines.filter(line => line.kind === 'added').length,
    removals: lines.filter(line => line.kind === 'removed').length,
    changed: expected !== actual
  }
}

export function compareRequest(
  mapping: StubMapping,
  request: LoggedRequest
): ComparisonBlock[] {
  const pattern = mapping.request
  let url: URL
  try {
    url = new URL(request.absoluteUrl ?? request.url, 'http://wiremock.local')
  } catch {
    url = new URL('http://wiremock.local')
  }
  const urlKey = [
    'url',
    'urlPath',
    'urlPathTemplate',
    'urlPattern',
    'urlPathPattern'
  ].find(key => typeof pattern[key] === 'string')
  const expectedUrl = urlKey ? String(pattern[urlKey]) : ''
  const actualUrl
    = urlKey === 'url' || urlKey === 'urlPattern'
      ? `${url.pathname}${url.search}`
      : url.pathname
  const body = bodyText(pattern, request)
  const form
    = request.formParams
      ?? (/application\/x-www-form-urlencoded/i.test(
        String(
          Object.entries(request.headers ?? {}).find(
            ([key]) => key.toLowerCase() === 'content-type'
          )?.[1] ?? ''
        )
      )
        ? parameters(request.body ?? '')
        : {})
  const consumed = [
    'method',
    'url',
    'urlPath',
    'urlPathTemplate',
    'urlPattern',
    'urlPathPattern',
    'headers',
    'queryParameters',
    'pathParameters',
    'bodyPatterns',
    'cookies',
    'formParameters',
    'multipartPatterns',
    'basicAuthCredentials'
  ]
  const other = Object.fromEntries(
    Object.entries(pattern).filter(([key]) => !consumed.includes(key))
  )
  const observed = Object.fromEntries(
    Object.keys(other).map(key => [
      key,
      key === 'scheme'
        ? url.protocol.replace(':', '')
        : key === 'host'
          ? url.hostname
          : key === 'port'
            ? Number(url.port || (url.protocol === 'https:' ? 443 : 80))
            : (request[key] ?? '(not available in journal)')
    ])
  )
  let credentials: unknown = ''
  const authorization = Object.entries(request.headers ?? {}).find(
    ([key]) => key.toLowerCase() === 'authorization'
  )?.[1]
  const auth = Array.isArray(authorization) ? authorization[0] : authorization
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6))
      const separator = decoded.indexOf(':')
      credentials = {
        username: decoded.slice(0, separator),
        password: decoded.slice(separator + 1)
      }
    } catch {
      credentials = '(invalid basic authentication)'
    }
  }
  return [
    block(
      'method',
      'Method',
      pattern.method ?? 'ANY',
      request.method,
      'HTTP method'
    ),
    block('url', 'URL', expectedUrl, actualUrl, urlKey ?? 'No URL constraint'),
    block(
      'headers',
      'Headers',
      mapValues(pattern.headers, true, true),
      mapValues(request.headers, false, true),
      'Header names are case-insensitive'
    ),
    block(
      'query',
      'Query parameters',
      mapValues(pattern.queryParameters, true),
      mapValues(parameters(url.search)),
      'Repeated query values are preserved'
    ),
    block(
      'path',
      'Path parameters',
      mapValues(pattern.pathParameters, true),
      mapValues(pathParameters(pattern.urlPathTemplate, url.pathname)),
      pattern.urlPathTemplate
        ? 'Extracted from the selected mock’s URL template'
        : 'Requires a URL template on the mock'
    ),
    block('body', 'Body', body.expected, body.actual, body.hint),
    block(
      'cookies',
      'Cookies',
      mapValues(pattern.cookies, true),
      mapValues(request.cookies)
    ),
    block(
      'form',
      'Form parameters',
      mapValues(pattern.formParameters, true),
      mapValues(form)
    ),
    block(
      'multipart',
      'Multipart',
      pretty(pattern.multipartPatterns ?? ''),
      pretty(request.parts ?? ''),
      'Configured patterns and journal parts'
    ),
    block(
      'auth',
      'Basic authentication',
      pretty(pattern.basicAuthCredentials ?? ''),
      pretty(credentials)
    ),
    block(
      'other',
      'Other matchers',
      pretty(Object.keys(other).length ? other : ''),
      pretty(Object.keys(other).length ? observed : ''),
      'Additional matcher rules and available journal values'
    )
  ]
}

export function comparisonPatch(blocks: ComparisonBlock[]): string {
  return blocks
    .map(block =>
      createTwoFilesPatch(
        `mock/${block.id}`,
        `request/${block.id}`,
        block.expected,
        block.actual,
        'Expected',
        'Received'
      )
    )
    .join('\n')
}
