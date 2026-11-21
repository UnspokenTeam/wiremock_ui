import type { H3Event } from 'h3'
import { resolve } from 'node:path'
import { createHistoryStore } from '../lib/history-store'
import type { HistoryStore } from '../lib/history-store'

const stores = new Map<string, HistoryStore>()
const pending = new Map<string, Promise<unknown>>()

export function historyStore(event: H3Event) {
  const path = resolve(useRuntimeConfig(event).historyDatabasePath)
  let store = stores.get(path)
  if (!store) {
    try {
      store = createHistoryStore(path)
      stores.set(path, store)
    } catch (cause) {
      throw createError({
        statusCode: 503,
        statusMessage:
          'Request history is unavailable. Check that the history directory is writable.',
        cause
      })
    }
  }
  return store
}

/** Serialize the upstream read/write and its archive commit for one instance. */
export async function withInstanceHistory<T>(
  event: H3Event,
  operation: (store: HistoryStore, baseUrl: string) => Promise<T>
): Promise<T> {
  const { baseUrl } = wiremockConnection(event)
  const store = historyStore(event)
  const key = `${useRuntimeConfig(event).historyDatabasePath}|${baseUrl}`
  const previous = pending.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(() => operation(store, baseUrl))
  pending.set(key, current)
  try {
    return await current
  } finally {
    if (pending.get(key) === current) pending.delete(key)
  }
}

export function closeHistoryStores() {
  for (const store of stores.values()) store.close()
  stores.clear()
}
