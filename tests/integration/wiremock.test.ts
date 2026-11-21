import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { compareRequest } from '../../shared/utils/comparison.ts'
import { isMatched, matchedMapping, searchMappings } from '../../shared/utils/wiremock.ts'
import type {
  NearMiss,
  Workspace
} from '../../shared/types/wiremock.ts'

const app = process.env.WIRETAP_TEST_URL
const wiremock = process.env.WIREMOCK_TEST_URL

async function ready(url: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return
    } catch {
      /* Startup can take a few seconds. */
    }
    await setTimeout(500)
  }
  throw new Error(`Service did not become ready: ${url}`)
}

test(
  'real WireMock.Net journal, matched 404s, block diffs, route search and closest mocks',
  { skip: !app || !wiremock, timeout: 90000 },
  async () => {
    await Promise.all([
      ready(`${app}/api/health`),
      ready(`${wiremock}/__admin/mappings`)
    ])
    const id = randomUUID()
    const path = `/wiretap-test-${id}`
    const native = {
      Guid: id,
      Title: 'Wiretap integration fixture',
      Request: {
        Methods: ['POST'],
        Path: { Matchers: [{ Name: 'RegexMatcher', Pattern: `^${path}/(?<orderId>ord_1)$` }] },
        Headers: [
          { Name: 'Content-Type', Matchers: [{ Name: 'ExactMatcher', Pattern: 'application/json' }] },
          { Name: 'X-API-Version', Matchers: [{ Name: 'ExactMatcher', Pattern: '2026-11' }] }
        ],
        Params: [{ Name: 'expand', Matchers: [{ Name: 'ExactMatcher', Pattern: 'items' }] }],
        Body: { Matcher: { Name: 'JsonMatcher', Pattern: { quantity: 2 } } }
      },
      Response: { StatusCode: 404, BodyAsJson: { error: 'An intentional matched 404 response' } }
    }
    const created = await fetch(`${wiremock}/__admin/mappings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(native)
    })
    assert.equal(created.status, 201)
    let eventIds: string[] = []
    try {
      await fetch(`${wiremock}${path}/ord_1?expand=items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Version': '2026-11'
        },
        body: '{"quantity":2}'
      })
      await fetch(`${wiremock}${path}/ord_2?expand=wrong`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Version': '2026-10'
        },
        body: '{"quantity":1}'
      })
      const response = await fetch(`${app}/api/workspace?limit=100`)
      assert.equal(response.status, 200)
      assert.match(response.headers.get('cache-control') ?? '', /no-store/)
      const workspace = (await response.json()) as Workspace
      assert.ok(workspace.mappings.some(item => item.id === id))
      const events = workspace.requests.filter(event =>
        event.request.url.startsWith(path)
      )
      eventIds = events.map(event => event.id)
      assert.equal(events.length, 2)
      const matched = events.find(event => event.wasMatched)!
      const unmatched = events.find(event => !event.wasMatched)!
      assert.ok(matched)
      assert.equal(matched.responseDefinition?.status, 404)
      assert.equal(matched.stubMapping?.id, id)
      assert.ok(unmatched)
      assert.equal(isMatched(matched), true)
      assert.equal(isMatched(unmatched), false)
      assert.equal(matchedMapping(matched)?.id, id)
      assert.equal(matchedMapping(unmatched), undefined, 'Do not compare against WireMock’s synthetic unmatched stub')
      assert.ok(workspace.total >= 2)
      assert.equal(workspace.requestJournalDisabled, false)
      assert.ok(
        searchMappings(
          workspace.mappings,
          'Wiretap integration fixture',
          'POST'
        ).some(item => item.id === id)
      )
      const mapping = workspace.mappings.find(item => item.id === id)!
      const matchedBlocks = compareRequest(mapping, matched.request)
      for (const blockId of ['method', 'query', 'path', 'body']) {
        assert.equal(
          matchedBlocks.find(block => block.id === blockId)!.changed,
          false,
          `Matched ${blockId} block`
        )
      }
      const unmatchedBlocks = compareRequest(mapping, unmatched.request)
      for (const blockId of ['headers', 'query', 'path', 'body']) {
        assert.equal(
          unmatchedBlocks.find(block => block.id === blockId)!.changed,
          true,
          `Unmatched ${blockId} block`
        )
      }
      assert.equal(
        JSON.parse(unmatchedBlocks.find(block => block.id === 'body')!.actual)
          .quantity,
        1
      )
      assert.equal(
        JSON.parse(unmatchedBlocks.find(block => block.id === 'path')!.actual)
          .orderId,
        'ord_2'
      )
      const nearResponse = await fetch(`${app}/api/near-misses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: unmatched.id })
      })
      assert.equal(nearResponse.status, 200)
      const near = (await nearResponse.json()) as { nearMisses: NearMiss[] }
      assert.ok(near.nearMisses.some(miss => miss.stubMapping.id === id))
      // A later edit must not rewrite the definitions saved with older traffic.
      const changed = await fetch(`${wiremock}/__admin/mappings/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...native, Title: 'Changed after capture', Request: { ...native.Request, Body: { Matcher: { Name: 'JsonMatcher', Pattern: { quantity: 3 } } } } })
      })
      assert.equal(changed.status, 200)
      const refreshed = await (await fetch(`${app}/api/workspace`)).json() as Workspace
      assert.equal(refreshed.mappings.find(item => item.id === id)?.name, 'Changed after capture')
      assert.equal(refreshed.requests.find(item => item.id === matched.id)?.stubMapping?.name, native.Title)
      const savedNear = await (await fetch(`${app}/api/near-misses`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: unmatched.id })
      })).json() as { nearMisses: NearMiss[] }
      assert.equal(savedNear.nearMisses[0]?.stubMapping.name, native.Title)
      const invalid = await fetch(`${app}/api/near-misses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"requestId":"../shutdown"}'
      })
      assert.equal(invalid.status, 400)
      const connection = await (await fetch(`${app}/api/connection`)).json()
      assert.deepEqual(Object.keys(connection), ['baseUrl'])
    } finally {
      await fetch(`${wiremock}/__admin/mappings/${id}`, { method: 'DELETE' })
      await Promise.all(
        eventIds.map(eventId =>
          fetch(`${wiremock}/__admin/requests/${eventId}`, {
            method: 'DELETE'
          })
        )
      )
    }
  }
)
