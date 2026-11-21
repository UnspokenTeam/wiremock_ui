import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { duplicateMock } from '../../shared/utils/mocks.ts'
import type { StubMapping } from '../../shared/types/wiremock.ts'
import type { NetMapping } from '../../shared/utils/wiremock-net.ts'

const app = process.env.WIRETAP_TEST_URL
const wiremock = process.env.WIREMOCK_TEST_URL
const headers = { 'Content-Type': 'application/json' }

test('native .NET JSON, matcher options and advanced response fields survive editing and duplication',
  { skip: !app || !wiremock, timeout: 30000 }, async () => {
    const id = randomUUID()
    const invalidId = randomUUID()
    const ids = [id, invalidId]
    const path = `/native-${id}`
    const native: NetMapping = {
      Guid: id, Title: 'Native JSON fixture', Description: 'Keep this description', Priority: 0,
      Request: {
        Methods: ['GET', 'POST'],
        Path: { MatchOperator: 'or', Matchers: [{ Name: 'WildcardMatcher', Pattern: `${path}/*`, IgnoreCase: true }] },
        Headers: [{ Name: 'X-Native', Matchers: [{ Name: 'ExactMatcher', Pattern: 'Yes', IgnoreCase: true }] }],
        Params: [{ Name: 'expand', Matchers: [{ Name: 'RegexMatcher', Pattern: '^(a|b)$' }] }]
      },
      Response: {
        StatusCode: 201, BodyAsJson: { source: 'native' },
        Headers: { 'X-Native-Response': 'retained' }, Delay: 1, UseTransformer: true
      },
      Data: { fixture: id }
    }
    try {
      const created = await fetch(`${app}/api/mappings`, { method: 'POST', headers, body: JSON.stringify(native) })
      assert.equal(created.status, 201, await created.clone().text())
      const saved = await created.json() as StubMapping
      assert.equal(saved.priority, 0)
      assert.equal(saved.request.method, 'GET, POST')
      const received = await fetch(`${wiremock}${path.toUpperCase()}/one?expand=a`, { headers: { 'X-Native': 'yes' } })
      assert.equal(received.status, 201)
      assert.deepEqual(await received.json(), { source: 'native' })
      assert.equal(received.headers.get('x-native-response'), 'retained')

      const original = await (await fetch(`${wiremock}/__admin/mappings/${id}`)).json() as NetMapping
      const edited = await fetch(`${app}/api/mappings/${id}`, {
        method: 'PUT', headers, body: JSON.stringify({ ...original, Title: 'Edited native JSON' })
      })
      assert.equal(edited.status, 200, await edited.clone().text())
      const updated = await edited.json() as StubMapping
      const direct = await (await fetch(`${wiremock}/__admin/mappings/${id}`)).json() as NetMapping
      assert.equal(direct.Title, 'Edited native JSON')
      assert.equal(direct.Description, native.Description)
      assert.deepEqual(direct.Request, original.Request)
      assert.deepEqual(direct.Response, original.Response)
      assert.deepEqual(direct.Data, native.Data)

      const copied = await fetch(`${app}/api/mappings`, { method: 'POST', headers, body: JSON.stringify(duplicateMock(updated)) })
      assert.equal(copied.status, 201, await copied.clone().text())
      const copy = await copied.json() as StubMapping
      ids.push(copy.id)
      assert.notEqual(copy.id, id)
      const actualCopy = await (await fetch(`${wiremock}/__admin/mappings/${copy.id}`)).json() as NetMapping
      assert.deepEqual(actualCopy.Request, direct.Request)
      assert.deepEqual(actualCopy.Response, direct.Response)
      assert.equal(actualCopy.Description, native.Description)

      const invalid = await fetch(`${app}/api/mappings`, {
        method: 'POST', headers,
        body: JSON.stringify({ ...native, Guid: invalidId, Request: { Path: { Matchers: [{ Name: 'NotARealMatcher', Pattern: '/invalid' }] } } })
      })
      assert.equal(invalid.status, 422)
      const error = await invalid.json() as { data: { details: string } }
      assert.match(error.data.details, /NotARealMatcher.*not supported/)
      assert.ok(!error.data.details.includes('\n'), 'Do not expose the upstream stack trace')
    } finally {
      await Promise.all(ids.map(id => fetch(`${wiremock}/__admin/mappings/${id}`, { method: 'DELETE' })))
    }
  })
