import type {
  MappingHistory,
  NearMiss,
  StubMapping,
  Workspace
} from '#shared/types/wiremock'
import { matchedMapping } from '#shared/utils/wiremock'
import { instanceRequestHeaders } from '#shared/utils/instances'
import { createPoller } from '#shared/utils/polling'
import { validateMock } from '#shared/utils/mocks'
import type { MockDraft } from '#shared/utils/mocks'
import { demoWorkspace } from '~/data/demo'

export function useWorkspace() {
  const instanceState = useInstances()
  const { activeInstance, pollMs, defaultBaseUrl, baseUrl } = instanceState
  const data = shallowRef<Workspace>()
  const loading = shallowRef(false)
  const error = shallowRef('')
  const demo = shallowRef(false)
  const live = shallowRef(true)
  const limit = shallowRef(500)
  const mutationLoading = shallowRef(false)
  const selectedRequestId = shallowRef('')
  const selectedMockId = shallowRef('')
  const autoSelectMock = shallowRef(true)
  const nearMisses = shallowRef<NearMiss[]>([])
  const nearMissLoading = shallowRef(false)
  const nearMissError = shallowRef('')
  let fetchVersion = 0
  let nearVersion = 0
  let mounted = false
  let contextVersion = 0
  let refreshController: AbortController | undefined
  let nearController: AbortController | undefined
  const poller = createPoller(async () => {
    if (!document.hidden) await refresh()
  })

  function restartPolling() {
    poller.stop()
    if (mounted && live.value && !demo.value) poller.start(pollMs.value)
  }

  const requests = computed(() => data.value?.requests ?? [])
  const mappings = computed(() => data.value?.mappings ?? [])
  const selectedRequest = computed(() =>
    requests.value.find(request => request.id === selectedRequestId.value)
  )
  const comparisonMappings = computed(() => {
    const items = [...mappings.value]
    const extras = [
      matchedMapping(selectedRequest.value),
      ...nearMisses.value.map(miss => miss.stubMapping)
    ]
    for (const mapping of extras)
      if (mapping?.id && !items.some(item => item.id === mapping.id))
        items.push(mapping)
    return items
  })
  const selectedMock = computed(() =>
    comparisonMappings.value.find(
      mapping => mapping.id === selectedMockId.value
    )
  )

  async function refresh() {
    if (demo.value || loading.value) return
    const version = ++fetchVersion
    refreshController = new AbortController()
    loading.value = true
    try {
      const next = await $fetch<Workspace>('/api/workspace', {
        query: { limit: limit.value },
        headers: instanceRequestHeaders(activeInstance.value.url),
        signal: refreshController.signal
      })
      if (version !== fetchVersion) return
      data.value = next
      if (!activeInstance.value.url) defaultBaseUrl.value = next.baseUrl
      error.value = next.history?.connectionError ?? ''
      if (
        !next.requests.some(request => request.id === selectedRequestId.value)
      )
        selectedRequestId.value = next.requests[0]?.id ?? ''
      if (!selectedMockId.value && next.mappings[0])
        selectedMockId.value = next.mappings[0].id
    } catch (cause) {
      if (version !== fetchVersion) return
      error.value
        = (cause as { data?: { statusMessage?: string } }).data?.statusMessage
          ?? 'Could not connect to WireMock. Check your connection and try again.'
    } finally {
      if (version === fetchVersion) loading.value = false
    }
  }

  function setDemo(enabled: boolean) {
    contextVersion++
    fetchVersion++
    nearVersion++
    refreshController?.abort()
    nearController?.abort()
    loading.value = false
    nearMissLoading.value = false
    nearMisses.value = []
    selectedMockId.value = ''
    selectedRequestId.value = ''
    error.value = ''
    demo.value = enabled
    data.value = enabled ? demoWorkspace() : undefined
    if (enabled) selectedRequestId.value = data.value!.requests[0]!.id
    else void refresh()
  }

  async function findNearMisses(resetSelection = true) {
    const event = selectedRequest.value
    const version = ++nearVersion
    nearController?.abort()
    nearController = new AbortController()
    nearMisses.value = []
    nearMissError.value = ''
    nearMissLoading.value = false
    if (!event) return
    // Start with the exact historical mapping if it has since been removed.
    if (autoSelectMock.value && resetSelection)
      selectedMockId.value = matchedMapping(event)?.id ?? ''
    if (data.value?.history?.connected === false) {
      nearMissError.value
        = 'WireMock is offline. Saved mocks are still available for comparison.'
      if (!selectedMockId.value)
        selectedMockId.value = mappings.value[0]?.id ?? ''
      return
    }
    nearMissLoading.value = true
    try {
      let results: NearMiss[]
      if (demo.value) {
        const path = event.request.url.split('?')[0]!
        results = mappings.value
          .filter(mapping => mapping.request.method === event.request.method)
          .sort(
            (a, b) =>
              Number(
                !path.startsWith(
                  String(
                    a.request.urlPath ?? a.request.urlPathTemplate ?? ''
                  ).split('{')[0]!
                )
              )
              - Number(
                !path.startsWith(
                  String(
                    b.request.urlPath ?? b.request.urlPathTemplate ?? ''
                  ).split('{')[0]!
                )
              )
          )
          .slice(0, 3)
          .map((mapping, i) => ({
            request: event.request,
            stubMapping: mapping,
            matchResult: { distance: 0.08 + i * 0.16 }
          }))
      } else {
        const response = await $fetch<{ nearMisses: NearMiss[] }>(
          '/api/near-misses',
          {
            method: 'POST',
            body: { requestId: event.id },
            headers: instanceRequestHeaders(activeInstance.value.url),
            signal: nearController.signal
          }
        )
        results = response.nearMisses
      }
      if (version !== nearVersion) return
      nearMisses.value = results
      if (!selectedMockId.value)
        selectedMockId.value
          = results[0]?.stubMapping.id ?? mappings.value[0]?.id ?? ''
    } catch (cause) {
      if (version !== nearVersion) return
      nearMissError.value
        = (cause as { data?: { statusMessage?: string } }).data?.statusMessage
          ?? 'Closest mocks are unavailable. You can still choose any mock below.'
      if (!selectedMockId.value)
        selectedMockId.value = mappings.value[0]?.id ?? ''
    } finally {
      if (version === nearVersion) nearMissLoading.value = false
    }
  }

  async function saveMock(
    draft: MockDraft,
    editId?: string
  ): Promise<StubMapping | undefined> {
    const payload = validateMock(draft)
    const context = contextVersion
    const headers = instanceRequestHeaders(activeInstance.value.url)
    mutationLoading.value = true
    try {
      let saved: StubMapping
      if (demo.value)
        saved = {
          ...structuredClone(payload),
          id: editId ?? crypto.randomUUID()
        } as StubMapping
      else if (editId)
        saved = await $fetch<StubMapping>(`/api/mappings/${editId}`, {
          method: 'PUT',
          body: payload,
          headers
        })
      else
        saved = await $fetch<StubMapping>('/api/mappings', {
          method: 'POST',
          body: payload,
          headers
        })
      if (context !== contextVersion) return
      if (data.value) {
        const items = data.value.mappings.filter(
          mapping => mapping.id !== saved.id
        )
        data.value = { ...data.value, mappings: [saved, ...items] }
      }
      // Invalidate a poll that started before this write, then fetch fresh state.
      refreshController?.abort()
      fetchVersion++
      loading.value = false
      await refresh()
      return saved
    } finally {
      mutationLoading.value = false
    }
  }

  async function deleteMock(id: string): Promise<boolean> {
    const context = contextVersion
    const headers = instanceRequestHeaders(activeInstance.value.url)
    mutationLoading.value = true
    try {
      const result = demo.value
        ? undefined
        : await $fetch<{ deleted: boolean, history: MappingHistory }>(
            `/api/mappings/${id}`,
            { method: 'DELETE', headers }
          )
      if (context !== contextVersion) return false
      if (data.value && result && data.value.history) {
        const history = data.value.history
        const wasActive = !history.mappingStates[id]?.deletedAt
        data.value = {
          ...data.value,
          history: {
            ...history,
            activeMockCount: history.activeMockCount - Number(wasActive),
            deletedMockCount: history.deletedMockCount + Number(wasActive),
            mappingStates: { ...history.mappingStates, [id]: result.history }
          }
        }
      } else if (data.value)
        data.value = {
          ...data.value,
          mappings: data.value.mappings.filter(mapping => mapping.id !== id)
        }
      if (demo.value && selectedMockId.value === id)
        selectedMockId.value = mappings.value[0]?.id ?? ''
      refreshController?.abort()
      fetchVersion++
      loading.value = false
      await refresh()
      return true
    } finally {
      mutationLoading.value = false
    }
  }

  watch(
    () => `${activeInstance.value.id}|${activeInstance.value.url}`,
    () => {
      if (mounted) setDemo(false)
    },
    { flush: 'sync' }
  )
  watch([pollMs, live, demo], restartPolling, { flush: 'sync' })
  watch(
    [selectedRequestId, () => data.value?.history?.connected],
    ([id], [previousId]) => {
      void findNearMisses(id !== previousId)
    }
  )
  onMounted(async () => {
    instanceState.restore()
    mounted = true
    if (useRoute().query.demo === '1') setDemo(true)
    else {
      void $fetch<{ baseUrl: string }>('/api/connection')
        .then((connection) => {
          defaultBaseUrl.value = connection.baseUrl
        })
        .catch(() => {})
      void refresh()
    }
    restartPolling()
  })
  onBeforeUnmount(() => {
    mounted = false
    poller.stop()
    refreshController?.abort()
    nearController?.abort()
    fetchVersion++
    nearVersion++
  })

  return {
    instances: instanceState.instances,
    activeInstanceId: instanceState.activeInstanceId,
    activeInstance,
    defaultBaseUrl,
    pollMs,
    saveInstance: instanceState.saveInstance,
    removeInstance: instanceState.removeInstance,
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
    mutationLoading,
    saveMock,
    deleteMock,
    refresh,
    setDemo
  }
}
