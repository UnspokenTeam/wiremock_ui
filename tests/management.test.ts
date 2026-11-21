import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeInstanceUrl,
  readPreferences,
  instanceRequestHeaders
} from '../shared/utils/instances.ts'
import { createPoller } from '../shared/utils/polling.ts'
import { duplicateMock, validateMock } from '../shared/utils/mocks.ts'
import type { StubMapping } from '../shared/types/wiremock.ts'
import { headersForInstance } from '../server/lib/instance-auth.ts'

test('server credentials are retained for the default instance and never forwarded to other targets', () => {
  const credentials = {
    token: 'default-secret',
    username: 'user',
    password: 'password'
  }
  assert.equal(
    headersForInstance(
      'http://wiremock:8080',
      'http://wiremock:8080',
      credentials
    ).Authorization,
    'Bearer default-secret'
  )
  for (const target of [
    'http://secondary:8080',
    'http://wiremock:8081',
    'http://wiremock:8080/other'
  ])
    assert.equal(
      headersForInstance(target, 'http://wiremock:8080', credentials)
        .Authorization,
      undefined
    )
  assert.equal(
    headersForInstance('http://wiremock', 'http://wiremock', {
      ...credentials,
      token: ''
    }).Authorization,
    `Basic ${Buffer.from('user:password').toString('base64')}`
  )
})

test('instance addresses accept private hosts and context paths while rejecting credentials and non-HTTP targets', () => {
  assert.equal(
    normalizeInstanceUrl(' http://wiremock:8080/context/__admin/ '),
    'http://wiremock:8080/context'
  )
  assert.equal(
    normalizeInstanceUrl('https://EXAMPLE.COM:443/'),
    'https://example.com'
  )
  for (const url of [
    'file:///etc/passwd',
    'http://user:secret@wiremock',
    'http://wiremock?token=secret',
    'http://wiremock#fragment',
    'http://wiremock?',
    'not-a-url'
  ])
    assert.throws(() => normalizeInstanceUrl(url), undefined, url)
  assert.deepEqual(instanceRequestHeaders('http://second:8080/'), {
    'X-WireMock-URL': 'http://second:8080'
  })
  assert.deepEqual(instanceRequestHeaders(''), {})
})

test('saved instances and polling preferences restore with safe defaults for corrupt or removed selections', () => {
  const profiles = [
    { id: 'first', name: ' Dev ', url: 'http://first:8080/' },
    { id: 'second', name: 'QA', url: 'http://second:8080/__admin' },
    { id: 'first', name: 'Duplicate', url: 'http://duplicate' },
    { id: 'bad', name: 'Broken', url: 'javascript:alert(1)' }
  ]
  const state = readPreferences({
    instances: profiles,
    activeId: 'second',
    pollMs: 1000
  })
  assert.equal(state.instances.length, 3)
  assert.equal(state.instances[1]!.name, 'Dev')
  assert.equal(state.instances[2]!.url, 'http://second:8080')
  assert.equal(state.activeId, 'second')
  assert.equal(state.pollMs, 1000)
  assert.equal(
    readPreferences({ instances: profiles, activeId: 'removed', pollMs: 0 })
      .activeId,
    'default'
  )
  for (const pollMs of [1000, 5000, 10000, 20000, 30000, 60000])
    assert.equal(readPreferences({ pollMs }).pollMs, pollMs)
  assert.equal(readPreferences({ pollMs: '1000' }).pollMs, 5000)
  assert.equal(readPreferences(null).instances[0]!.url, '')
})

test('polling changes interval immediately and stops without leaving timers behind', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const poller = createPoller(() => {
    calls++
  })
  t.after(poller.stop)
  poller.start(5000)
  t.mock.timers.tick(4999)
  assert.equal(calls, 0)
  poller.start(1000)
  t.mock.timers.tick(999)
  assert.equal(calls, 0)
  t.mock.timers.tick(1)
  await Promise.resolve()
  assert.equal(calls, 1)
  t.mock.timers.tick(1000)
  await Promise.resolve()
  assert.equal(calls, 2)
  poller.stop()
  t.mock.timers.tick(60000)
  assert.equal(calls, 2)
})

test('slow polls never overlap, including when the rate changes, and a stopped request cannot restart polling', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  let finish: () => void = () => {}
  const poller = createPoller(() => {
    calls++
    return new Promise<void>((resolve) => {
      finish = resolve
    })
  })
  t.after(poller.stop)
  poller.start(1000)
  t.mock.timers.tick(1000)
  assert.equal(calls, 1)
  poller.start(1000)
  t.mock.timers.tick(20000)
  assert.equal(calls, 1)
  poller.stop()
  finish()
  await Promise.resolve()
  t.mock.timers.tick(20000)
  assert.equal(calls, 1)
})

test('mock duplication gets a new identity and preserves advanced fields without modifying the original', () => {
  const original: StubMapping = {
    id: '10000000-0000-4000-8000-000000000001',
    uuid: '10000000-0000-4000-8000-000000000001',
    name: 'Advanced mock',
    request: {
      method: 'POST',
      urlPathTemplate: '/orders/{id}',
      bodyPatterns: [{ matchesJsonPath: '$.items' }]
    },
    response: { status: 201, transformers: ['response-template'] },
    metadata: { team: 'payments' },
    scenarioName: 'Checkout'
  }
  const copy = duplicateMock(original)
  assert.equal(copy.id, undefined)
  assert.equal(copy.uuid, undefined)
  assert.equal(copy.name, 'Advanced mock (copy)')
  assert.deepEqual(copy.request, original.request)
  assert.deepEqual(copy.response, original.response)
  assert.equal(copy.scenarioName, 'Checkout')
  copy.request.method = 'PUT'
  assert.equal(original.request.method, 'POST')
})

test('mock validation catches invalid shapes while retaining custom matching and response features', () => {
  const draft = {
    request: { method: 'ANY', customMatcher: { name: 'my-extension' } },
    response: { fault: 'EMPTY_RESPONSE' },
    metadata: { tag: 'important' }
  }
  assert.deepEqual(validateMock(draft), draft)
  for (const value of [
    null,
    [],
    { request: {}, response: [] },
    { request: { url: '/a', urlPath: '/b' }, response: {} },
    { request: {}, response: { status: 999 } },
    { id: '../reset', request: {}, response: {} }
  ])
    assert.throws(() => validateMock(value))
})
