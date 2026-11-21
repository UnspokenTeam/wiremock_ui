#!/usr/bin/env bash
set -euo pipefail

# Run against the dedicated Compose test stack. COMPOSE_PROJECT_NAME and port
# overrides are inherited, so this never needs to touch another running project.
compose=(docker compose -f compose.test.yaml)
fixture="$("${compose[@]}" exec -T wiretap node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const app = 'http://127.0.0.1:3000'
const wiremock = 'http://wiremock:80'
const id = randomUUID()
const activeId = randomUUID()
const path = `/restart-history-${id}`
for (const [mockId, url] of [[id, path], [activeId, `${path}/active`]]) {
  const created = await fetch(`${app}/api/mappings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // WireMock itself also restarts below; keep its active control mock on disk.
    body: JSON.stringify({ id: mockId, persistent: true, name: 'Restart history fixture', request: { method: 'POST', urlPath: url }, response: { status: 201 } })
  })
  assert.equal(created.status, 201)
}
await fetch(`${wiremock}${path}`, { method: 'POST', body: 'saved request body' })
const snapshot = await (await fetch(`${app}/api/workspace`)).json()
const event = snapshot.requests.find(item => item.request.url === path)
assert.ok(event)
assert.equal((await fetch(`${app}/api/mappings/${id}`, { method: 'DELETE' })).status, 200)
assert.equal((await fetch(`${wiremock}/__admin/requests/${event.id}`, { method: 'DELETE' })).status, 200)
console.log(JSON.stringify({ id, activeId, requestId: event.id, path }))
JS
)"

verify_history() {
  "${compose[@]}" exec -T -e FIXTURE_JSON="$fixture" -e EXPECT_OFFLINE="$1" wiretap node --input-type=module <<'JS'
import assert from 'node:assert/strict'
const fixture = JSON.parse(process.env.FIXTURE_JSON)
const response = await fetch('http://127.0.0.1:3000/api/workspace')
assert.equal(response.status, 200)
const workspace = await response.json()
assert.equal(workspace.history.connected, process.env.EXPECT_OFFLINE !== 'true')
assert.ok(workspace.history.mappingStates[fixture.id].deletedAt)
assert.equal(workspace.history.mappingStates[fixture.activeId].deletedAt, null, 'An outage must not mark active mocks deleted')
assert.ok(workspace.mappings.some(item => item.id === fixture.id))
const request = workspace.requests.find(item => item.id === fixture.requestId)
assert.equal(request.request.body, 'saved request body')
assert.equal(request.request.url, fixture.path)
console.log(`Verified durable history (WireMock ${workspace.history.connected ? 'connected' : 'offline'})`)
JS
}

verify_history false
trap '"${compose[@]}" up -d --wait wiremock >/dev/null 2>&1 || true' EXIT
"${compose[@]}" stop wiremock
verify_history true
# Recreate the application container, rather than just reopening one DB handle.
"${compose[@]}" up -d --no-deps --no-build --pull never --force-recreate --wait wiretap
verify_history true
"${compose[@]}" up -d --wait wiremock
verify_history false
trap - EXIT
printf 'History survived WireMock journal removal, an outage, and app container recreation.\n'
