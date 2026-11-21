import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { compareRequest } from '../../shared/utils/comparison.ts'
import type {
  NearMiss,
  StubMapping,
  Workspace
} from '../../shared/types/wiremock.ts'

const app = process.env.WIRETAP_TEST_URL
const primary = process.env.WIREMOCK_TEST_URL
const secondary = process.env.WIREMOCK_SECONDARY_TEST_URL
const jsonHeaders = { 'Content-Type': 'application/json' }

async function workspace(base?: string, limit = 2000): Promise<Workspace> {
  const response = await fetch(`${app}/api/workspace?limit=${limit}`, {
    headers: base ? { 'X-WireMock-URL': `${base}/__admin/` } : {}
  })
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}

async function batches<T>(
  items: T[],
  operation: (item: T) => Promise<unknown>
) {
  for (let index = 0; index < items.length; index += 20)
    await Promise.all(items.slice(index, index + 20).map(operation))
}

test(
  'durable history retains deleted mocks and all captured requests independently for each real instance',
  { skip: !app || !primary || !secondary, timeout: 90000 },
  async () => {
    const id = randomUUID()
    const path = `/history-${id}`
    const mapping: StubMapping = {
      id,
      name: 'Archived order route',
      request: {
        method: 'POST',
        urlPathTemplate: `${path}/{orderId}`,
        pathParameters: { orderId: { equalTo: 'ord_1' } },
        headers: { 'X-Version': { equalTo: 'v2' } },
        queryParameters: { expand: { equalTo: 'items' } },
        bodyPatterns: [{ equalToJson: { quantity: 2 } }]
      },
      response: { status: 201, jsonBody: { source: 'primary' } },
      metadata: { historyFixture: id }
    }
    let primaryEventIds: string[] = []
    let secondaryEventIds: string[] = []
    try {
      for (const [base, mock] of [
        [primary, mapping],
        [
          secondary,
          {
            ...mapping,
            name: 'Separate secondary route',
            request: { method: 'GET', urlPath: `${path}/secondary` },
            response: { status: 202 }
          }
        ]
      ] as const) {
        const response = await fetch(`${base}/__admin/mappings`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(mock)
        })
        assert.equal(response.status, 201)
      }
      for (const [orderId, expand, version, quantity] of [
        ['ord_1', 'items', 'v2', 2],
        ['ord_2', 'wrong', 'v1', 1]
      ] as const)
        await fetch(`${primary}${path}/${orderId}?expand=${expand}`, {
          method: 'POST',
          headers: { ...jsonHeaders, 'X-Version': version },
          body: JSON.stringify({ quantity })
        })
      assert.equal((await fetch(`${secondary}${path}/secondary`)).status, 202)
      // More than the default display window proves the upstream fetch isn't capped at 500.
      await batches(
        Array.from({ length: 505 }, (_, index) => index),
        index => fetch(`${primary}${path}/burst-${index}`)
      )
      const small = await workspace(undefined, 1)
      assert.equal(small.requests.length, 1)
      assert.ok(small.total >= 507)
      const before = await workspace()
      const events = before.requests.filter(event =>
        event.request.url.startsWith(path)
      )
      primaryEventIds = events.map(event => event.id)
      assert.equal(events.length, 507)
      const failed = events.find(event =>
        event.request.url.includes('/ord_2')
      )!
      assert.equal(failed.wasMatched, false)
      const firstSeen = before.history!.mappingStates[id]!.firstSeenAt

      // An external deletion becomes a tombstone, with its complete definition retained.
      assert.equal(
        (await fetch(`${primary}/__admin/mappings/${id}`, { method: 'DELETE' }))
          .status,
        200
      )
      const deleted = await workspace()
      const savedMock = deleted.mappings.find(item => item.id === id)!
      assert.deepEqual(savedMock.request, mapping.request)
      assert.deepEqual(savedMock.metadata, mapping.metadata)
      assert.ok(deleted.history!.mappingStates[id]!.deletedAt)
      assert.equal(deleted.history!.mappingStates[id]!.firstSeenAt, firstSeen)
      const blocks = compareRequest(savedMock, failed.request)
      for (const block of ['headers', 'query', 'path', 'body'])
        assert.equal(blocks.find(item => item.id === block)!.changed, true)

      const other = await workspace(secondary)
      secondaryEventIds = other.requests
        .filter(event => event.request.url.startsWith(path))
        .map(event => event.id)
      assert.equal(
        other.mappings.find(item => item.id === id)!.name,
        'Separate secondary route'
      )
      assert.equal(other.history!.mappingStates[id]!.deletedAt, null)
      assert.equal(secondaryEventIds.length, 1)
      assert.ok(
        !other.requests.some(event => primaryEventIds.includes(event.id))
      )
      assert.deepEqual(
        (await workspace()).requests.filter(event =>
          event.request.url.startsWith(path)
        ),
        events
      )

      // Recreating the same upstream ID restores it without erasing its requests.
      const restored = await fetch(`${app}/api/mappings`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(mapping)
      })
      assert.equal(restored.status, 201)
      assert.equal(
        (await workspace()).history!.mappingStates[id]!.deletedAt,
        null
      )
      const removed = await fetch(`${app}/api/mappings/${id}`, {
        method: 'DELETE'
      })
      assert.equal(removed.status, 200)
      assert.ok((await removed.json()).history.deletedAt)

      // Remove recorded events from WireMock; archived payloads and comparisons survive.
      await batches(primaryEventIds, eventId =>
        fetch(`${primary}/__admin/requests/${eventId}`, { method: 'DELETE' })
      )
      await batches(secondaryEventIds, eventId =>
        fetch(`${secondary}/__admin/requests/${eventId}`, { method: 'DELETE' })
      )
      const retained = await workspace()
      assert.deepEqual(
        retained.requests.filter(event => event.request.url.startsWith(path)),
        events
      )
      assert.ok(retained.history!.mappingStates[id]!.deletedAt)
      const near = await fetch(`${app}/api/near-misses`, {
        method: 'POST',
        headers: { ...jsonHeaders, 'X-WireMock-URL': secondary! },
        body: JSON.stringify({ requestId: secondaryEventIds[0] })
      })
      assert.equal(
        near.status,
        200,
        'Near-miss matching uses the archived request after its journal entry is deleted'
      )
      assert.ok(
        ((await near.json()) as { nearMisses: NearMiss[] }).nearMisses.some(
          miss => miss.stubMapping.id === id
        )
      )
      assert.equal(
        (await workspace(secondary)).history!.mappingStates[id]!.deletedAt,
        null
      )
    } finally {
      await Promise.all(
        [primary, secondary].map(base =>
          fetch(`${base}/__admin/mappings/${id}`, { method: 'DELETE' })
        )
      )
      await batches(primaryEventIds, eventId =>
        fetch(`${primary}/__admin/requests/${eventId}`, { method: 'DELETE' })
      )
      await batches(secondaryEventIds, eventId =>
        fetch(`${secondary}/__admin/requests/${eventId}`, { method: 'DELETE' })
      )
    }
  }
)
