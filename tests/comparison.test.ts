import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPatch, parsePatch } from 'diff'
import {
  compareRequest,
  comparisonPatch,
  lineDiff,
  pathParameters,
  splitLines
} from '../shared/utils/comparison.ts'
import { isMatched, matchedMapping, searchMappings } from '../shared/utils/wiremock.ts'
import type {
  LoggedRequest,
  RequestPattern,
  StubMapping
} from '../shared/types/wiremock.ts'

function compare(
  pattern: RequestPattern,
  request: Partial<LoggedRequest> = {}
) {
  return compareRequest(
    { id: 'mock', request: pattern, response: { status: 200 } },
    { method: 'GET', url: '/orders/abc', ...request }
  )
}

test('normalizes header case and single-value arrays while retaining extra headers', () => {
  const header = compare(
    { headers: { 'Content-Type': { equalTo: 'application/json' } } },
    { headers: { 'content-type': ['application/json'] } }
  ).find((block) => block.id === 'headers')!
  assert.equal(header.changed, false)
  const extra = compare({}, { headers: { 'X-Trace': 'abc' } }).find(
    (block) => block.id === 'headers'
  )!
  assert.match(extra.actual, /x-trace/)
  assert.equal(extra.expected, '')
})

test('compares decoded query values, duplicates, blanks, and missing keys', () => {
  const query = compare(
    {
      queryParameters: {
        q: { equalTo: 'hello world' },
        empty: { equalTo: '' }
      }
    },
    { url: '/orders?q=hello+world&tag=a&tag=b&empty=' }
  ).find((block) => block.id === 'query')!
  assert.deepEqual(JSON.parse(query.actual), {
    empty: '',
    q: 'hello world',
    tag: ['a', 'b']
  })
  assert.equal(JSON.parse(query.expected).q, 'hello world')
})

test('extracts path parameters using the selected mock, escaping literal regex characters', () => {
  assert.deepEqual(
    pathParameters(
      '/v1.0/orders/{id}/items/{sku}',
      '/v1.0/orders/a%20b/items/C%2FD'
    ),
    { id: 'a b', sku: 'C/D' }
  )
  assert.match(
    String(pathParameters('/v1.0/{id}', '/v1X0/x')['(path)']),
    /Does not fit/
  )
  assert.deepEqual(pathParameters('/orders/{id}', '/orders/%ZZ'), {
    id: '%ZZ'
  })
  const path = compare({
    urlPathTemplate: '/orders/{id}',
    pathParameters: { id: { equalTo: 'abc' } }
  }).find((block) => block.id === 'path')!
  assert.equal(path.changed, false)
})

test('JSON body equality sorts object keys, preserves array order, and exposes matcher flags', () => {
  const body = compare(
    {
      bodyPatterns: [
        { equalToJson: '{"b":2,"a":[1,2]}', ignoreExtraElements: true }
      ]
    },
    { body: '{"a":[1,2],"b":2}' }
  ).find((block) => block.id === 'body')!
  assert.equal(body.changed, false)
  assert.match(body.hint, /ignoreExtraElements/)
  const changed = compare(
    { bodyPatterns: [{ equalToJson: { a: [1, 2] } }] },
    { body: '{"a":[2,1]}' }
  ).find((block) => block.id === 'body')!
  assert.equal(changed.changed, true)
  const nullBody = compare(
    { bodyPatterns: [{ equalToJson: 'null' }] },
    { body: 'null' }
  ).find((block) => block.id === 'body')!
  assert.equal(nullBody.expected, 'null')
})

test('keeps regex, logical, absent, JSONPath, and custom matchers visible without evaluating them', () => {
  const blocks = compare(
    {
      headers: { Accept: { matches: '.*json.*' }, missing: { absent: true } },
      bodyPatterns: [{ matchesJsonPath: '$.items' }, { contains: 'sku' }],
      customMatcher: { name: 'custom-rule' }
    },
    { headers: { Accept: 'application/json' }, body: '{"items":[]}' }
  )
  assert.match(
    blocks.find((block) => block.id === 'headers')!.expected,
    /matches/
  )
  assert.match(
    blocks.find((block) => block.id === 'body')!.expected,
    /matchesJsonPath/
  )
  assert.match(
    blocks.find((block) => block.id === 'other')!.expected,
    /custom-rule/
  )
})

