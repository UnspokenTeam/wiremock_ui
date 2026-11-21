<script setup lang="ts">
import {
  isMatched,
  mappingName,
  routeUrl,
  searchMappings,
  statusCode
} from '#shared/utils/wiremock'
import type { ServeEvent, StubMapping } from '#shared/types/wiremock'
import { duplicateMock } from '#shared/utils/mocks'
import type { MockDraft } from '#shared/utils/mocks'
import { pollingIntervals } from '#shared/utils/instances'

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
  setDemo,
  instances,
  activeInstanceId,
  activeInstance,
  defaultBaseUrl,
  pollMs,
  saveInstance,
  removeInstance,
  mutationLoading,
  saveMock,
  deleteMock
} = useWorkspace()

const view = shallowRef<'requests' | 'mappings' | 'compare'>('requests')
const search = shallowRef('')
const routeSearch = shallowRef('')
const method = shallowRef('ALL')
const matchFilter = shallowRef('all')
const mappingFilter = shallowRef('all')
const inspectorTab = shallowRef('compare')
const connectionOpen = shallowRef(false)
const mobileDetail = shallowRef(false)
const viewNames = {
  requests: 'Request journal',
  mappings: 'Mock routes',
  compare: 'Compare requests'
}
const loadedMatched = computed(() => requests.value.filter(isMatched).length)
const loadedUnmatched = computed(
  () => requests.value.length - loadedMatched.value
)
const matched = computed(
  () => data.value?.history?.matchedCount ?? loadedMatched.value
)
const unmatched = computed(
  () => data.value?.history?.unmatchedCount ?? loadedUnmatched.value
)
const activeMocks = computed(
  () => data.value?.history?.activeMockCount ?? mappings.value.length
)
const deletedMocks = computed(() => data.value?.history?.deletedMockCount ?? 0)
const mappingHistory = computed(() => data.value?.history?.mappingStates ?? {})
const selectedMockHistory = computed(() =>
  selectedMock.value ? mappingHistory.value[selectedMock.value.id] : undefined
)
const mappingFilters = [
  { label: 'All mocks', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Deleted', value: 'deleted' }
]
function deletedMapping(mapping: StubMapping) {
  return Boolean(mappingHistory.value[mapping.id]?.deletedAt)
}
function mockLabel(mapping: StubMapping) {
  return `${deletedMapping(mapping) ? '[Deleted] ' : ''}${mapping.request.method ?? 'ANY'} ${routeUrl(mapping.request)} · ${mappingName(mapping)}`
}
const methods = computed(() => [
  { label: 'All methods', value: 'ALL' },
  ...[
    ...new Set([
      ...requests.value.map(event => event.request.method),
      ...mappings.value.map(mapping => mapping.request.method ?? 'ANY')
    ])
  ]
    .sort()
    .map(value => ({ label: value, value }))
])
const visibleRequests = computed(() => {
  const terms = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return requests.value.filter(
    event =>
      (method.value === 'ALL' || event.request.method === method.value)
      && (matchFilter.value === 'all'
        || (matchFilter.value === 'matched'
          ? isMatched(event)
          : !isMatched(event)))
        && terms.every(term =>
          `${event.request.method} ${event.request.url} ${event.id}`
            .toLowerCase()
            .includes(term)
        )
  )
})
const visibleMappings = computed(() =>
  searchMappings(mappings.value, search.value, method.value).filter(
    mapping =>
      mappingFilter.value === 'all'
      || (mappingFilter.value === 'deleted'
        ? deletedMapping(mapping)
        : !deletedMapping(mapping))
  )
)
const mockOptions = computed(() =>
  searchMappings(comparisonMappings.value, routeSearch.value).map(
    mapping => ({
      label: mockLabel(mapping),
      value: mapping.id
    })
  )
)
const requestOptions = computed(() =>
  requests.value.map(event => ({
    label: `${event.request.method} ${event.request.url} · ${time(event)}`,
    value: event.id
  }))
)
const selectedNearMiss = computed(() =>
  nearMisses.value.find(miss => miss.stubMapping.id === selectedMockId.value)
)
const connected = computed(() => Boolean(data.value) && !error.value)
const routeTab = shallowRef('pattern')
const pollingOptions = pollingIntervals.map(value => ({
  label: `Every ${value / 1000}s`,
  value: Number(value)
}))
const editorOpen = shallowRef(false)
const editorDraft = shallowRef<MockDraft>()
const editId = shallowRef<string>()
const deleteTarget = shallowRef<StubMapping>()
const deleteError = shallowRef('')
const deleteOpen = computed({
  get: () => Boolean(deleteTarget.value),
  set: (value) => {
    if (!value) deleteTarget.value = undefined
  }
})
const canManageSelected = computed(
  () =>
    mappings.value.some(
      mapping =>
        mapping.id === selectedMockId.value && !deletedMapping(mapping)
    ) && connected.value
)
const toast = useToast()

function openEditor(action: 'create' | 'edit' | 'duplicate') {
  const mapping = selectedMock.value
  editId.value = action === 'edit' ? mapping?.id : undefined
  editorDraft.value
    = action === 'duplicate' && mapping
      ? duplicateMock(mapping)
      : action === 'edit' && mapping
        ? JSON.parse(JSON.stringify(mapping))
        : undefined
  editorOpen.value = true
}
async function submitMock(value: MockDraft) {
  const editing = Boolean(editId.value)
  const saved = await saveMock(value, editId.value)
  if (!saved) return
  view.value = 'mappings'
  search.value = ''
  method.value = 'ALL'
  mappingFilter.value = 'all'
  selectedMockId.value = saved.id
  mobileDetail.value = true
  toast.add({
    title: editing ? 'Mock updated' : 'Mock created',
    description: demo.value
      ? 'Saved in the demo workspace.'
      : `Saved on ${activeInstance.value.name}.`,
    color: 'success'
  })
}
function askDelete() {
  deleteError.value = ''
  deleteTarget.value = selectedMock.value
}
async function confirmDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleteError.value = ''
  try {
    if (await deleteMock(target.id)) {
      deleteTarget.value = undefined
      toast.add({
        title: demo.value ? 'Mock deleted' : 'Mock deleted · saved in history',
        color: 'success'
      })
    }
  } catch (cause) {
    deleteError.value
      = (cause as { data?: { statusMessage?: string }, message?: string }).data
        ?.statusMessage ?? (cause as Error).message
  }
}
watch(
  [() => `${activeInstance.value.id}|${activeInstance.value.url}`, demo],
  () => {
    editorOpen.value = false
    deleteTarget.value = undefined
    routeSearch.value = ''
    mappingFilter.value = 'all'
    mobileDetail.value = false
  }
)

