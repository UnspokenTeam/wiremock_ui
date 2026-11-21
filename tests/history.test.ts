import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHistoryStore } from '../server/lib/history-store.ts'
import type { ServeEvent, StubMapping } from '../shared/types/wiremock.ts'

const primary = 'http://wiremock:8080'
const secondary = 'http://wiremock-secondary:8080'
const mapping: StubMapping = {
  id: 'mock-1',
  name: 'Order API',
  request: { method: 'POST', urlPath: '/orders' },
  response: { status: 201, jsonBody: { created: true } },
  metadata: { custom: { preserved: true } }
}
const request: ServeEvent = {
  id: 'request-1',
  request: {
    method: 'POST',
    url: '/orders?expand=items',
    body: '{"quantity":2}',
    loggedDate: 1000
  },
  wasMatched: true,
  stubMapping: mapping,
  response: { status: 201, body: '{"created":true}' }
}

test('requests and deleted mocks survive journal resets, instance switches and reopening the database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wiretap-history-'))
  const path = join(directory, 'nested', 'history.sqlite')
  let store = createHistoryStore(path)
  try {
    store.synchronize(primary, [mapping], [request], false, 2000)
    store.synchronize(
      secondary,
      [{ ...mapping, name: 'Secondary order API' }],
      [{ ...request, request: { ...request.request, body: 'secondary' } }],
      false,
      2000
    )
    // A second sync deduplicates serve-event IDs instead of duplicating traffic.
    store.synchronize(primary, [mapping], [request], false, 3000)
    assert.equal(store.readWorkspace(primary, 500)!.total, 1)
    store.synchronize(primary, [], [], false, 4000)
    const deleted = store.readWorkspace(primary, 500)!
    assert.deepEqual(deleted.requests, [request])
    assert.deepEqual(deleted.mappings, [mapping])
    assert.equal(
      deleted.history!.mappingStates[mapping.id]!.deletedAt,
      new Date(4000).toISOString()
    )
    assert.equal(deleted.history!.activeMockCount, 0)
    assert.equal(deleted.history!.deletedMockCount, 1)
    // Repeated empty syncs preserve the original removal time.
    store.synchronize(primary, [], [], false, 5000)
    assert.equal(
      store.readWorkspace(primary, 500)!.history!.mappingStates[mapping.id]!
        .deletedAt,
      new Date(4000).toISOString()
    )
    store.close()
    store = createHistoryStore(path)
    assert.deepEqual(store.readWorkspace(primary, 500)!.requests, [request])
    assert.deepEqual(store.readWorkspace(primary, 500)!.mappings, [mapping])
    assert.equal(
      store.readWorkspace(primary, 500)!.history!.deletedMockCount,
      1
    )
    const other = store.readWorkspace(secondary, 500)!
    assert.equal(other.mappings[0]!.name, 'Secondary order API')
    assert.equal(other.requests[0]!.request.body, 'secondary')
    assert.equal(other.history!.deletedMockCount, 0)
    assert.equal(
      store.getRequest(primary, request.id)!.request.body,
      '{"quantity":2}'
    )
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('offline reads retain active mocks and restoring a removed ID clears its deleted state', () => {
  const store = createHistoryStore(':memory:')
  try {
    store.rememberMapping(primary, mapping, 1000)
    const offline = store.readWorkspace(primary, 500, 'WireMock is offline')!
    assert.equal(offline.history!.connected, false)
    assert.equal(offline.history!.connectionError, 'WireMock is offline')
    assert.equal(offline.history!.mappingStates[mapping.id]!.deletedAt, null)
    store.markDeleted(primary, mapping.id, 2000)
    store.synchronize(
      primary,
      [{ ...mapping, name: 'Restored' }],
      [],
      true,
      3000
    )
    const restored = store.readWorkspace(primary, 500)!
    assert.equal(restored.mappings[0]!.name, 'Restored')
    assert.equal(
      restored.history!.mappingStates[mapping.id]!.firstSeenAt,
      new Date(1000).toISOString()
    )
    assert.equal(restored.history!.mappingStates[mapping.id]!.deletedAt, null)
    assert.equal(restored.requestJournalDisabled, true)
  } finally {
    store.close()
  }
})

test('the display window does not truncate stored traffic and unmatched synthetic stubs are excluded', () => {
  const store = createHistoryStore(':memory:')
  try {
    const events: ServeEvent[] = Array.from({ length: 600 }, (_, index) => ({
      ...request,
      id: `event-${index}`,
      wasMatched: index % 2 === 0,
      request: { ...request.request, loggedDate: index },
      stubMapping:
        index % 2 === 0
          ? mapping
          : { ...mapping, id: 'synthetic', request: { method: 'ANY' } }
    }))
    store.synchronize(primary, [], events, false)
    const window = store.readWorkspace(primary, 500)!
    assert.equal(window.requests.length, 500)
    assert.equal(window.total, 600)
    assert.equal(window.history!.matchedCount, 300)
    assert.equal(window.history!.unmatchedCount, 300)
    assert.equal(window.mappings.length, 1)
    assert.equal(window.mappings[0]!.id, mapping.id)
    assert.ok(window.history!.mappingStates[mapping.id]!.deletedAt)
    store.synchronize(primary, [], [], false)
    assert.equal(store.readWorkspace(primary, 1000)!.requests.length, 600)
    assert.equal(
      store.readWorkspace(primary, 1000)!.requests.at(-1)!.id,
      'event-0'
    )
    // A historical matched snapshot must not overwrite the latest saved mock.
    store.synchronize(primary, [{ ...mapping, name: 'Latest' }], events, false)
    assert.equal(store.readWorkspace(primary, 1)!.mappings[0]!.name, 'Latest')
  } finally {
    store.close()
  }
})
