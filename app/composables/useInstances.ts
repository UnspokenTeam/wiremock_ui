import {
  defaultInstanceId,
  normalizeInstanceUrl,
  readPreferences,
  settingsStorageKey
} from '#shared/utils/instances'
import type { WireMockInstance } from '#shared/utils/instances'

export function useInstances() {
  const defaults = readPreferences(undefined)
  const instances = ref<WireMockInstance[]>(defaults.instances)
  const activeInstanceId = shallowRef(defaults.activeId)
  const pollMs = shallowRef(defaults.pollMs)
  const defaultBaseUrl = shallowRef('http://localhost:8080')
  const activeInstance = computed(
    () =>
      instances.value.find(
        instance => instance.id === activeInstanceId.value
      ) ?? instances.value[0]!
  )
  const baseUrl = computed(
    () => activeInstance.value.url || defaultBaseUrl.value
  )
  let restored = false

  function restore() {
    try {
      const saved = localStorage.getItem(settingsStorageKey)
      const state = readPreferences(saved ? JSON.parse(saved) : undefined)
      instances.value = state.instances
      activeInstanceId.value = state.activeId
      pollMs.value = state.pollMs
    } catch {
      /* Use defaults if storage is unavailable or corrupt. */
    }
    restored = true
  }

  function saveInstance(input: { id?: string, name: string, url: string }) {
    const name = input.name.trim()
    if (!name || name.length > 80)
      throw new Error('Give this instance a name of up to 80 characters.')
    const url = normalizeInstanceUrl(input.url)
    const id
      = input.id && input.id !== defaultInstanceId
        ? input.id
        : `instance-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
    const index = instances.value.findIndex(instance => instance.id === id)
    const instance = { id, name, url }
    if (index < 0) instances.value.push(instance)
    else instances.value[index] = instance
    activeInstanceId.value = id
  }

  function removeInstance(id: string) {
    if (id === defaultInstanceId) return
    instances.value = instances.value.filter(instance => instance.id !== id)
    if (activeInstanceId.value === id)
      activeInstanceId.value = defaultInstanceId
  }

  watch(
    [instances, activeInstanceId, pollMs],
    () => {
      if (!restored) return
      try {
        localStorage.setItem(
          settingsStorageKey,
          JSON.stringify({
            instances: instances.value.filter(
              instance => instance.id !== defaultInstanceId
            ),
            activeId: activeInstanceId.value,
            pollMs: pollMs.value
          })
        )
      } catch {
        /* Preferences continue to work for this session. */
      }
    },
    { deep: true }
  )

  return {
    instances,
    activeInstanceId,
    activeInstance,
    pollMs,
    defaultBaseUrl,
    baseUrl,
    restore,
    saveInstance,
    removeInstance
  }
}
