<script setup lang="ts">
import {
  isMatched,
  mappingName,
  routeUrl,
  searchMappings,
  statusCode
} from '#shared/utils/wiremock'
import type { ServeEvent, StubMapping } from '#shared/types/wiremock'

const {
  data,
  loading,
  error,
  demo,
  live,
  limit,
  baseUrl,
  requests,
  mappings,
  selectedRequestId,
  selectedMockId,
  selectedRequest,
  selectedMock,
  comparisonMappings,
  nearMisses,
  nearMissLoading,
  nearMissError,
  autoSelectMock,
  refresh,
  setDemo
} = useWorkspace()

const view = ref<'requests' | 'mappings' | 'compare'>('requests')
const search = ref('')
const routeSearch = ref('')
const method = ref('ALL')
const matchFilter = ref('all')
const inspectorTab = ref('compare')
const connectionOpen = ref(false)
const mobileDetail = ref(false)
const viewNames = {
  requests: 'Request journal',
  mappings: 'Mock routes',
  compare: 'Compare requests'
}
const matched = computed(() => requests.value.filter(isMatched).length)
const unmatched = computed(() => requests.value.length - matched.value)
const methods = computed(() => [
  { label: 'All methods', value: 'ALL' },
  ...[
    ...new Set([
      ...requests.value.map((event) => event.request.method),
      ...mappings.value.map((mapping) => mapping.request.method ?? 'ANY')
    ])
  ]
    .sort()
    .map((value) => ({ label: value, value }))
])
const visibleRequests = computed(() => {
  const terms = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return requests.value.filter(
    (event) =>
      (method.value === 'ALL' || event.request.method === method.value) &&
      (matchFilter.value === 'all' ||
        (matchFilter.value === 'matched'
          ? isMatched(event)
          : !isMatched(event))) &&
      terms.every((term) =>
        `${event.request.method} ${event.request.url} ${event.id}`
          .toLowerCase()
          .includes(term)
      )
  )
})
const visibleMappings = computed(() =>
  searchMappings(mappings.value, search.value, method.value)
)
const mockOptions = computed(() =>
  searchMappings(comparisonMappings.value, routeSearch.value).map(
    (mapping) => ({
      label: `${mapping.request.method ?? 'ANY'} ${routeUrl(mapping.request)} · ${mappingName(mapping)}`,
      value: mapping.id
    })
  )
)
const requestOptions = computed(() =>
  requests.value.map((event) => ({
    label: `${event.request.method} ${event.request.url} · ${time(event)}`,
    value: event.id
  }))
)
const selectedNearMiss = computed(() =>
  nearMisses.value.find((miss) => miss.stubMapping.id === selectedMockId.value)
)
const connected = computed(() => Boolean(data.value) && !error.value)
const routeTab = ref('pattern')

watch(view, (next) => {
  search.value = ''
  method.value = 'ALL'
  mobileDetail.value = false
  autoSelectMock.value = next === 'requests'
})
watch([visibleRequests, view], () => {
  if (
    view.value === 'requests' &&
    !visibleRequests.value.some((event) => event.id === selectedRequestId.value)
  )
    selectedRequestId.value = visibleRequests.value[0]?.id ?? ''
})
watch([visibleMappings, view], () => {
  if (
    view.value === 'mappings' &&
    !visibleMappings.value.some(
      (mapping) => mapping.id === selectedMockId.value
    )
  )
    selectedMockId.value = visibleMappings.value[0]?.id ?? ''
})