test('form, cookies, multipart, basic authentication and binary bodies are represented', () => {
  const blocks = compare(
    {
      formParameters: { q: { equalTo: 'hello world' } },
      cookies: { session: { equalTo: 'abc' } },
      multipartPatterns: [{ matchingType: 'ANY' }],
      basicAuthCredentials: { username: 'user', password: 'p:ass' }
    },
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa('user:p:ass')}`
      },
      body: 'q=hello+world',
      cookies: { session: { name: 'session', value: 'abc' } },
      parts: [{ name: 'file' }]
    }
  )
  for (const id of ['form', 'cookies', 'auth'])
    assert.equal(blocks.find((block) => block.id === id)!.changed, false, id)
  assert.match(blocks.find((block) => block.id === 'multipart')!.actual, /file/)
  const binary = compare(
    { bodyPatterns: [{ binaryEqualTo: 'AQID' }] },
    { bodyAsBase64: 'AQID' }
  ).find((block) => block.id === 'body')!
  assert.equal(binary.changed, false)
})

test('URL matching uses query only for full-URL patterns', () => {
  const path = compare(
    { urlPath: '/orders/abc' },
    { url: '/orders/abc?a=2' }
  ).find((block) => block.id === 'url')!
  assert.equal(path.changed, false)
  const url = compare(
    { url: '/orders/abc?a=1' },
    { url: '/orders/abc?a=2' }
  ).find((block) => block.id === 'url')!
  assert.equal(url.changed, true)
})

test('split and unified diffs align insertions, removals, context, and line numbers', () => {
  const lines = lineDiff('a\nb\nc\n', 'a\nx\ny\nc\n')
  assert.deepEqual(
    lines.map((line) => line.kind),
    ['context', 'removed', 'added', 'added', 'context']
  )
  const split = splitLines(lines)
  assert.equal(split[1]!.left!.text, 'b')
  assert.equal(split[1]!.right!.text, 'x')
  assert.equal(split[2]!.left, undefined)
  assert.equal(split[2]!.right!.newLine, 3)
  assert.equal(split[3]!.left!.oldLine, 3)
  assert.equal(lineDiff('', '').length, 0)
})

test('downloaded patch reconstructs every request block, including final-newline changes', () => {
  const blocks = compare(
    { bodyPatterns: [{ equalTo: 'old\n' }], method: 'POST' },
    { method: 'PUT', body: 'new' }
  )
  const patches = parsePatch(comparisonPatch(blocks))
  assert.equal(patches.length, blocks.length)
  for (const [index, patch] of patches.entries())
    assert.equal(
      applyPatch(blocks[index]!.expected, patch),
      blocks[index]!.actual
    )
  assert.ok(lineDiff('same\n', 'same').some((line) => line.kind !== 'context'))
})

test('match status comes from WireMock, independently of response status or textual differences', () => {
  const request = { method: 'GET', url: '/' }
  assert.equal(
    isMatched({
      id: '1',
      request,
      wasMatched: true,
      responseDefinition: { status: 404 }
    }),
    true
  )
  assert.equal(
    isMatched({
      id: '2',
      request,
      wasMatched: false,
      responseDefinition: { status: 200 }
    }),
    false
  )
  assert.equal(
    isMatched({
      id: '3',
      request,
      responseDefinition: { fromConfiguredStub: false }
    }),
    false
  )
})

test('unmatched default stubs are excluded from comparisons while matched 404 stubs are retained', () => {
  const stubMapping: StubMapping = {
    id: 'synthetic-default',
    request: { method: 'ANY' },
    response: { status: 404, fromConfiguredStub: false }
  }
  const request = { method: 'POST', url: '/orders/ord_2' }
  assert.equal(
    matchedMapping({ id: 'unmatched', request, wasMatched: false, stubMapping }),
    undefined
  )
  assert.equal(
    matchedMapping({ id: 'matched-404', request, wasMatched: true, stubMapping }),
    stubMapping
  )
  assert.equal(matchedMapping(undefined), undefined)
})

test('route search finds names, templates, IDs, scenarios and metadata with method filtering', () => {
  const mapping: StubMapping = {
    id: 'route-id',
    name: 'Update order',
    scenarioName: 'Checkout',
    metadata: { team: 'payments' },
    request: { method: 'PATCH', urlPathTemplate: '/orders/{id}' },
    response: { status: 200 }
  }
  for (const query of [
    'orders',
    'UPDATE',
    'route-id',
    'checkout',
    'payments',
    'patch order'
  ])
    assert.equal(searchMappings([mapping], query).length, 1, query)
  assert.equal(searchMappings([mapping], 'orders', 'GET').length, 0)
  assert.equal(searchMappings([mapping], 'unknown').length, 0)
})
