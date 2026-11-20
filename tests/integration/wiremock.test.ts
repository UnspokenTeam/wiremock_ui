import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { compareRequest } from '../../shared/utils/comparison.ts'
import { isMatched, matchedMapping, searchMappings } from '../../shared/utils/wiremock.ts'
import type {
  NearMiss,
  StubMapping,
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
  'real WireMock journal, matched 404s, block diffs, route search and closest mocks',
  { skip: !app || !wiremock, timeout: 90000 },
  async () => {
    await Promise.all([
      ready(`${app}/api/health`),
      ready(`${wiremock}/__admin/mappings`)
    ])
    const id = randomUUID()
    const path = `/wiretap-test-${id}`
    const mapping: StubMapping = {
      id,
      name: 'Wiretap integration fixture',
      request: {
        method: 'POST',
        urlPathTemplate: `${path}/{orderId}`,
        pathParameters: { orderId: { equalTo: 'ord_1' } },
        headers: {
          'Content-Type': { equalTo: 'application/json' },
          'X-API-Version': { equalTo: '2026-11' }
        },
        queryParameters: { expand: { equalTo: 'items' } },
        bodyPatterns: [{ equalToJson: { quantity: 2 } }]
      },
      response: {
        status: 404,
        jsonBody: { error: 'An intentional matched 404 response' }
      }
    }
    const created = await fetch(`${wiremock}/__admin/mappings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mapping)
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
      assert.ok(workspace.mappings.some((item) => item.id === id))
      const events = workspace.requests.filter((event) =>
        event.request.url.startsWith(path)
      )
      eventIds = events.map((event) => event.id)
      assert.equal(events.length, 2)
      const matched = events.find((event) => event.wasMatched)!
      const unmatched = events.find((event) => !event.wasMatched)!
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
        ).some((item) => item.id === id)
      )
      const matchedBlocks = compareRequest(mapping, matched.request)
      for (const blockId of ['method', 'query', 'path', 'body']) {
        assert.equal(
          matchedBlocks.find((block) => block.id === blockId)!.changed,
          false,
          `Matched ${blockId} block`
        )
      }
      const unmatchedBlocks = compareRequest(mapping, unmatched.request)
      for (const blockId of ['headers', 'query', 'path', 'body']) {
        assert.equal(
          unmatchedBlocks.find((block) => block.id === blockId)!.changed,
          true,
          `Unmatched ${blockId} block`
        )
      }
      assert.equal(
        JSON.parse(unmatchedBlocks.find((block) => block.id === 'body')!.actual)
          .quantity,
        1
      )
      assert.equal(
        JSON.parse(unmatchedBlocks.find((block) => block.id === 'path')!.actual)
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
      assert.ok(near.nearMisses.some((miss) => miss.stubMapping.id === id))
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
        eventIds.map((eventId) =>
          fetch(`${wiremock}/__admin/requests/${eventId}`, {
            method: 'DELETE'
          })
        )
      )
    }
  }
)