function time(event: ServeEvent) {
  const date = event.request.loggedDate ?? event.request.loggedDateString
  return date
    ? new Date(date).toLocaleTimeString('en-GB', { hour12: false })
    : '—'
}
function selectRequest(id: string) {
  selectedRequestId.value = id
  mobileDetail.value = true
}
function selectMapping(id: string) {
  selectedMockId.value = id
  mobileDetail.value = true
}
function compareMapping(mapping: StubMapping) {
  view.value = 'compare'
  selectedMockId.value = mapping.id
}
function statFilter(filter: string) {
  view.value = 'requests'
  matchFilter.value = filter
}
function resetFilters() {
  search.value = ''
  method.value = 'ALL'
  matchFilter.value = 'all'
}
async function loadOlder() {
  limit.value = Math.min(10000, limit.value + 500)
  await refresh()
}
function shortcut(event: KeyboardEvent) {
  if (
    event.key !== '/' ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName) ||
    (event.target as HTMLElement)?.isContentEditable
  )
    return
  event.preventDefault()
  document.getElementById('workspace-search')?.focus()
}
onMounted(() => window.addEventListener('keydown', shortcut))
onBeforeUnmount(() => window.removeEventListener('keydown', shortcut))
</script>

<template>
  <div class="workspace-shell">
    <aside class="sidebar">
      <NuxtLink to="/" class="brand" aria-label="Wiretap home"
        ><span class="brand-mark"><UIcon name="i-lucide-activity" /></span
        ><span>wiretap<span class="brand-period">.</span></span></NuxtLink
      >
      <div class="workspace-switch">
        <span class="workspace-avatar">W</span>
        <div>
          <strong>WireMock workspace</strong
          ><span>Your API, under the lens</span>
        </div>
        <UIcon name="i-lucide-chevrons-up-down" />
      </div>
      <p class="nav-label">WORKSPACE</p>
      <nav class="main-nav" aria-label="Workspace">
        <button
          aria-label="Request journal"
          :class="{ active: view === 'requests' }"
          :aria-current="view === 'requests' ? 'page' : undefined"
          @click="view = 'requests'"
        >
          <UIcon name="i-lucide-radio" /><span>Request journal</span
          ><span v-if="requests.length" class="nav-count">{{
            requests.length
          }}</span>
        </button>
        <button
          aria-label="Mock routes"
          :class="{ active: view === 'mappings' }"
          :aria-current="view === 'mappings' ? 'page' : undefined"
          @click="view = 'mappings'"
        >
          <UIcon name="i-lucide-route" /><span>Mock routes</span
          ><span v-if="mappings.length" class="nav-count">{{
            mappings.length
          }}</span>
        </button>
        <button
          aria-label="Compare requests"
          :class="{ active: view === 'compare' }"
          :aria-current="view === 'compare' ? 'page' : undefined"
          @click="view = 'compare'"
        >
          <UIcon name="i-lucide-git-compare-arrows" /><span
            >Compare requests</span
          >
        </button>
      </nav>
      <div class="sidebar-note">
        <UIcon name="i-lucide-scan-line" /><strong
          >A little clarity.<br />A lot less guessing.</strong
        >
        <p>Follow your requests from<br />“what happened?” to “aha.”</p>
      </div>
      <div class="sidebar-bottom">
        <button
          aria-label="WireMock connection"
          class="connection-card"
          @click="connectionOpen = true"
        >
          <span class="connection-icon"><UIcon name="i-lucide-server" /></span
          ><span
            ><strong>{{ demo ? 'Demo workspace' : 'WireMock instance' }}</strong
            ><small
              ><span
                class="status-dot"
                :class="demo ? 'demo' : connected ? 'online' : 'offline'"
              />{{
                demo
                  ? 'Sample traffic'
                  : connected
                    ? 'Connected'
                    : 'Disconnected'
              }}</small
            ></span
          ><UIcon name="i-lucide-settings-2" />
        </button>
        <div class="sidebar-footer">
          <a
            href="https://wiremock.org/docs/standalone/admin-api-reference/"
            target="_blank"
            rel="noopener noreferrer"
            ><UIcon name="i-lucide-book-open" />API reference</a
          ><UColorModeButton size="sm" />
        </div>
      </div>
    </aside>

    <main class="main-area">
      <header class="topbar">
        <div class="breadcrumb">
          <UIcon name="i-lucide-box" /><span>Workspace</span
          ><span class="breadcrumb-separator">/</span
          ><strong>{{ viewNames[view] }}</strong>
        </div>
        <div class="topbar-right">
          <span class="workspace-status"
            ><span
              class="status-dot"
              :class="demo ? 'demo' : connected ? 'online' : 'offline'"
            />{{
              demo
                ? 'Demo mode'
                : connected
                  ? 'Instance connected'
                  : 'No connection'
            }}</span
          ><span class="topbar-divider" /><UButton
            icon="i-lucide-settings-2"
            variant="ghost"
            color="neutral"
            aria-label="Connection settings"
            @click="connectionOpen = true"
          />
        </div>
      </header>
      <div class="page-content">
        <div class="page-heading">
          <div>
            <div class="eyebrow">OBSERVE. INSPECT. UNDERSTAND.</div>
            <h1>{{ viewNames[view] }}<span class="heading-dot">.</span></h1>
            <p>
              {{
                view === 'requests'
                  ? 'Every request. Every match. The full picture.'
                  : view === 'mappings'
                    ? 'Find the right mock, down to the last detail.'
                    : 'One mock. One request. Every difference, in focus.'
              }}
            </p>
          </div>
          <div class="heading-actions">
            <UBadge v-if="demo" color="warning" variant="subtle" size="lg"
              >Sample data</UBadge
            ><template v-else
              ><UButton
                :icon="live ? 'i-lucide-pause' : 'i-lucide-play'"
                color="neutral"
                variant="outline"
                :label="live ? 'Pause live' : 'Resume live'"
                :aria-pressed="!live"
                @click="live = !live" /><UButton
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="outline"
                :loading="loading"
                aria-label="Refresh workspace"
                @click="refresh"
            /></template>
          </div>
        </div>

        <div class="stats-row" aria-label="Workspace overview">
          <button
            class="stat-card"
            :class="{ selected: view === 'requests' && matchFilter === 'all' }"
            @click="statFilter('all')"
          >
            <span class="stat-label"
              ><UIcon name="i-lucide-inbox" />Received requests</span
            >
            <div>
              <strong>{{ requests.length.toLocaleString() }}</strong><span
                class="stat-footnote"
                >{{
                  data && data.total > requests.length
                    ? `of ${data.total.toLocaleString()} in journal`
                    : 'in the request journal'
                }}</span
              ><UIcon
                class="stat-spark"
                name="i-lucide-chart-no-axes-column-increasing"
              />
            </div>
          </button>
          <button
            class="stat-card"
            :class="{
              selected: view === 'requests' && matchFilter === 'matched'
            }"
            @click="statFilter('matched')"
          >
            <span class="stat-label"
              ><UIcon name="i-lucide-circle-check" />Matched</span
            >
            <div>
              <strong>{{ matched.toLocaleString() }}</strong><span
                class="stat-footnote"
                >found their mock</span
              ><span class="stat-status success"
                ><UIcon name="i-lucide-check"
              /></span>
            </div>
          </button>
          <button
            class="stat-card"
            :class="{
              selected: view === 'requests' && matchFilter === 'unmatched'
            }"
            @click="statFilter('unmatched')"
          >
            <span class="stat-label"
              ><UIcon name="i-lucide-circle-dashed" />Unmatched</span
            >
            <div>
              <strong>{{ unmatched.toLocaleString() }}</strong><span
                class="stat-footnote"
                >worth a closer look</span
              ><span class="stat-status warning"
                ><UIcon name="i-lucide-scan-search"
              /></span>
            </div>
          </button>
          <button
            class="stat-card"
            :class="{ selected: view === 'mappings' }"
            @click="view = 'mappings'"
          >
            <span class="stat-label"
              ><UIcon name="i-lucide-route" />Mock routes</span
            >
            <div>
              <strong>{{ mappings.length.toLocaleString() }}</strong><span
                class="stat-footnote"
                >ready to respond</span
              ><span class="stat-status violet"
                ><UIcon name="i-lucide-braces"
              /></span>
            </div>
          </button>
        </div>

        <div v-if="demo" class="demo-notice">
          <UIcon name="i-lucide-flask-conical" /><span
            >You’re exploring sample traffic. Connect your WireMock instance to
            see real requests.</span
          ><button @click="setDemo(false)">Use live instance</button>
        </div>
        <UAlert
          v-if="data?.requestJournalDisabled"
          class="workspace-alert"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Request journal is disabled"
          description="Enable the request journal in WireMock to inspect incoming traffic. Mock routes are still available."
        />
        <UAlert
          v-if="error && data"
          class="workspace-alert"
          color="warning"
          variant="subtle"
          icon="i-lucide-wifi-off"
          title="Connection lost · showing the last successful snapshot"
          :description="error"
        />

        <div v-if="loading && !data" class="workspace-empty">
          <div class="empty-icon spinning">
            <UIcon name="i-lucide-loader-circle" />
          </div>
          <h2>Connecting the dots</h2>
          <p>Reading your WireMock routes and request journal…</p>
        </div>
        <div
          v-else-if="error && !data"
          class="workspace-empty connection-empty"
        >
          <div class="empty-icon"><UIcon name="i-lucide-unplug" /></div>
          <span class="eyebrow">LET’S GET CONNECTED</span>
          <h2>Your requests belong here.</h2>
          <p>{{ error }}</p>
          <code class="instance-address">{{ baseUrl }}</code>
          <div class="empty-actions">
            <UButton
              icon="i-lucide-refresh-cw"
              label="Try again"
              :loading="loading"
              @click="refresh"
            /><UButton
              label="Connection settings"
              color="neutral"
              variant="outline"
              @click="connectionOpen = true"
            />
          </div>
          <button class="text-link" @click="setDemo(true)">
            <UIcon name="i-lucide-flask-conical" />Explore a demo workspace
          </button>
        </div>

        <template v-else-if="data">
          <div
            v-if="view !== 'compare'"
            class="explorer"
            :class="{ 'show-mobile-detail': mobileDetail }"
          >
            <section
              class="list-panel"
              :aria-label="
                view === 'requests' ? 'Received requests' : 'Mock routes'
              "
            >
              <div class="list-toolbar">
                <UInput
                  id="workspace-search"
                  v-model="search"
                  icon="i-lucide-search"
                  :placeholder="
                    view === 'mappings'
                      ? 'Search mock routes…'
                      : 'Search requests…'
                  "
                  :aria-label="
                    view === 'mappings'
                      ? 'Search mock routes'
                      : 'Search requests'
                  "
                  size="lg"
                  ><template #trailing><kbd>/</kbd></template></UInput
                ><USelect
                  v-model="method"
                  :items="methods"
                  aria-label="Filter HTTP method"
                  class="method-select"
                  size="sm"
                />
              </div>
              <div
                v-if="view === 'requests'"
                class="list-tabs"
                role="group"
                aria-label="Filter match status"
              >
                <button
                  :class="{ active: matchFilter === 'all' }"
                  :aria-pressed="matchFilter === 'all'"
                  @click="matchFilter = 'all'"
                >
                  All <span>{{ requests.length }}</span></button
                ><button
                  :class="{ active: matchFilter === 'matched' }"
                  :aria-pressed="matchFilter === 'matched'"
                  @click="matchFilter = 'matched'"
                >
                  Matched <span>{{ matched }}</span></button
                ><button
                  :class="{ active: matchFilter === 'unmatched' }"
                  :aria-pressed="matchFilter === 'unmatched'"
                  @click="matchFilter = 'unmatched'"
                >
                  Unmatched <span>{{ unmatched }}</span>
                </button>
              </div>
              <div v-else class="route-list-label">
                <span>ROUTE / NAME</span
                ><span>{{ visibleMappings.length }} routes</span>
              </div>
              <div class="item-list">
                <template v-if="view === 'requests'">
                  <button
                    v-for="event in visibleRequests"
                    :key="event.id"
                    class="request-item"
                    :class="{ selected: selectedRequestId === event.id }"
                    :aria-pressed="selectedRequestId === event.id"
                    @click="selectRequest(event.id)"
                  >
                    <div class="item-route">
                      <MethodBadge :method="event.request.method" /><code
                        :title="event.request.url"
                        >{{ event.request.url }}</code
                      >
                    </div>
                    <div class="item-meta">
                      <span
                        class="match-state"
                        :class="isMatched(event) ? 'matched' : 'unmatched'"
                        ><UIcon
                          :name="
                            isMatched(event)
                              ? 'i-lucide-check'
                              : 'i-lucide-circle-dashed'
                          "
                        />{{ isMatched(event) ? 'Matched' : 'Unmatched' }}</span
                      ><span
                        >{{ statusCode(event) ?? '—'
                        }}<span class="meta-dot">·</span>{{ time(event) }}</span
                      >
                    </div>
                  </button>
                  <div v-if="!visibleRequests.length" class="small-empty">
                    <UIcon name="i-lucide-inbox" />
                    <h3>
                      {{
                        requests.length
                          ? 'No requests found'
                          : 'Listening for requests'
                      }}
                    </h3>
                    <p>
                      {{
                        requests.length
                          ? 'Try another search or filter.'
                          : 'Send a request to your WireMock instance. It will appear here.'
                      }}
                    </p>
                    <UButton
                      v-if="requests.length"
                      label="Reset filters"
                      variant="link"
                      @click="resetFilters"
                    />
                  </div>
                </template>
                <template v-else>
                  <button
                    v-for="mapping in visibleMappings"
                    :key="mapping.id"
                    class="request-item mapping-item"
                    :class="{ selected: selectedMockId === mapping.id }"
                    :aria-pressed="selectedMockId === mapping.id"
                    @click="selectMapping(mapping.id)"
                  >
                    <div class="item-route">
                      <MethodBadge
                        :method="mapping.request.method || 'ANY'"
                      /><code :title="routeUrl(mapping.request)">{{
                        routeUrl(mapping.request)
                      }}</code>
                    </div>
                    <div class="item-meta">
                      <span>{{ mappingName(mapping) }}</span><span
                        class="response-code"
                        >{{ mapping.response.status ?? '—' }}</span
                      >
                    </div>
                  </button>
                  <div v-if="!visibleMappings.length" class="small-empty">
                    <UIcon name="i-lucide-route" />
                    <h3>
                      {{
                        mappings.length
                          ? 'No routes found'
                          : 'No mock routes yet'
                      }}
                    </h3>
                    <p>
                      {{
                        mappings.length
                          ? 'Search by URL, name, method, scenario, or ID.'
                          : 'Add stub mappings to WireMock to explore them here.'
                      }}
                    </p>
                    <UButton
                      v-if="mappings.length"
                      label="Reset filters"
                      variant="link"
                      @click="resetFilters"
                    />
                  </div>
                </template>
              </div>
              <div class="list-footer">
                <span
                  >{{
                    view === 'requests'
                      ? visibleRequests.length
                      : visibleMappings.length
                  }}
                  {{ view === 'requests' ? 'requests' : 'routes' }} shown</span
                ><UButton
                  v-if="
                    view === 'requests' &&
                    !demo &&
                    data.total > requests.length &&
                    limit < 10000
                  "
                  label="Load older"
                  color="neutral"
                  variant="link"
                  size="xs"
                  :loading="loading"
                  @click="loadOlder"
                /><span
                  v-else-if="
                    view === 'requests' && data.total > requests.length
                  "
                  >Latest {{ limit.toLocaleString() }} max</span
                ><span v-else
                  ><span
                    class="status-dot"
                    :class="demo ? 'demo' : live ? 'online' : 'offline'"
                  />{{
                    demo
                      ? 'Sample snapshot'
                      : live
                        ? 'Updating every 5s'
                        : 'Live paused'
                  }}</span
                >
              </div>
            </section>

            <section class="detail-panel" aria-label="Selected item details">
              <button
                class="mobile-back text-link"
                @click="mobileDetail = false"
              >
                <UIcon name="i-lucide-chevron-left" />Back to list
              </button>
              <template v-if="view === 'requests' && selectedRequest">
                <div class="detail-heading">
                  <div class="detail-title">
                    <MethodBadge :method="selectedRequest.request.method" />
                    <h2>{{ selectedRequest.request.url }}</h2>
                  </div>
                  <div class="detail-metadata">
                    <span
                      class="match-state"
                      :class="
                        isMatched(selectedRequest) ? 'matched' : 'unmatched'
                      "
                      ><UIcon
                        :name="
                          isMatched(selectedRequest)
                            ? 'i-lucide-circle-check'
                            : 'i-lucide-circle-dashed'
                        "
                      />{{
                        isMatched(selectedRequest)
                          ? 'Matched a mock'
                          : 'No matching mock'
                      }}</span
                    ><span>{{ time(selectedRequest) }}</span
                    ><span v-if="selectedRequest.timing?.totalTime != null"
                      >{{ selectedRequest.timing.totalTime }} ms</span
                    ><span v-if="statusCode(selectedRequest)"
                      >HTTP {{ statusCode(selectedRequest) }}</span
                    >
                  </div>
                  <div class="request-id">{{ selectedRequest.id }}</div>
                </div>
                <div
                  class="detail-tabs"
                  role="group"
                  aria-label="Request details"
                >
                  <button
                    :class="{ active: inspectorTab === 'compare' }"
                    :aria-pressed="inspectorTab === 'compare'"
                    @click="inspectorTab = 'compare'"
                  >
                    <UIcon name="i-lucide-git-compare-arrows" />Compare with
                    mock</button
                  ><button
                    :class="{ active: inspectorTab === 'request' }"
                    :aria-pressed="inspectorTab === 'request'"
                    @click="inspectorTab = 'request'"
                  >
                    Request</button
                  ><button
                    :class="{ active: inspectorTab === 'response' }"
                    :aria-pressed="inspectorTab === 'response'"
                    @click="inspectorTab = 'response'"
                  >
                    Response
                  </button>
                </div>
                <div v-if="inspectorTab === 'compare'" class="comparison-area">
                  <div class="mock-picker">
                    <div class="picker-label">
                      <span>COMPARE AGAINST</span
                      ><span v-if="nearMissLoading"
                        ><UIcon
                          name="i-lucide-loader-circle"
                          class="spinning"
                        />Finding closest mocks</span
                      ><span
                        v-else-if="
                          selectedRequest.stubMapping?.id === selectedMockId
                        "
                        ><UIcon name="i-lucide-link" />Matched mock</span
                      ><span v-else-if="selectedNearMiss"
                        ><UIcon name="i-lucide-sparkles" />{{
                          demo ? 'Demo suggestion' : 'WireMock suggestion'
                        }}</span
                      >
                    </div>
                    <UInput
                      v-model="routeSearch"
                      icon="i-lucide-search"
                      placeholder="Find a mock route…"
                      aria-label="Search mocks to compare"
                      size="sm"
                    /><USelect
                      v-model="selectedMockId"
                      :items="mockOptions"
                      placeholder="Choose any mock route"
                      aria-label="Select mock to compare"
                      size="lg"
                    />
                    <p v-if="nearMissError" class="near-miss-error">
                      {{ nearMissError }}
                    </p>
                    <div v-if="nearMisses.length > 1" class="suggestions">
                      <span>Closest:</span
                      ><button
                        v-for="miss in nearMisses"
                        :key="miss.stubMapping.id"
                        :class="{
                          active: selectedMockId === miss.stubMapping.id
                        }"
                        @click="selectedMockId = miss.stubMapping.id"
                      >
                        {{ mappingName(miss.stubMapping) }}
                      </button>
                    </div>
                  </div>
                  <RequestDiff
                    v-if="selectedMock"
                    :mapping="selectedMock"
                    :request="selectedRequest.request"
                  />
                  <div v-else class="small-empty">
                    <UIcon name="i-lucide-git-compare" />
                    <h3>Select a mock to compare</h3>
                    <p>
                      {{
                        mappings.length
                          ? 'Choose any route above to inspect each request block.'
                          : 'No mock routes are available on this instance.'
                      }}
                    </p>
                  </div>
                </div>
                <div v-else class="raw-details">
                  <JsonView
                    :value="
                      inspectorTab === 'request'
                        ? selectedRequest.request
                        : {
                            response: selectedRequest.response,
                            responseDefinition:
                              selectedRequest.responseDefinition,
                            timing: selectedRequest.timing
                          }
                    "
                    :label="
                      inspectorTab === 'request'
                        ? 'Received request'
                        : 'Served response'
                    "
                  />
                </div>
              </template>
              <template v-else-if="view === 'mappings' && selectedMock">
                <div class="detail-heading">
                  <div class="eyebrow">STUB MAPPING</div>
                  <h2 class="mapping-name">{{ mappingName(selectedMock) }}</h2>
                  <div class="detail-title">
                    <MethodBadge
                      :method="selectedMock.request.method || 'ANY'"
                    /><code>{{ routeUrl(selectedMock.request) }}</code>
                  </div>
                  <div class="detail-metadata">
                    <span>HTTP {{ selectedMock.response.status ?? '—' }}</span
                    ><span>Priority {{ selectedMock.priority ?? 5 }}</span
                    ><span v-if="selectedMock.scenarioName">{{
                      selectedMock.scenarioName
                    }}</span>
                  </div>
                  <div class="request-id">{{ selectedMock.id }}</div>
                  <UButton
                    icon="i-lucide-git-compare-arrows"
                    label="Compare with a request"
                    variant="soft"
                    :disabled="!requests.length"
                    @click="compareMapping(selectedMock)"
                  />
                </div>
                <div class="detail-tabs" role="group" aria-label="Mock details">
                  <button
                    :class="{ active: routeTab === 'pattern' }"
                    :aria-pressed="routeTab === 'pattern'"
                    @click="routeTab = 'pattern'"
                  >
                    Request pattern</button
                  ><button
                    :class="{ active: routeTab === 'response' }"
                    :aria-pressed="routeTab === 'response'"
                    @click="routeTab = 'response'"
                  >
                    Response</button
                  ><button
                    :class="{ active: routeTab === 'mapping' }"
                    :aria-pressed="routeTab === 'mapping'"
                    @click="routeTab = 'mapping'"
                  >
                    Full mapping
                  </button>
                </div>
                <div class="raw-details">
                  <JsonView
                    :value="
                      routeTab === 'pattern'
                        ? selectedMock.request
                        : routeTab === 'response'
                          ? selectedMock.response
                          : selectedMock
                    "
                    :label="
                      routeTab === 'pattern'
                        ? 'Configured request pattern'
                        : routeTab === 'response'
                          ? 'Response definition'
                          : 'Stub mapping'
                    "
                  />
                </div>
              </template>
              <div v-else class="detail-empty">
                <UIcon
                  :name="
                    view === 'requests'
                      ? 'i-lucide-mouse-pointer-2'
                      : 'i-lucide-route'
                  "
                />
                <h3>A closer look starts here</h3>
                <p>
                  Select
                  {{ view === 'requests' ? 'a request' : 'a mock route' }} to
                  inspect its details.
                </p>
              </div>
            </section>
          </div>

          <div v-else class="compare-workspace">
            <div class="pair-selectors">
              <div>
                <label for="compare-request"
                  >RECEIVED REQUEST
                  <span>{{ requests.length }} available</span></label
                ><USelectMenu
                  id="compare-request"
                  v-model="selectedRequestId"
                  :items="requestOptions"
                  value-key="value"
                  placeholder="Choose a request…"
                  :search-input="{ placeholder: 'Search received requests…' }"
                  aria-label="Choose request to compare"
                  size="lg"
                />
              </div>
              <span class="pair-icon"
                ><UIcon name="i-lucide-git-compare-arrows"
              /></span>
              <div>
                <label for="compare-mock"
                  >MOCK ROUTE
                  <span>{{ comparisonMappings.length }} available</span></label
                ><USelectMenu
                  id="compare-mock"
                  v-model="selectedMockId"
                  :items="
                    comparisonMappings.map((mapping) => ({
                      label: `${mapping.request.method || 'ANY'} ${routeUrl(mapping.request)} · ${mappingName(mapping)}`,
                      value: mapping.id
                    }))
                  "
                  value-key="value"
                  placeholder="Choose any mock…"
                  :search-input="{ placeholder: 'Search mock routes…' }"
                  aria-label="Choose mock to compare"
                  size="lg"
                />
              </div>
            </div>
            <div v-if="selectedRequest && selectedMock" class="full-comparison">
              <div class="comparison-caption">
                <span
                  class="match-state"
                  :class="isMatched(selectedRequest) ? 'matched' : 'unmatched'"
                  ><UIcon
                    :name="
                      isMatched(selectedRequest)
                        ? 'i-lucide-circle-check'
                        : 'i-lucide-circle-dashed'
                    "
                  />{{
                    isMatched(selectedRequest)
                      ? 'Request matched a mock in WireMock'
                      : 'Request was unmatched in WireMock'
                  }}</span
                ><span>Compare any pair independently of match status</span>
              </div>
              <RequestDiff
                :mapping="selectedMock"
                :request="selectedRequest.request"
              />
            </div>
            <div v-else class="workspace-empty">
              <div class="empty-icon">
                <UIcon name="i-lucide-git-compare-arrows" />
              </div>
              <h2>Put any pair side by side.</h2>
              <p>
                Choose a received request and a mock route above to compare
                their URL, headers, body, and more.
              </p>
            </div>
          </div>
        </template>
        <footer class="page-footer">
          <span
            ><UIcon name="i-lucide-activity" />A clearer view of your mock
            APIs.</span
          ><span
            >Wiretap <span class="meta-dot">·</span> Powered by WireMock</span
          >
        </footer>
      </div>
    </main>

    <UModal
      v-model:open="connectionOpen"
      title="Your WireMock connection"
      description="Connect the workspace to the instance you want to inspect."
      :ui="{ content: 'max-w-xl' }"
      ><template #body
        ><div class="connection-settings">
          <label>INSTANCE ADDRESS</label
          ><code class="instance-address">{{ baseUrl }}</code>
          <p>
            Set the address on the app server, then restart it. When using
            Docker, use a hostname reachable from inside the app’s container.
          </p>
          <JsonView
            value="NUXT_WIREMOCK_BASE_URL=http://localhost:8080"
            label="Environment setting"
          />
          <p>
            Optional authentication: set
            <code>NUXT_WIREMOCK_AUTH_TOKEN</code> for a bearer token, or
            <code>NUXT_WIREMOCK_USERNAME</code> and
            <code>NUXT_WIREMOCK_PASSWORD</code> for basic authentication.
            Credentials stay on the server.
          </p>
          <div class="connection-options">
            <span
              ><strong>Live refresh</strong
              ><small>Check for new requests every 5 seconds</small></span
            ><USwitch v-model="live" aria-label="Live refresh" />
          </div>
          <div class="connection-options">
            <span
              ><strong>Demo workspace</strong
              ><small>Explore a separate set of sample requests</small></span
            ><USwitch
              :model-value="demo"
              aria-label="Demo workspace"
              @update:model-value="setDemo"
            />
          </div></div></template
      ><template #footer
        ><UButton label="Done" @click="connectionOpen = false" /><UButton
          v-if="!demo"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          label="Retry connection"
          :loading="loading"
          @click="refresh" /></template
    ></UModal>
  </div>
</template>
