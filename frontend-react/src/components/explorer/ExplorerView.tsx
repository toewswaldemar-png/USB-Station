import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, Home, ArrowLeft, ArrowRight, Folder, Music, ChevronUp, ChevronDown, GripVertical } from 'lucide-react'
import { useFilesStore } from '@/stores/filesStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUISettingsStore } from '@/stores/uiSettingsStore'
import { fmtBytes, formatDate } from '@/lib/dateUtils'
import type { AudioFile } from '@/types'
import FileOverlay from './FileOverlay'
import { fetchDir, getCachedDir, onCacheInvalidated, prefetchSubdirs } from './explorerCache'
import type { DirEntry } from './explorerCache'

const COL_KEY = 'fs_colWidths'

function loadColWidths() {
  try { return JSON.parse(localStorage.getItem(COL_KEY) || '{}') } catch { return {} }
}
function saveColWidths(w: Record<string, number>) {
  localStorage.setItem(COL_KEY, JSON.stringify(w))
}

type SortBy = 'name' | 'date'
type SortDir = 'asc' | 'desc'
const SORT_KEY = 'fs_sort'
const PATH_KEY = 'fs_path'

function loadSavedPath(): string[] {
  try { return JSON.parse(localStorage.getItem(PATH_KEY) || '[]') } catch { return [] }
}

