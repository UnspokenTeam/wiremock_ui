import test from 'node:test'
import assert from 'node:assert/strict'
import { fromNetLog, fromNetMapping, toNetMapping, type NetLogEntry, type NetMapping } from '../shared/utils/wiremock-net.ts'
import { compareRequest } from '../shared/utils/comparison.ts'
import { duplicateMock, validateMock } from '../shared/utils/mocks.ts'
import { searchMappings } from '../shared/utils/wiremock.ts'

const id = '21111111-1111-4111-8111-111111111111'
const native: NetMapping = {
  Guid: id, Title: 'Native order route', Priority: 2,
  Request: {
    Methods: ['POST'],
    Path: { Matchers: [{ Name: 'RegexMatcher', Pattern: '^/orders/(?<orderId>ord_1)$', IgnoreCase: false }] },
    Headers: [{ Name: 'X-Version', Matchers: [{ Name: 'ExactMatcher', Pattern: 'v2', IgnoreCase: false }] }],
    Params: [{ Name: 'expand', Matchers: [{ Name: 'ExactMatcher', Pattern: 'items' }] }],
    Body: { Matcher: { Name: 'JsonMatcher', Pattern: { quantity: 2 }, IgnoreCase: false, Regex: false } }
  },
  Response: { StatusCode: 404, BodyAsJson: { intentional: true } }
}

function log(overrides: Partial<NetLogEntry> = {}): NetLogEntry {
  return {
    Guid: '31111111-1111-4111-8111-111111111111',
    Request: {
      Method: 'POST', Url: 'http://wiremock/orders/ord_1?expand=items',
      Headers: { 'X-Version': ['v2'] }, BodyAsJson: { quantity: 2 },
      DateTime: '2026-11-21T12:00:00Z'
    },
    Response: { StatusCode: 404 }, MappingGuid: id,
    RequestMatchResult: { IsPerfectMatch: true }, ...overrides
  }
}

test('native .NET logs distinguish matched 404s and retain body, dates and relative URLs', () => {
  const mapping = fromNetMapping(native)
  const event = fromNetLog(log(), [mapping])
  assert.equal(event.wasMatched, true)
  assert.equal(event.stubMapping?.id, id)
  assert.equal(event.request.url, '/orders/ord_1?expand=items')
  assert.equal(event.request.body, '{"quantity":2}')
  assert.equal(event.request.loggedDate, Date.parse('2026-11-21T12:00:00Z'))
  for (const block of compareRequest(mapping, event.request).filter(block => ['method', 'headers', 'query', 'path', 'body'].includes(block.id)))
    assert.equal(block.changed, false, block.id)
  const unmatched = fromNetLog(log({ MappingGuid: undefined, PartialMappingGuid: id }))
  assert.equal(unmatched.wasMatched, false)
  assert.equal(unmatched.stubMapping, undefined)
  const partial = fromNetLog(log({ RequestMatchResult: { IsPerfectMatch: false } }), [mapping])
  assert.equal(partial.wasMatched, false)
  assert.equal(partial.stubMapping, undefined)
})

test('named .NET path groups expose mismatching values in their own diff block', () => {
  const mapping = fromNetMapping(native)
  const event = fromNetLog(log({ Request: { Method: 'POST', Url: '/orders/ord_2?expand=wrong', Body: '{"quantity":1}' } }))
  const blocks = compareRequest(mapping, event.request)
  assert.deepEqual(JSON.parse(blocks.find(block => block.id === 'path')!.actual), { orderId: 'ord_2' })
  assert.equal(blocks.find(block => block.id === 'query')!.changed, true)
  assert.equal(blocks.find(block => block.id === 'body')!.changed, true)
})

test('native advanced fields and matcher options survive editing and duplication', () => {
  const advanced: NetMapping = {
    ...native, Description: 'Keep me', SetStateTo: 'next', Probability: 0.75,
    Webhooks: [{ Request: { Url: 'http://example.test/hook', Method: 'POST' } }],
    Request: {
      ...native.Request, Methods: ['GET', 'POST'], ClientIP: { Matchers: [{ Name: 'WildcardMatcher', Pattern: '10.*' }] },
      Path: { MatchOperator: 'or', Matchers: [{ Name: 'WildcardMatcher', Pattern: '/orders/*', IgnoreCase: true, RejectOnMatch: true }] },
      Body: { MatchOperator: 'and', Matchers: [{ Name: 'JsonPathMatcher', Pattern: '$.quantity' }, { Name: 'CustomMatcher', PatternAsFile: 'rule.txt' }] }
    },
    Response: { ...native.Response, UseTransformer: true, TransformerType: 'Scriban', Fault: { Type: 'EMPTY_RESPONSE', Percentage: 5 } }
  }
  const mapping = fromNetMapping(advanced)
  const roundTrip = toNetMapping(mapping)
  assert.deepEqual(roundTrip, { ...advanced, Request: { ...advanced.Request, Methods: ['GET', 'POST'] } })
  const copy = duplicateMock(mapping)
  const copied = toNetMapping(copy)
  assert.equal(copied.Guid, undefined)
  assert.equal(copied.Title, 'Native order route (copy)')
  assert.deepEqual(copied.Request, advanced.Request)
  assert.deepEqual(copied.Response, advanced.Response)
  assert.equal(searchMappings([mapping], '/orders', 'POST').length, 1)
  assert.deepEqual(validateMock(advanced).request, mapping.request)
})

test('new native JSON drafts can omit the GUID and unsupported foreign rules fail clearly', () => {
  const { Guid: _guid, ...draft } = native
  assert.equal(validateMock(draft).id, undefined)
  assert.throws(() => toNetMapping({ request: { bodyPatterns: [{ equalToJson: {}, ignoreArrayOrder: true }] }, response: { status: 200 } }), /native WireMock.Net/)
  assert.throws(() => toNetMapping({ request: { multipartPatterns: [{}] }, response: { status: 200 } }), /native WireMock.Net/)
})
