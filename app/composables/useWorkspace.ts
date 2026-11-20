import type { NearMiss, Workspace } from '#shared/types/wiremock'
import { matchedMapping } from '#shared/utils/wiremock'
import { demoWorkspace } from '~/data/demo'

export function useWorkspace() {
  const data = shallowRef<Workspace>()
  const loading = ref(false)
  const error = ref('')
  const demo = ref(false)
  const live = ref(true)
  const limit = ref(500)
  const baseUrl = ref('http://localhost:8080')
  const selectedRequestId = ref('')
  const selectedMockId = ref('')
  const autoSelectMock = ref(true)
  const nearMisses = shallowRef<NearMiss[]>([])
  const nearMissLoading = ref(false)
  const nearMissError = ref('')
  let fetchVersion = 0
  let nearVersion = 0
  let interval: ReturnType<typeof setInterval> | undefined

  const requests = computed(() => data.value?.requests ?? [])
  const mappings = computed(() => data.value?.mappings ?? [])
  const selectedRequest = computed(() =>
    requests.value.find((request) => request.id === selectedRequestId.value)
  )
  const comparisonMappings = computed(() => {
    const items = [...mappings.value]
    const extras = [
      matchedMapping(selectedRequest.value),
      ...nearMisses.value.map((miss) => miss.stubMapping)
    ]
    for (const mapping of extras)
      if (mapping?.id && !items.some((item) => item.id === mapping.id))
        items.push(mapping)
    return items
  })
  const selectedMock = computed(() =>
    comparisonMappings.value.find(
      (mapping) => mapping.id === selectedMockId.value
    )
  )

  async function refresh() {
    if (demo.value || loading.value) return
    const version = ++fetchVersion
    loading.value = true
    try {
      const next = await $fetch<Workspace>('/api/workspace', {
        query: { limit: limit.value }
      })
      if (version !== fetchVersion) return
      data.value = next
      baseUrl.value = next.baseUrl
      error.value = ''
      if (
        !next.requests.some((request) => request.id === selectedRequestId.value)
      )
        selectedRequestId.value = next.requests[0]?.id ?? ''
      if (!selectedMockId.value && next.mappings[0])
        selectedMockId.value = next.mappings[0].id
    } catch (cause) {
      if (version !== fetchVersion) return
      error.value =
        (cause as { data?: { statusMessage?: string } }).data?.statusMessage ??
        'Could not connect to WireMock. Check your connection and try again.'
    } finally {
      if (version === fetchVersion) loading.value = false
    }
  }

  function setDemo(enabled: boolean) {
    fetchVersion++
    nearVersion++
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

  async function findNearMisses() {
    const event = selectedRequest.value
    const version = ++nearVersion
    nearMisses.value = []
    nearMissError.value = ''
    nearMissLoading.value = false
    if (!event) return
    // Start with the exact historical mapping if it has since been removed.
    if (autoSelectMock.value) selectedMockId.value = matchedMapping(event)?.id ?? ''
    nearMissLoading.value = true
    try {
      let results: NearMiss[]
      if (demo.value) {
        const path = event.request.url.split('?')[0]!
        results = mappings.value
          .filter((mapping) => mapping.request.method === event.request.method)
          .sort(
            (a, b) =>
              Number(
                !path.startsWith(
                  String(
                    a.request.urlPath ?? a.request.urlPathTemplate ?? ''
                  ).split('{')[0]!
                )
              ) -
              Number(
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
          { method: 'POST', body: { requestId: event.id } }
        )
        results = response.nearMisses
      }
      if (version !== nearVersion) return
      nearMisses.value = results
      if (!selectedMockId.value)
        selectedMockId.value =
          results[0]?.stubMapping.id ?? mappings.value[0]?.id ?? ''
    } catch (cause) {
      if (version !== nearVersion) return
      nearMissError.value =
        (cause as { data?: { statusMessage?: string } }).data?.statusMessage ??
        'Closest mocks are unavailable. You can still choose any mock below.'
      if (!selectedMockId.value)
        selectedMockId.value = mappings.value[0]?.id ?? ''
    } finally {
      if (version === nearVersion) nearMissLoading.value = false
    }
  }

  watch(selectedRequestId, () => {
    void findNearMisses()
  })
  onMounted(async () => {
    if (useRoute().query.demo === '1') setDemo(true)
    else {
      void $fetch<{ baseUrl: string }>('/api/connection')
        .then((connection) => {
          baseUrl.value = connection.baseUrl
        })
        .catch(() => {})
      void refresh()
    }
    interval = setInterval(() => {
      if (live.value && !demo.value && !document.hidden) void refresh()
    }, 5000)
  })
  onBeforeUnmount(() => {
    clearInterval(interval)
    fetchVersion++
    nearVersion++
  })

  return {
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
  }
}