export default function ExplorerView() {
  const allFiles = useFilesStore(s => s.allFiles)
  const { selectedFiles, toggleFile } = useSelectionStore()
  const settings = useUISettingsStore(s => s.settings)

  const [path, setPath] = useState<string[]>(loadSavedPath)
  const [history, setHistory] = useState<string[][]>(() => [loadSavedPath()])
  const [histIdx, setHistIdx] = useState(0)
  const [search, setSearch] = useState('')
  const [overlay, setOverlay] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  // Beim Seitenneuladen ist der Cache leer → Skeleton bis fetchDir antwortet.
  const [dirEntries, setDirEntries] = useState<DirEntry[] | null>(null)
  const [colWidths, setColWidths] = useState<Record<string, number>>(loadColWidths)
  const [sort, setSort] = useState<{ by: SortBy; dir: SortDir }>(() => {
    try { return JSON.parse(localStorage.getItem(SORT_KEY) || '{}') } catch { return { by: settings.sortBy as SortBy, dir: settings.sortDir as SortDir } }
  })

  const isCloud = path[0] === '__cloud__'
  const currentFolder = path.join('/')

  const parentRef = useRef<HTMLDivElement>(null)
  const [rubberBand, setRubberBand] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const rbStart = useRef<{ x: number; y: number } | null>(null)

  const swipeStart = useRef(0)
  const navId = useRef(0)

  const navigate = useCallback((newPath: string[]) => {
    const key = newPath.join('/')
    const id = ++navId.current
    setPath(newPath)
    setSearch('')
    if (newPath[0] === '__cloud__') { setDirEntries(null); return }

    // SWR: gecachten Stand sofort anzeigen (null → Skeleton).
    // Parallel immer vom Server holen — DirService antwortet aus seinem Cache
    // in 1–5 ms, beim ersten Zugriff etwas länger.
    setDirEntries(getCachedDir(key))
    fetchDir(key).then(data => {
      if (navId.current !== id) return
      if (data !== null) setDirEntries(data)
      else if (key) navigate(newPath.slice(0, -1))
    })
  }, [])

  // Beim ersten Mount: gespeicherten Pfad wiederherstellen + Server-Refresh starten.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { navigate(path) }, [])

  // Bei Cache-Invalidierung (SSE done:) aktuelles Verzeichnis neu laden
  const pathRef = useRef(path)
  pathRef.current = path
  useEffect(() => onCacheInvalidated(() => {
    fetchDir(pathRef.current.join('/')).then(data => {
      if (data) setDirEntries(data)
    })
  }), [])

  // Aktuellen Pfad persistieren — wird beim Neuladen wiederhergestellt.
  useEffect(() => {
    localStorage.setItem(PATH_KEY, JSON.stringify(path))
  }, [path])

  // Prefetch: Unterordner der aktuellen Ebene im Hintergrund vorladen.
  // Limit: max. 3 gleichzeitig, max. 8 Unterordner (NAS-Schutz — siehe explorerCache.ts).
  useEffect(() => {
    if (!dirEntries || isCloud) return
    prefetchSubdirs(currentFolder, dirEntries)
  }, [dirEntries, currentFolder, isCloud])

  function pushPath(newPath: string[]) {
    const next = history.slice(0, histIdx + 1)
    next.push(newPath)
    setHistory(next)
    setHistIdx(next.length - 1)
    navigate(newPath)
  }

  function goBack() {
    if (histIdx > 0) { setHistIdx(h => h - 1); navigate(history[histIdx - 1]) }
  }
  function goForward() {
    if (histIdx < history.length - 1) { setHistIdx(h => h + 1); navigate(history[histIdx + 1]) }
  }

  type Row = { type: 'dir'; name: string; size: number } | { type: 'file'; file: AudioFile }

  // Einziger O(n)-Pass über allFiles — baut gleichzeitig:
  //   filesByPath    → O(1) Lookup für Metadaten-Anreicherung (Titel, Datum, …)
  //   folderFilesMap → O(1) Ordner-Children für Ordner-Checkboxen
  //   scopeFiles     → für "Alle auswählen"-Checkbox
  //
  // Einzige Quelle für die angezeigte Liste: dirEntries (von /api/open).
  // Kein DB-Fallback mehr — bei dirEntries === null zeigt das JSX ein Skeleton.
  const { rows, folderFilesMap, scopeFiles } = useMemo(() => {
    type Result = { rows: Row[]; folderFilesMap: Map<string, AudioFile[]>; scopeFiles: AudioFile[] }
    if (isCloud || dirEntries === null) return { rows: [], folderFilesMap: new Map(), scopeFiles: [] } as Result

    const searchLower = search.toLowerCase()
    const prefix = currentFolder ? currentFolder + '/' : ''

    const filesByPath = new Map<string, AudioFile>()
    const folderFilesMap = new Map<string, AudioFile[]>()
    const scopeFiles: AudioFile[] = []

    for (const f of allFiles) {
      filesByPath.set(f.path, f)
      if (prefix && !f.path.startsWith(prefix)) continue
      const rest = f.path.slice(prefix.length)
      if (!rest) continue
      scopeFiles.push(f)
      const slash = rest.indexOf('/')
      if (slash !== -1) {
        const dir = rest.slice(0, slash)
        const bucket = folderFilesMap.get(dir)
        if (bucket) bucket.push(f)
        else folderFilesMap.set(dir, [f])
      }
    }

    const filtered = dirEntries.filter(e => !search || e.name.toLowerCase().includes(searchLower))
    const mul = sort.dir === 'asc' ? 1 : -1
    const rows: Row[] = [
      ...filtered.filter(e => e.is_dir)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(d => ({ type: 'dir' as const, name: d.name, size: d.size })),
      ...filtered.filter(e => !e.is_dir)
        .map(f => {
          const rel = [...path, f.name].join('/')
          return { type: 'file' as const, file: filesByPath.get(rel) ?? { path: rel, title: f.name, date: '', folder: '', artist: '', album: '', size: f.size, mtime: 0 } }
        })
        .sort((a, b) => sort.by === 'date' ? mul * a.file.date.localeCompare(b.file.date) : mul * a.file.title.localeCompare(b.file.title)),
    ]

    return { rows, folderFilesMap, scopeFiles } as Result
  }, [isCloud, dirEntries, allFiles, currentFolder, path, search, sort])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  })

  function toggleSort(by: SortBy) {
    const next = sort.by === by ? { by, dir: sort.dir === 'asc' ? 'desc' as const : 'asc' as const } : { by, dir: 'asc' as const }
    setSort(next)
    localStorage.setItem(SORT_KEY, JSON.stringify(next))
  }

  function startRename(name: string) {
    setRenaming(name)
    const stem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name
    setRenameVal(stem)
  }

  async function commitRename() {
    if (!renaming || !renameVal.trim()) { setRenaming(null); return }
    const ext = renaming.includes('.') ? renaming.slice(renaming.lastIndexOf('.')) : ''
    const newName = renameVal.trim() + ext
    const oldPath = [...path, renaming].join('/')
    await fetch('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_path: oldPath, new_name: newName }),
    })
    setRenaming(null)
    navigate(path)
  }

  function handleColResize(col: string, delta: number) {
    setColWidths(prev => {
      const next = { ...prev, [col]: Math.max(60, (prev[col] ?? 120) + delta) }
      saveColWidths(next)
      return next
    })
  }

  const colW = (col: string, def: number) => colWidths[col] ?? def

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb + Suche */}
      <div className="flex items-center gap-2 px-4 py-0.5 shadow-sm z-10 relative shrink-0 bg-gray-50">
        <div className="flex items-center gap-0">
          <button onClick={goBack} disabled={histIdx === 0 || path.length === 0} className="p-1.5 rounded-full hover:bg-white disabled:opacity-30 text-gray-500 hover:text-[var(--accent)] transition-colors">
            <ArrowLeft size={15}/>
          </button>
          <button onClick={goForward} disabled={histIdx >= history.length - 1} className="p-1.5 rounded-full hover:bg-white disabled:opacity-30 text-gray-500 hover:text-[var(--accent)] transition-colors">
            <ArrowRight size={15}/>
          </button>
        </div>
        <button onClick={() => pushPath([])} className="p-1.5 rounded-full hover:bg-white text-gray-500 hover:text-[var(--accent)] transition-colors">
          <Home size={15}/>
        </button>
        <div className="flex items-center gap-0">
          {path.map((seg, i) => (
            <span key={i} className="flex items-center gap-0.5">
              <ChevronRight size={13} className="text-gray-300"/>
              <button
                onClick={() => pushPath(path.slice(0, i + 1))}
                className={`px-2 py-1 rounded-full text-sm font-semibold transition-colors
                  ${i === path.length - 1 ? 'bg-white text-[var(--accent)]' : 'text-gray-600 hover:bg-white hover:text-[var(--accent)]'}`}
              >
                {seg === '__cloud__' ? '☁ Cloud' : seg}
              </button>
            </span>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Suchen…"
          className="ml-auto border border-gray-200 rounded-full px-2.5 py-1 text-sm w-44 focus:outline-none focus:ring-2 focus:border-transparent bg-white"
          style={{ '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
        />
      </div>

      {/* Tabellen-Header */}
      <div className="flex items-center border-b border-gray-100 bg-white shrink-0 text-xs font-semibold text-gray-500 tracking-wide select-none">
        <div className="w-8 pl-2">
          <input type="checkbox" onChange={e => {
            if (e.target.checked) scopeFiles.forEach(f => { if (!selectedFiles.has(f.path)) toggleFile(f.path, f) })
            else scopeFiles.forEach(f => { if (selectedFiles.has(f.path)) toggleFile(f.path, f) })
          }} className="accent-[var(--accent)]"/>
        </div>
        <button className="flex-1 px-2 py-2 text-left flex items-center gap-1 hover:text-gray-800 transition-colors" onClick={() => toggleSort('name')}>
          Name {sort.by === 'name' ? (sort.dir === 'asc' ? <ChevronUp size={12}/> : <ChevronDown size={12}/>) : null}
        </button>
        <div
          style={{ width: colW('date', 100) }}
          className="px-2 py-2 shrink-0 cursor-col-resize flex items-center justify-between"
          onMouseDown={e => {
            const startX = e.clientX
            const onMove = (ev: MouseEvent) => handleColResize('date', ev.clientX - startX)
            const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
            document.addEventListener('mousemove', onMove)
            document.addEventListener('mouseup', onUp)
          }}
        >
          <button onClick={() => toggleSort('date')} className="flex items-center gap-1 hover:text-gray-800 transition-colors">
            Datum {sort.by === 'date' ? (sort.dir === 'asc' ? <ChevronUp size={12}/> : <ChevronDown size={12}/>) : null}
          </button>
          <GripVertical size={12} className="text-gray-300"/>
        </div>
        <div style={{ width: colW('size', 80) }} className="px-2 py-2 shrink-0 text-right">Größe</div>
      </div>

      {/* Virtualisierte Liste — oder Skeleton beim ersten Laden */}
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto bg-white"
        onTouchStart={e => { swipeStart.current = e.touches[0].clientX }}
        onTouchEnd={e => {
          const dx = e.changedTouches[0].clientX - swipeStart.current
          if (Math.abs(dx) < 60) return
          if (dx < 0 && path.length > 0) pushPath(path.slice(0, -1))
          else if (dx > 0) goForward()
        }}
        onMouseDown={e => {
          if ((e.target as HTMLElement).closest('button, input, a')) return
          rbStart.current = { x: e.clientX, y: e.clientY }
          setRubberBand(null)
          const onMove = (ev: MouseEvent) => {
            if (!rbStart.current) return
            setRubberBand({ x1: rbStart.current.x, y1: rbStart.current.y, x2: ev.clientX, y2: ev.clientY })
          }
          const onUp = () => {
            rbStart.current = null
            setRubberBand(null)
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
          }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup', onUp)
        }}
      >
        {/* Leerer Ordner */}
        {dirEntries !== null && rows.length === 0 && !search && (
          <div className="flex items-center justify-center h-24 text-sm text-gray-400">
            Keine Dateien vorhanden
          </div>
        )}

        {/* Skeleton: sichtbar solange dirEntries noch nicht geladen ist */}
        {dirEntries === null && (
          <div aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="flex items-center border-b border-gray-100" style={{ height: 36 }}>
                <div className="w-8" />
                <div
                  className="h-3 rounded-md bg-gray-100 animate-pulse"
                  style={{ width: `${40 + (i * 17) % 38}%` }}
                />
              </div>
            ))}
          </div>
        )}

        <div style={{ height: virtualizer.getTotalSize() + 'px', position: 'relative' }}>
          {virtualizer.getVirtualItems().map(vi => {
            const row = rows[vi.index]
            if (!row) return null

            if (row.type === 'dir') {
              const folderFiles = folderFilesMap.get(row.name) ?? []
              const allSel = folderFiles.length > 0 && folderFiles.every(f => selectedFiles.has(f.path))
              const someSel = folderFiles.some(f => selectedFiles.has(f.path))
              return (
                <div
                  key={vi.key}
                  style={{ position: 'absolute', top: vi.start + 'px', width: '100%', height: vi.size + 'px' }}
                  className="flex items-center border-b border-gray-100 hover:bg-gray-50/80 transition-colors cursor-pointer select-none"
                  onClick={() => pushPath([...path, row.name])}
                >
                  <div className="w-8 pl-2" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={allSel}
                      ref={el => { if (el) el.indeterminate = someSel && !allSel }}
                      onChange={() => {
                        if (allSel) folderFiles.forEach(f => { if (selectedFiles.has(f.path)) toggleFile(f.path, f) })
                        else folderFiles.forEach(f => { if (!selectedFiles.has(f.path)) toggleFile(f.path, f) })
                      }}
                      className="accent-[var(--accent)]"
                    />
                  </div>
                  <div className="flex-1 px-2 text-sm flex items-center gap-2">
                    <Folder size={15} className="shrink-0" style={{ color: 'var(--accent)' }}/>
                    <span className="text-gray-700 truncate">{row.name}</span>
                  </div>
                  <div style={{ width: colW('date', 100) }} />
                  <div style={{ width: colW('size', 80) }} className="px-2 text-xs text-right text-gray-300 shrink-0">–</div>
                </div>
              )
            }

            const { file } = row
            const sel = selectedFiles.has(file.path)

            return (
              <div
                key={vi.key}
                style={{
                  position: 'absolute', top: vi.start + 'px', width: '100%', height: vi.size + 'px',
                  background: sel ? 'var(--accent-xl)' : undefined,
                  boxShadow: sel ? 'inset 3px 0 0 var(--accent)' : undefined,
                }}
                className="flex items-center border-b border-gray-100 hover:bg-gray-50/80 transition-colors select-none"
                onDoubleClick={() => setOverlay(file.path)}
                onKeyDown={e => {
                  if (e.key === 'F2') { startRename(file.path.split('/').pop() ?? '') }
                }}
              >
                <div className="w-8 pl-2">
                  <input
                    type="checkbox"
                    checked={sel}
                    onChange={() => toggleFile(file.path, file)}
                    className="accent-[var(--accent)]"
                  />
                </div>
                <div className="flex-1 px-2 text-sm truncate flex items-center gap-2">
                  <Music size={13} className="shrink-0 text-gray-400"/>
                  {renaming === file.path.split('/').pop() ? (
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      className="border border-[var(--accent)] rounded-md px-1.5 text-sm w-full focus:outline-none"
                    />
                  ) : (
                    <span className="truncate">{file.title || file.path.split('/').pop()}</span>
                  )}
                </div>
                <div style={{ width: colW('date', 100) }} className="px-2 text-xs text-gray-400 shrink-0">
                  {formatDate(file.date)}
                </div>
                <div style={{ width: colW('size', 80) }} className="px-2 text-xs text-right text-gray-300 shrink-0">
                  {fmtBytes(file.size)}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Rubber-Band */}
      {rubberBand && (
        <div
          className="rubber-band"
          style={{
            left: Math.min(rubberBand.x1, rubberBand.x2),
            top: Math.min(rubberBand.y1, rubberBand.y2),
            width: Math.abs(rubberBand.x2 - rubberBand.x1),
            height: Math.abs(rubberBand.y2 - rubberBand.y1),
          }}
        />
      )}

      {/* Datei-Overlay */}
      {overlay && (
        <FileOverlay
          filePath={overlay}
          onClose={() => setOverlay(null)}
        />
      )}
    </div>
  )
}
