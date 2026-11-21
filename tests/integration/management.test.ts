import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { toNetMapping, fromNetLog, type NetLogEntry } from '../../shared/utils/wiremock-net.ts'
import { duplicateMock } from '../../shared/utils/mocks.ts'
import type { StubMapping, Workspace } from '../../shared/types/wiremock.ts'

const app = process.env.WIRETAP_TEST_URL
const primary = process.env.WIREMOCK_TEST_URL
const secondary = process.env.WIREMOCK_SECONDARY_TEST_URL

async function ready(url: string) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return
    } catch {
      /* Wait for Compose. */
    }
    await setTimeout(500)
  }
  throw new Error(`Service did not become ready: ${url}`)
}

test(
  'create, edit, duplicate and delete mocks on two runtime-selected WireMock instances',
  { skip: !app || !primary || !secondary, timeout: 90000 },
  async () => {
    await Promise.all([
      ready(`${app}/api/health`),
      ready(`${primary}/__admin/mappings`),
      ready(`${secondary}/__admin/mappings`)
    ])
    const id = randomUUID()
    const path = `/management-${id}`
    const ids = [id]
    const targetHeaders = {
      'Content-Type': 'application/json',
      'X-WireMock-URL': `${secondary}/__admin/`
    }
    const mapping: StubMapping = {
      id,
      name: 'Managed through Wiretap',
      request: { method: 'GET', urlPath: path },
      response: { status: 201, jsonBody: { source: 'secondary', revision: 1 } },
      metadata: { test: true }
    }
    try {
      // The same ID on both instances makes accidental cross-instance writes detectable.
      const original = await fetch(`${primary}/__admin/mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toNetMapping({
          ...mapping,
          name: 'Primary must stay unchanged',
          response: { status: 202, jsonBody: { source: 'primary' } }
        }))
      })
      assert.equal(original.status, 201)
      const created = await fetch(`${app}/api/mappings`, {
        method: 'POST',
        headers: targetHeaders,
        body: JSON.stringify(mapping)
      })
      assert.equal(created.status, 201)
      const stored = (await created.json()) as StubMapping
      assert.equal(stored.id, id)
      const actual = await fetch(`${secondary}${path}`)
      assert.equal(actual.status, 201)
      assert.deepEqual(await actual.json(), {
        source: 'secondary',
        revision: 1
      })

      const defaultWorkspace = (await (
        await fetch(`${app}/api/workspace`)
      ).json()) as Workspace
      const secondWorkspace = (await (
        await fetch(`${app}/api/workspace`, { headers: targetHeaders })
      ).json()) as Workspace
      assert.equal(
        defaultWorkspace.mappings.find(item => item.id === id)?.name,
        'Primary must stay unchanged'
      )
      assert.equal(
        secondWorkspace.mappings.find(item => item.id === id)?.name,
        'Managed through Wiretap'
      )
      assert.ok(
        secondWorkspace.requests.some(event => event.request.url === path)
      )

      const changed = {
        ...stored,
        name: 'Updated through Wiretap',
        request: { method: 'GET', urlPath: `${path}-edited` },
        response: {
          status: 203,
          jsonBody: { source: 'secondary', revision: 2 }
        }
      }
      const edited = await fetch(`${app}/api/mappings/${id}`, {
        method: 'PUT',
        headers: targetHeaders,
        body: JSON.stringify(changed)
      })
      assert.equal(edited.status, 200)
      assert.equal((await edited.json()).name, 'Updated through Wiretap')
      assert.equal((await fetch(`${secondary}${path}-edited`)).status, 203)
      assert.equal((await fetch(`${secondary}${path}`)).status, 404)
      assert.equal((await fetch(`${primary}${path}`)).status, 202)

      const duplicated = await fetch(`${app}/api/mappings`, {
        method: 'POST',
        headers: targetHeaders,
        body: JSON.stringify(duplicateMock(changed))
      })
      assert.equal(duplicated.status, 201)
      const copy = (await duplicated.json()) as StubMapping
      ids.push(copy.id)
      assert.notEqual(copy.id, id)
      assert.equal(copy.name, 'Updated through Wiretap (copy)')
      assert.deepEqual(copy.metadata, { test: true })

      const invalid = await fetch(`${app}/api/mappings`, {
        method: 'POST',
        headers: targetHeaders,
        body: '{"request":{},"response":{"status":999}}'
      })
      assert.equal(invalid.status, 400)
      const invalidTarget = await fetch(`${app}/api/workspace`, {
        headers: { 'X-WireMock-URL': 'file:///etc/passwd' }
      })
      assert.equal(invalidTarget.status, 400)
      const idChange = await fetch(`${app}/api/mappings/${id}`, {
        method: 'PUT',
        headers: targetHeaders,
        body: JSON.stringify({ ...changed, id: randomUUID() })
      })
      assert.equal(idChange.status, 400)

      for (const mappingId of ids) {
        const removed = await fetch(`${app}/api/mappings/${mappingId}`, {
          method: 'DELETE',
          headers: targetHeaders
        })
        assert.equal(removed.status, 200)
        assert.equal(
          (await fetch(`${secondary}/__admin/mappings/${mappingId}`)).status,
          404
        )
      }
      assert.equal(
        (await fetch(`${primary}/__admin/mappings/${id}`)).status,
        200
      )
      assert.equal((await fetch(`${primary}${path}`)).status, 202)
    } finally {
      await fetch(`${primary}/__admin/mappings/${id}`, { method: 'DELETE' })
      await Promise.all(
        ids.map(mappingId =>
          fetch(`${secondary}/__admin/mappings/${mappingId}`, {
            method: 'DELETE'
          })
        )
      )
      for (const base of [primary, secondary]) {
        const journal = (await (
          await fetch(`${base}/__admin/requests`)
        ).json()) as NetLogEntry[]
        await Promise.all(
          journal.map(entry => fromNetLog(entry))
            .filter(event => event.request.url.startsWith(path))
            .map(event =>
              fetch(`${base}/__admin/requests/${event.id}`, {
                method: 'DELETE'
              })
            )
        )
      }
    }
  }
)
