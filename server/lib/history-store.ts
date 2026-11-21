import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  MappingHistory,
  ServeEvent,
  StubMapping,
  Workspace
} from '../../shared/types/wiremock.ts'
import { isMatched, matchedMapping } from '../../shared/utils/wiremock.ts'

interface MappingRow {
  data: string
  first_seen: number
  last_seen: number
  deleted_at: number | null
}

function mappingHistory(row: MappingRow): MappingHistory {
  return {
    firstSeenAt: new Date(row.first_seen).toISOString(),
    lastSeenAt: new Date(row.last_seen).toISOString(),
    deletedAt:
      row.deleted_at === null ? null : new Date(row.deleted_at).toISOString()
  }
}

/** Independent of WireMock's journal and of browser connection profiles. */
export function createHistoryStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS instances (
      url TEXT PRIMARY KEY,
      synced_at INTEGER,
      journal_disabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS mappings (
      instance_url TEXT NOT NULL REFERENCES instances(url),
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      deleted_at INTEGER,
      PRIMARY KEY (instance_url, id)
    );
    CREATE TABLE IF NOT EXISTS requests (
      instance_url TEXT NOT NULL REFERENCES instances(url),
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      logged_at INTEGER NOT NULL,
      matched INTEGER NOT NULL,
      PRIMARY KEY (instance_url, id)
    );
    CREATE INDEX IF NOT EXISTS requests_by_date
      ON requests(instance_url, logged_at DESC, id DESC);
    PRAGMA user_version = 1;
  `)
  const ensureInstance = db.prepare(
    'INSERT OR IGNORE INTO instances(url) VALUES (?)'
  )
  const saveMapping = db.prepare(`
    INSERT INTO mappings(instance_url, id, data, first_seen, last_seen, deleted_at)
    VALUES (?, ?, ?, ?, ?, NULL)
    ON CONFLICT(instance_url, id) DO UPDATE SET
      data = excluded.data, last_seen = excluded.last_seen, deleted_at = NULL
  `)
  const saveHistoricalMapping = db.prepare(`
    INSERT OR IGNORE INTO mappings(instance_url, id, data, first_seen, last_seen, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const saveRequest = db.prepare(`
    INSERT INTO requests(instance_url, id, data, logged_at, matched)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(instance_url, id) DO UPDATE SET
      data = excluded.data, matched = excluded.matched
  `)

  function transaction<T>(operation: () => T): T {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function getMappingHistory(
    baseUrl: string,
    id: string
  ): MappingHistory | undefined {
    const row = db
      .prepare(
        'SELECT data, first_seen, last_seen, deleted_at FROM mappings WHERE instance_url = ? AND id = ?'
      )
      .get(baseUrl, id) as MappingRow | undefined
    return row && mappingHistory(row)
  }

  function rememberMapping(
    baseUrl: string,
    mapping: StubMapping,
    now = Date.now()
  ) {
    transaction(() => {
      ensureInstance.run(baseUrl)
      saveMapping.run(baseUrl, mapping.id, JSON.stringify(mapping), now, now)
    })
    return getMappingHistory(baseUrl, mapping.id)!
  }

  function markDeleted(baseUrl: string, id: string, now = Date.now()) {
    db.prepare(
      `
      UPDATE mappings SET deleted_at = COALESCE(deleted_at, ?)
      WHERE instance_url = ? AND id = ?
    `
    ).run(now, baseUrl, id)
    return getMappingHistory(baseUrl, id)
  }

  function synchronize(
    baseUrl: string,
    mappings: StubMapping[],
    requests: ServeEvent[],
    journalDisabled: boolean,
    now = Date.now()
  ) {
    transaction(() => {
      ensureInstance.run(baseUrl)
      // Only a complete, successful mappings read may mark missing mocks deleted.
      db.prepare(
        `
        UPDATE mappings SET deleted_at = ?
        WHERE instance_url = ? AND deleted_at IS NULL
      `
      ).run(now, baseUrl)
      for (const mapping of mappings)
        saveMapping.run(baseUrl, mapping.id, JSON.stringify(mapping), now, now)
      for (const request of requests) {
        const loggedAt
          = request.request.loggedDate
            ?? Date.parse(request.request.loggedDateString ?? '')
        saveRequest.run(
          baseUrl,
          request.id,
          JSON.stringify(request),
          Number.isFinite(loggedAt) ? loggedAt : now,
          Number(isMatched(request))
        )
        const historical = matchedMapping(request)
        // Recover mocks removed before our first sync without overwriting newer definitions.
        if (historical?.id)
          saveHistoricalMapping.run(
            baseUrl,
            historical.id,
            JSON.stringify(historical),
            now,
            now,
            now
          )
      }
      db.prepare(
        'UPDATE instances SET synced_at = ?, journal_disabled = ? WHERE url = ?'
      ).run(now, Number(journalDisabled), baseUrl)
    })
  }

  function getRequest(baseUrl: string, id: string): ServeEvent | undefined {
    const row = db
      .prepare('SELECT data FROM requests WHERE instance_url = ? AND id = ?')
      .get(baseUrl, id) as { data: string } | undefined
    return row ? JSON.parse(row.data) : undefined
  }

  function readWorkspace(
    baseUrl: string,
    limit: number,
    connectionError?: string
  ): Workspace | undefined {
    const instance = db
      .prepare(
        'SELECT synced_at, journal_disabled FROM instances WHERE url = ?'
      )
      .get(baseUrl) as
      | { synced_at: number | null, journal_disabled: number }
      | undefined
    if (!instance) return
    const rows = db
      .prepare(
        `
      SELECT data, first_seen, last_seen, deleted_at FROM mappings
      WHERE instance_url = ? ORDER BY deleted_at IS NOT NULL, first_seen DESC, id
    `
      )
      .all(baseUrl) as unknown as MappingRow[]
    const mappings: StubMapping[] = []
    const mappingStates: Record<string, MappingHistory> = {}
    let deletedMockCount = 0
    for (const row of rows) {
      const mapping = JSON.parse(row.data) as StubMapping
      mappings.push(mapping)
      mappingStates[mapping.id] = mappingHistory(row)
      if (row.deleted_at !== null) deletedMockCount++
    }
    const stats = db
      .prepare(
        `
      SELECT COUNT(*) AS total, COALESCE(SUM(matched), 0) AS matched
      FROM requests WHERE instance_url = ?
    `
      )
      .get(baseUrl) as { total: number, matched: number }
    const requests = db
      .prepare(
        `
      SELECT data FROM requests WHERE instance_url = ?
      ORDER BY logged_at DESC, id DESC LIMIT ?
    `
      )
      .all(baseUrl, limit) as { data: string }[]
    const lastSyncedAt
      = instance.synced_at === null
        ? null
        : new Date(instance.synced_at).toISOString()
    return {
      baseUrl,
      mappings,
      requests: requests.map(row => JSON.parse(row.data)),
      total: stats.total,
      requestJournalDisabled: Boolean(instance.journal_disabled),
      fetchedAt: lastSyncedAt ?? new Date().toISOString(),
      history: {
        connected: !connectionError,
        connectionError,
        lastSyncedAt,
        matchedCount: stats.matched,
        unmatchedCount: stats.total - stats.matched,
        activeMockCount: mappings.length - deletedMockCount,
        deletedMockCount,
        mappingStates
      }
    }
  }

  return {
    synchronize,
    rememberMapping,
    markDeleted,
    getRequest,
    readWorkspace,
    close: () => db.close()
  }
}

export type HistoryStore = ReturnType<typeof createHistoryStore>