watch(view, (next) => {
  search.value = ''
  method.value = 'ALL'
  mobileDetail.value = false
  autoSelectMock.value = next === 'requests'
})
watch([visibleRequests, view], () => {
  if (
    view.value === 'requests'
    && !visibleRequests.value.some(event => event.id === selectedRequestId.value)
  )
    selectedRequestId.value = visibleRequests.value[0]?.id ?? ''
})
watch([visibleMappings, view], () => {
  if (
    view.value === 'mappings'
    && !visibleMappings.value.some(
      mapping => mapping.id === selectedMockId.value
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
  mappingFilter.value = 'all'
}
async function loadOlder() {
  limit.value += 500
  await refresh()
}
function shortcut(event: KeyboardEvent) {
  if (
    event.key !== '/'
    || event.metaKey
    || event.ctrlKey
    || event.altKey
    || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName)
    || (event.target as HTMLElement)?.isContentEditable
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
      <NuxtLink
        to="/"
        class="brand"
        aria-label="Wiretap home"
      ><span class="brand-mark"><UIcon name="i-lucide-activity" /></span><span>wiretap<span class="brand-period">.</span></span></NuxtLink>
      <button
        class="workspace-switch"
        aria-label="Manage WireMock instances"
        :title="`Instances & refresh · ${activeInstance.name}`"
        @click="connectionOpen = true"
      >
        <span class="workspace-avatar"><UIcon name="i-lucide-server" /></span>
        <div>
          <strong>{{ activeInstance.name }}</strong><span :title="baseUrl">{{ baseUrl }}</span>
        </div>
        <UIcon name="i-lucide-chevrons-up-down" />
      </button>
      <p class="nav-label">
        WORKSPACE
      </p>
      <nav
        class="main-nav"
        aria-label="Workspace"
      >
        <button
          aria-label="Request journal"
          :class="{ active: view === 'requests' }"
          :aria-current="view === 'requests' ? 'page' : undefined"
          @click="view = 'requests'"
        >
          <UIcon name="i-lucide-radio" /><span>Request journal</span><span
            v-if="requests.length"
            class="nav-count"
          >{{
            requests.length
          }}</span>
        </button>
        <button
          aria-label="Mock routes"
          :class="{ active: view === 'mappings' }"
          :aria-current="view === 'mappings' ? 'page' : undefined"
          @click="view = 'mappings'"
        >
          <UIcon name="i-lucide-route" /><span>Mock routes</span><span
            v-if="mappings.length"
            class="nav-count"
          >{{
            mappings.length
          }}</span>
        </button>
        <button
          aria-label="Compare requests"
          :class="{ active: view === 'compare' }"
          :aria-current="view === 'compare' ? 'page' : undefined"
          @click="view = 'compare'"
        >
          <UIcon name="i-lucide-git-compare-arrows" /><span>Compare requests</span>
        </button>
      </nav>
      <div class="sidebar-note">
        <UIcon name="i-lucide-scan-line" /><strong>A little clarity.<br>A lot less guessing.</strong>
        <p>Follow your requests from<br>“what happened?” to “aha.”</p>
      </div>
      <div class="sidebar-bottom">
        <div class="sidebar-footer">
          <a
            href="https://wiremock.org/docs/standalone/admin-api-reference/"
            target="_blank"
            rel="noopener noreferrer"
          ><UIcon name="i-lucide-book-open" />API reference</a><UColorModeButton size="sm" />
        </div>
      </div>
    </aside>

    <main class="main-area">
      <header class="topbar">
        <div class="breadcrumb">
          <UIcon name="i-lucide-box" /><span>Workspace</span><span class="breadcrumb-separator">/</span><strong>{{ viewNames[view] }}</strong>
        </div>
        <span
          class="workspace-status"
          role="status"
        ><span
          class="status-dot"
          :class="{ demo, online: !demo && connected }"
        />{{ demo ? 'Demo mode' : connected ? 'Connected' : 'Disconnected' }}</span>
      </header>
      <div class="page-content">
        <div class="page-heading">
          <div>
            <div class="eyebrow">
              OBSERVE. INSPECT. UNDERSTAND.
            </div>
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
            <UButton
              v-if="view === 'mappings'"
              icon="i-lucide-plus"
              label="New mock"
              aria-label="New mock"
              :disabled="!data || mutationLoading"
              @click="openEditor('create')"
            />
            <UBadge
              v-if="demo"
              color="warning"
              variant="subtle"
              size="lg"
            >
              Sample data
            </UBadge><template v-else>
              <div>
                <USelect
                  v-model="pollMs"
                  :items="pollingOptions"
                  aria-label="Polling rate"
                  class="polling-select"
                  size="sm"
                />
              </div>
              <UButton
                :icon="live ? 'i-lucide-pause' : 'i-lucide-play'"
                color="neutral"
                variant="outline"
                :label="live ? 'Pause live' : 'Resume live'"
                :aria-label="live ? 'Pause live' : 'Resume live'"
                :aria-pressed="!live"
                @click="live = !live"
              /><UButton
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="outline"
                :loading="loading"
                aria-label="Refresh workspace"
                @click="refresh"
              />
            </template>
          </div>
        </div>

        <div
          class="stats-row"
          aria-label="Workspace overview"
        >
          <button
            class="stat-card"
            :class="{ selected: view === 'requests' && matchFilter === 'all' }"
            @click="statFilter('all')"
          >
            <span class="stat-label"><UIcon name="i-lucide-inbox" />Received requests</span>
            <div>
              <strong>{{
                (data?.total ?? requests.length).toLocaleString()
              }}</strong><span class="stat-footnote">{{
                demo ? 'in the sample journal' : 'saved in history'
              }}</span><UIcon
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
            <span class="stat-label"><UIcon name="i-lucide-circle-check" />Matched</span>
            <div>
              <strong>{{ matched.toLocaleString() }}</strong><span class="stat-footnote">found their mock</span><span class="stat-status success"><UIcon name="i-lucide-check" /></span>
            </div>
          </button>
          <button
            class="stat-card"
            :class="{
              selected: view === 'requests' && matchFilter === 'unmatched'
            }"
            @click="statFilter('unmatched')"
          >
            <span class="stat-label"><UIcon name="i-lucide-circle-dashed" />Unmatched</span>
            <div>
              <strong>{{ unmatched.toLocaleString() }}</strong><span class="stat-footnote">worth a closer look</span><span class="stat-status warning"><UIcon name="i-lucide-scan-search" /></span>
            </div>
          </button>
          <button
            class="stat-card"
            :class="{ selected: view === 'mappings' }"
            @click="view = 'mappings'"
          >
            <span class="stat-label"><UIcon name="i-lucide-route" />Mock routes</span>
            <div>
              <strong>{{ mappings.length.toLocaleString() }}</strong><span class="stat-footnote">{{ activeMocks }} active · {{ deletedMocks }} deleted</span><span class="stat-status violet"><UIcon name="i-lucide-braces" /></span>
            </div>
          </button>
        </div>

        <div
          v-if="demo"
          class="demo-notice"
        >
          <UIcon name="i-lucide-flask-conical" /><span>You’re exploring sample traffic. Connect your WireMock instance to
            see real requests.</span><button @click="setDemo(false)">
            Use live instance
          </button>
        </div>
        <UAlert
          v-if="data?.requestJournalDisabled"
          class="workspace-alert"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Request journal is disabled"
          description="Enable the request journal in WireMock to capture new traffic. Previously saved requests and mocks remain available."
        />
        <UAlert
          v-if="error && data"
          class="workspace-alert"
          color="warning"
          variant="subtle"
          icon="i-lucide-wifi-off"
          title="Connection lost · showing saved history"
          :description="error"
        />

        <div
          v-if="loading && !data"
          class="workspace-empty"
        >
          <div class="empty-icon spinning">
            <UIcon name="i-lucide-loader-circle" />
          </div>
          <h2>Connecting the dots</h2>
          <p>Reading your WireMock routes and request journal…</p>
        </div>
        <div
          v-else-if="error && !data"
          class="workspace-empty"
        >
          <div class="empty-icon">
            <UIcon name="i-lucide-unplug" />
          </div>
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
          <button
            class="text-link"
            @click="setDemo(true)"
          >
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
                >
                  <template #trailing>
                    <kbd>/</kbd>
                  </template>
                </UInput><USelect
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
                  All <span>{{ requests.length }}</span>
                </button><button
                  :class="{ active: matchFilter === 'matched' }"
                  :aria-pressed="matchFilter === 'matched'"
                  @click="matchFilter = 'matched'"
                >
                  Matched <span>{{ loadedMatched }}</span>
                </button><button
                  :class="{ active: matchFilter === 'unmatched' }"
                  :aria-pressed="matchFilter === 'unmatched'"
                  @click="matchFilter = 'unmatched'"
                >
                  Unmatched <span>{{ loadedUnmatched }}</span>
                </button>
              </div>
              <div
                v-else
                class="route-list-label"
              >
                <USelect
                  v-model="mappingFilter"
                  :items="mappingFilters"
                  aria-label="Filter mock status"
                  size="xs"
                />
                <span>{{ visibleMappings.length }} routes</span>
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
                      >{{ event.request.url }}</code>
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
                      />{{ isMatched(event) ? 'Matched' : 'Unmatched' }}</span><span>{{ statusCode(event) ?? '—'
                      }}<span class="meta-dot">·</span>{{ time(event) }}</span>
                    </div>
                  </button>
                  <div
                    v-if="!visibleRequests.length"
                    class="small-empty"
                  >
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
                    class="request-item"
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
                      <UBadge
                        v-if="deletedMapping(mapping)"
                        label="Deleted"
                        color="neutral"
                        variant="subtle"
                        size="xs"
                      />
                    </div>
                    <div class="item-meta">
                      <span>{{ mappingName(mapping) }}</span><span class="response-code">{{
                        mapping.response.status ?? '—'
                      }}</span>
                    </div>
                  </button>
                  <div
                    v-if="!visibleMappings.length"
                    class="small-empty"
                  >
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
                <span>{{
                        view === 'requests'
                          ? visibleRequests.length
                          : visibleMappings.length
                      }}
                  {{ view === 'requests' ? 'requests' : 'routes' }} shown</span><UButton
                  v-if="
                    view === 'requests' && !demo && data.total > requests.length
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
                >Latest {{ limit.toLocaleString() }} max</span><span v-else><span
                  class="status-dot"
                  :class="{ demo, online: !demo && live }"
                />{{
                  demo
                    ? 'Sample snapshot'
                    : live
                      ? `Updating every ${pollMs / 1000}s`
                      : 'Live paused'
                }}</span>
              </div>
            </section>

            <section
              class="detail-panel"
              aria-label="Selected item details"
            >
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
                    }}</span><span>{{ time(selectedRequest) }}</span><span v-if="selectedRequest.timing?.totalTime != null">{{ selectedRequest.timing.totalTime }} ms</span><span v-if="statusCode(selectedRequest)">HTTP {{ statusCode(selectedRequest) }}</span>
                  </div>
                  <div class="request-id">
                    {{ selectedRequest.id }}
                  </div>
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
                    mock
                  </button><button
                    :class="{ active: inspectorTab === 'request' }"
                    :aria-pressed="inspectorTab === 'request'"
                    @click="inspectorTab = 'request'"
                  >
                    Request
                  </button><button
                    :class="{ active: inspectorTab === 'response' }"
                    :aria-pressed="inspectorTab === 'response'"
                    @click="inspectorTab = 'response'"
                  >
                    Response
                  </button>
                </div>
                <div
                  v-if="inspectorTab === 'compare'"
                  class="comparison-area"
                >
                  <div class="mock-picker">
                    <div class="picker-label">
                      <span>COMPARE AGAINST</span><span v-if="nearMissLoading"><UIcon
                        name="i-lucide-loader-circle"
                        class="spinning"
                      />Finding closest mocks</span><span
                        v-else-if="
                          selectedRequest.stubMapping?.id === selectedMockId
                        "
                      ><UIcon name="i-lucide-link" />Matched mock</span><span v-else-if="selectedNearMiss"><UIcon name="i-lucide-sparkles" />{{
                        demo ? 'Demo suggestion' : 'WireMock suggestion'
                      }}</span>
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
                    <p
                      v-if="nearMissError"
                      class="near-miss-error"
                    >
                      {{ nearMissError }}
                    </p>
                    <div
                      v-if="nearMisses.length > 1"
                      class="suggestions"
                    >
                      <span>Closest:</span><button
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
                  <MockHistoryNotice :history="selectedMockHistory" />
                  <RequestDiff
                    v-if="selectedMock"
                    :mapping="selectedMock"
                    :request="selectedRequest.request"
                  />
                  <div
                    v-else
                    class="small-empty"
                  >
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
                <div
                  v-else
                  class="raw-details"
                >
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
                  <div class="eyebrow">
                    STUB MAPPING
                    <UBadge
                      v-if="selectedMockHistory?.deletedAt"
                      label="Deleted"
                      color="neutral"
                      variant="subtle"
                      size="xs"
                    />
                  </div>
                  <MockHistoryNotice :history="selectedMockHistory" />
                  <h2 class="mapping-name">
                    {{ mappingName(selectedMock) }}
                  </h2>
                  <div class="detail-title">
                    <MethodBadge
                      :method="selectedMock.request.method || 'ANY'"
                    /><code>{{ routeUrl(selectedMock.request) }}</code>
                  </div>
                  <div class="detail-metadata">
                    <span>HTTP {{ selectedMock.response.status ?? '—' }}</span><span>Priority {{ selectedMock.priority ?? 5 }}</span><span v-if="selectedMock.scenarioName">{{
                      selectedMock.scenarioName
                    }}</span>
                  </div>
                  <div class="request-id">
                    {{ selectedMock.id }}
                  </div>
                  <div class="mock-management-actions">
                    <UButton
                      icon="i-lucide-pencil"
                      label="Edit mock"
                      variant="soft"
                      :disabled="!canManageSelected || mutationLoading"
                      @click="openEditor('edit')"
                    /><UButton
                      icon="i-lucide-copy-plus"
                      label="Duplicate"
                      variant="outline"
                      color="neutral"
                      :disabled="mutationLoading"
                      @click="openEditor('duplicate')"
                    /><UButton
                      icon="i-lucide-trash-2"
                      label="Delete"
                      variant="ghost"
                      color="error"
                      :disabled="!canManageSelected || mutationLoading"
                      @click="askDelete"
                    />
                  </div>
                  <UButton
                    icon="i-lucide-git-compare-arrows"
                    label="Compare with a request"
                    variant="soft"
                    :disabled="!requests.length"
                    @click="compareMapping(selectedMock)"
                  />
                </div>
                <div
                  class="detail-tabs"
                  role="group"
                  aria-label="Mock details"
                >
                  <button
                    :class="{ active: routeTab === 'pattern' }"
                    :aria-pressed="routeTab === 'pattern'"
                    @click="routeTab = 'pattern'"
                  >
                    Request pattern
                  </button><button
                    :class="{ active: routeTab === 'response' }"
                    :aria-pressed="routeTab === 'response'"
                    @click="routeTab = 'response'"
                  >
                    Response
                  </button><button
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
              <div
                v-else
                class="detail-empty"
              >
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

          <div
            v-else
            class="compare-workspace"
          >
            <div class="pair-selectors">
              <div>
                <label for="compare-request">RECEIVED REQUEST
                  <span>{{ requests.length }} available</span></label><USelectMenu
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
              <span class="pair-icon"><UIcon name="i-lucide-git-compare-arrows" /></span>
              <div>
                <label for="compare-mock">MOCK ROUTE
                  <span>{{ comparisonMappings.length }} available</span></label><USelectMenu
                  id="compare-mock"
                  v-model="selectedMockId"
                  :items="
                    comparisonMappings.map((mapping) => ({
                      label: mockLabel(mapping),
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
            <div
              v-if="selectedRequest && selectedMock"
              class="full-comparison"
            >
              <MockHistoryNotice :history="selectedMockHistory" />
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
                }}</span><span>Compare any pair independently of match status</span>
              </div>
              <RequestDiff
                :mapping="selectedMock"
                :request="selectedRequest.request"
              />
            </div>
            <div
              v-else
              class="workspace-empty"
            >
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
          <span><UIcon name="i-lucide-activity" />A clearer view of your mock
            APIs.</span><span>Wiretap <span class="meta-dot">·</span> Powered by WireMock</span>
        </footer>
      </div>
    </main>

    <InstanceManager
      v-model:open="connectionOpen"
      v-model:active-id="activeInstanceId"
      v-model:poll-ms="pollMs"
      v-model:live="live"
      :instances="instances"
      :default-url="defaultBaseUrl"
      :loading="loading"
      :busy="mutationLoading"
      :demo="demo"
      :on-save="saveInstance"
      :on-remove="removeInstance"
      :on-retry="refresh"
      @set-demo="setDemo"
    />
    <MockEditor
      v-model:open="editorOpen"
      :draft="editorDraft"
      :edit-id="editId"
      :instance-name="activeInstance.name"
      :demo="demo"
      :on-save="submitMock"
    />
    <UModal
      v-model:open="deleteOpen"
      title="Delete mock?"
      :description="`Remove ${deleteTarget ? mappingName(deleteTarget) : 'this mock'} from ${demo ? 'the demo workspace' : activeInstance.name}. This takes effect immediately.`"
      :dismissible="!mutationLoading"
      :close="!mutationLoading"
    >
      <template #body>
        <p class="delete-description">
          The mock will stop responding in WireMock. Its saved definition and
          recorded requests will remain in history for comparison.
        </p>
        <UAlert
          v-if="deleteError"
          :title="deleteError"
          color="error"
          variant="subtle"
        />
      </template>
      <template #footer>
        <UButton
          label="Delete mock"
          color="error"
          :loading="mutationLoading"
          @click="confirmDelete"
        /><UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          :disabled="mutationLoading"
          @click="deleteOpen = false"
        />
      </template>
    </UModal>
  </div>
</template>
