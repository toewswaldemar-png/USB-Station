export interface DirEntry { name: string; is_dir: boolean; size: number; mod_time: string }

// ─── Frontend-Cache ────────────────────────────────────────────────────────────
//
// Der Frontend-Cache dient ausschließlich als sofortige Anzeige (SWR „serve stale").
// Er ersetzt NICHT den Server-Request. Der serverseitige DirService antwortet
// aus seinem Cache in 1–5 ms — schneller als ein lokaler IndexedDB-Lookup —
// daher lohnt keine zweite Cache-Schicht auf Client-Seite für Korrektheit.
//
// Ablauf:
//   getCachedDir(key)  →  sofortige Anzeige (null = Skeleton zeigen)
//   fetchDir(key)      →  immer Server-Request, aktualisiert _cache, rendert neu

const _cache = new Map<string, DirEntry[]>()

// _pending verhindert doppelte In-Flight-Requests für denselben Pfad.
// Kommt ein zweiter Aufruf während ein Fetch läuft, bekommt er dieselbe Promise.
const _pending = new Map<string, Promise<DirEntry[] | null>>()

const SS_PREFIX = 'dir:'

export function fetchDir(key: string): Promise<DirEntry[] | null> {
  if (_pending.has(key)) return _pending.get(key)!
  const p = fetch(`/api/open?path=${encodeURIComponent(key || '.')}`)
    .then(r => r.ok ? r.json() : null)
    .then((data): DirEntry[] | null => {
      _pending.delete(key)
      if (Array.isArray(data)) {
        _cache.set(key, data)
        try { sessionStorage.setItem(SS_PREFIX + key, JSON.stringify(data)) } catch {}
        return data
      }
      return null
    })
    .catch(() => { _pending.delete(key); return null })
  _pending.set(key, p)
  return p
}

export function getCachedDir(key: string): DirEntry[] | null {
  const mem = _cache.get(key)
  if (mem) return mem
  try {
    const s = sessionStorage.getItem(SS_PREFIX + key)
    if (s) {
      const parsed = JSON.parse(s) as DirEntry[]
      _cache.set(key, parsed)
      return parsed
    }
  } catch {}
  return null
}

// ─── Cache-Invalidierung (via SSE) ────────────────────────────────────────────

const _listeners = new Set<() => void>()

export function onCacheInvalidated(cb: () => void): () => void {
  _listeners.add(cb)
  return () => _listeners.delete(cb)
}

export function invalidateExplorerCache() {
  _cache.clear()
  _pending.clear()
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i)
      if (k?.startsWith(SS_PREFIX)) sessionStorage.removeItem(k)
    }
  } catch {}
  _listeners.forEach(cb => cb())
}

// ─── Prefetch ─────────────────────────────────────────────────────────────────
//
// Wenn ein Ordner geöffnet wird, kennen wir bereits seine Unterordner.
// Wir laden sie im Hintergrund vor, damit der nächste Klick sofort reagiert.
//
// Schutzmaßnahmen für NAS/langsame Verbindungen:
//   PREFETCH_CONCURRENCY  — max. 3 gleichzeitige Requests
//   PREFETCH_MAX_DIRS     — kein Prefetch wenn mehr als 8 Unterordner sichtbar
//                           (großes Verzeichnis = wahrscheinlich NAS-Root)

const PREFETCH_CONCURRENCY = 3
const PREFETCH_MAX_DIRS = 8

let _prefetchActive = 0
const _prefetchQueue: string[] = []

function drainPrefetchQueue(): void {
  while (_prefetchActive < PREFETCH_CONCURRENCY && _prefetchQueue.length > 0) {
    const key = _prefetchQueue.shift()!
    if (_cache.has(key) || _pending.has(key)) {
      // Bereits gecacht oder läuft — nächsten Eintrag versuchen
      drainPrefetchQueue()
      return
    }
    _prefetchActive++
    fetchDir(key).finally(() => {
      _prefetchActive--
      drainPrefetchQueue()
    })
  }
}

export function prefetchSubdirs(parentKey: string, entries: DirEntry[]): void {
  const dirs = entries.filter(e => e.is_dir)
  // NAS-Schutz: zu viele Unterordner → kein Prefetch
  if (dirs.length > PREFETCH_MAX_DIRS) return
  for (const dir of dirs) {
    const key = parentKey ? `${parentKey}/${dir.name}` : dir.name
    if (!_cache.has(key) && !_pending.has(key) && !_prefetchQueue.includes(key)) {
      _prefetchQueue.push(key)
    }
  }
  drainPrefetchQueue()
}

// ─── Cloud-Verzeichnis-Seeding ────────────────────────────────────────────────
//
// Aus list-recursive-Ergebnissen die direkten Kinder eines Cloud-Ordners ableiten
// und in den Cache schreiben — damit navigate() sofort aus dem Cache liefert,
// ohne auf /api/open warten zu müssen. fetchDir() läuft danach als SWR-Refresh.
// Kein Überschreiben wenn der Ordner bereits durch /api/open gecacht wurde.

export function seedCloudDirCache(rootPath: string, files: { path: string; size: number }[]): void {
  // Einen Pass über alle Dateien, alle Elternordner aufbauen — nicht nur direkte Kinder.
  // Danach ist jeder Unterordner sofort navigierbar ohne /api/open-Request.
  const byParent = new Map<string, Map<string, { is_dir: boolean; size: number }>>()
  for (const f of files) {
    if (!f.path.startsWith(rootPath + '/')) continue
    const parts = f.path.slice(rootPath.length + 1).split('/')
    for (let depth = 0; depth < parts.length; depth++) {
      const parentPath = depth === 0 ? rootPath : rootPath + '/' + parts.slice(0, depth).join('/')
      const childName = parts[depth]
      const isDir = depth < parts.length - 1
      if (!byParent.has(parentPath)) byParent.set(parentPath, new Map())
      const ch = byParent.get(parentPath)!
      if (!ch.has(childName)) ch.set(childName, { is_dir: isDir, size: isDir ? 0 : f.size })
    }
  }
  for (const [parentPath, children] of byParent) {
    if (_cache.has(parentPath)) continue  // echter API-Response hat Vorrang
    const entries: DirEntry[] = Array.from(children.entries()).map(([name, { is_dir, size }]) => ({
      name, is_dir, size, mod_time: '',
    }))
    _cache.set(parentPath, entries)
    try { sessionStorage.setItem(SS_PREFIX + parentPath, JSON.stringify(entries)) } catch {}
  }
}

// Root-Verzeichnis sofort beim Modul-Import vorladen — startet vor React-Rendering.
fetchDir('')
