import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, Home, ArrowLeft, ArrowRight, Folder, Music, ChevronUp, ChevronDown, Check, Minus, Cloud } from 'lucide-react'
import { useFilesStore } from '@/stores/filesStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUISettingsStore } from '@/stores/uiSettingsStore'
import { fmtBytes, formatDate } from '@/lib/dateUtils'
import type { AudioFile } from '@/types'
import { fetchDir, getCachedDir, onCacheInvalidated, prefetchSubdirs } from './explorerCache'
import type { DirEntry } from './explorerCache'

const CLOUD_FOLDER = 'Bruderschaft'
const COL_KEY = 'fs_colWidths'

function loadColWidths() {
  try { return JSON.parse(localStorage.getItem(COL_KEY) || '{}') } catch { return {} }
}
function saveColWidths(w: Record<string, number>) {
  localStorage.setItem(COL_KEY, JSON.stringify(w))
}

type SortBy = 'name' | 'date' | 'size'
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
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [dirEntries, setDirEntries] = useState<DirEntry[] | null>(() => getCachedDir(loadSavedPath().join('/')))
  const [colWidths, setColWidths] = useState<Record<string, number>>(loadColWidths)
  const [sort, setSort] = useState<{ by: SortBy; dir: SortDir }>(() => {
    try { return JSON.parse(localStorage.getItem(SORT_KEY) || '{}') } catch { return { by: settings.sortBy as SortBy, dir: settings.sortDir as SortDir } }
  })

  const isCloud = path[0] === CLOUD_FOLDER
  const currentFolder = path.join('/')

  const parentRef = useRef<HTMLDivElement>(null)
  const swipeStartX = useRef(0)
  const swipeStartY = useRef(0)
  const swiping = useRef(false)
  const navId = useRef(0)
  const navDir = useRef<'next' | 'prev'>('next')
  const didNavigate = useRef(false)

  const navigate = useCallback((newPath: string[]) => {
    const key = newPath.join('/')
    const id = ++navId.current
    setSearch('')

    const cached = getCachedDir(key)
    if (cached) {
      didNavigate.current = true
      setPath(newPath)
      setDirEntries(cached)
      fetchDir(key).then(data => {
        if (navId.current !== id) return
        if (data) setDirEntries(data)
      })
      return
    }

    // Cache-Miss: erst warten, dann Pfad + Inhalt atomar setzen → kein Skeleton-Flash.
    fetchDir(key).then(data => {
      if (navId.current !== id) return
      if (data !== null) {
        didNavigate.current = true
        setPath(newPath)
        setDirEntries(data)
      } else if (key) navigate(newPath.slice(0, -1))
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
    if (newPath.join('/') === path.join('/')) return
    navDir.current = newPath.length > path.length ? 'next' : 'prev'
    const next = history.slice(0, histIdx + 1)
    next.push(newPath)
    setHistory(next)
    setHistIdx(next.length - 1)
    navigate(newPath)
  }

  function goBack() {
    if (histIdx > 0) { navDir.current = 'prev'; setHistIdx(h => h - 1); navigate(history[histIdx - 1]) }
  }
  function goForward() {
    if (histIdx < history.length - 1) { navDir.current = 'next'; setHistIdx(h => h + 1); navigate(history[histIdx + 1]) }
  }

  type Row = { type: 'dir'; name: string; size: number; modTime: string } | { type: 'file'; file: AudioFile }

  // Einziger O(n)-Pass über allFiles — baut gleichzeitig:
  //   filesByPath    → O(1) Lookup für Metadaten-Anreicherung (Titel, Datum, …)
  //   folderFilesMap → O(1) Ordner-Children für Ordner-Checkboxen
  //   scopeFiles     → für "Alle auswählen"-Checkbox
  //
  // Einzige Quelle für die angezeigte Liste: dirEntries (von /api/open).
  // Kein DB-Fallback mehr — bei dirEntries === null zeigt das JSX ein Skeleton.
  const { rows, folderFilesMap, scopeFiles } = useMemo(() => {
    type Result = { rows: Row[]; folderFilesMap: Map<string, AudioFile[]>; scopeFiles: AudioFile[] }
    if (dirEntries === null) return { rows: [], folderFilesMap: new Map(), scopeFiles: [] } as Result

    const searchLower = search.toLowerCase()
    const prefix = currentFolder ? currentFolder + '/' : ''

    // Virtuellen "Bruderschaft"-Ordner am Root injizieren
    const effectiveDirEntries = (path.length === 0)
      ? [{ name: CLOUD_FOLDER, is_dir: true, size: 0, mod_time: '' }, ...dirEntries]
      : dirEntries

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

    const filtered = effectiveDirEntries.filter(e => !search || e.name.toLowerCase().includes(searchLower))
    const mul = sort.dir === 'asc' ? 1 : -1
    const rows: Row[] = [
      ...filtered.filter(e => e.is_dir)
        .sort((a, b) => {
          if (a.name === CLOUD_FOLDER) return -1
          if (b.name === CLOUD_FOLDER) return 1
          return sort.by === 'size' ? mul * (a.size - b.size) : sort.by === 'date' ? mul * a.mod_time.localeCompare(b.mod_time) : mul * a.name.localeCompare(b.name)
        })
        .map(d => ({ type: 'dir' as const, name: d.name, size: d.size, modTime: d.mod_time })),
      ...filtered.filter(e => !e.is_dir)
        .map(f => {
          const rel = [...path, f.name].join('/')
          return { type: 'file' as const, file: filesByPath.get(rel) ?? { path: rel, title: f.name, date: '', folder: '', artist: '', album: '', size: f.size, mtime: 0 } }
        })
        .sort((a, b) => sort.by === 'date' ? mul * a.file.date.localeCompare(b.file.date) : sort.by === 'size' ? mul * (a.file.size - b.file.size) : mul * a.file.title.localeCompare(b.file.title)),
    ]

    return { rows, folderFilesMap, scopeFiles } as Result
  }, [dirEntries, allFiles, currentFolder, path, search, sort])

  const nameColWidth = useMemo(() => {
    if (!rows.length) return undefined
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.font = '14px ui-sans-serif, system-ui, sans-serif'
    let max = 0
    for (const row of rows) {
      const label = row.type === 'dir' ? row.name : (row.file.title || row.file.path.split('/').pop() || '')
      const w = ctx.measureText(label).width
      if (w > max) max = w
    }
    return Math.ceil(max) + 15 + 8 + 8 + 8 + 8 // icon + gap + padding
  }, [rows])

  const allScopeSelected = scopeFiles.length > 0 && scopeFiles.every(f => selectedFiles.has(f.path))
  const someScopeSelected = scopeFiles.some(f => selectedFiles.has(f.path))

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

  const COL_MINS: Record<string, number> = { name: 80, date: 155, size: 60 }

  function handleColResize(col: string, delta: number) {
    setColWidths(prev => {
      const min = COL_MINS[col] ?? 60
      const next = { ...prev, [col]: Math.max(min, (prev[col] ?? 120) + delta) }
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
            <ArrowLeft size={19}/>
          </button>
          <button onClick={goForward} disabled={histIdx >= history.length - 1} className="p-1.5 rounded-full hover:bg-white disabled:opacity-30 text-gray-500 hover:text-[var(--accent)] transition-colors">
            <ArrowRight size={19}/>
          </button>
        </div>
        <button onClick={() => pushPath([])} className="p-1.5 rounded-full hover:bg-white text-gray-500 hover:text-[var(--accent)] transition-colors">
          <Home size={19}/>
        </button>
        <div className="flex items-center gap-0">
          {path.map((seg, i) => (
            <span key={i} className="flex items-center gap-0.5">
              <ChevronRight size={17} className="text-gray-300"/>
              <button
                onClick={() => pushPath(path.slice(0, i + 1))}
                className={`px-2 py-1 rounded-full text-sm font-semibold transition-colors
                  ${i === path.length - 1 ? 'bg-white text-gray-900' : 'text-gray-400 hover:bg-white hover:text-gray-900'}`}
              >
                {seg === CLOUD_FOLDER ? '☁ ' + seg : seg}
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
      <div className="flex items-center border-b border-gray-100 bg-white shrink-0 text-sm font-semibold text-gray-500 tracking-wide select-none">
        <label className="w-8 flex items-center justify-center cursor-pointer">
          <input type="checkbox" checked={allScopeSelected} onChange={() => {
            if (allScopeSelected) scopeFiles.forEach(f => { if (selectedFiles.has(f.path)) toggleFile(f.path, f) })
            else scopeFiles.forEach(f => { if (!selectedFiles.has(f.path)) toggleFile(f.path, f) })
          }} className="sr-only"/>
          <span className={`w-[15px] h-[15px] rounded-sm border flex items-center justify-center shrink-0 ${allScopeSelected ? 'bg-[var(--accent)] border-[var(--accent)]' : someScopeSelected ? 'bg-white border-[var(--accent)]' : 'bg-white border-gray-300'}`}>
            {allScopeSelected && <Check size={10} className="text-white" strokeWidth={3}/>}
            {someScopeSelected && !allScopeSelected && <Minus size={10} style={{ color: 'var(--accent)' }} strokeWidth={3}/>}
          </span>
        </label>
        <div
          style={colWidths['name'] ?? nameColWidth ? { width: colWidths['name'] ?? nameColWidth } : undefined}
          className={`${colWidths['name'] ?? nameColWidth ? 'shrink-0' : 'flex-1'} px-2 py-2 flex items-center justify-between`}
        >
          <button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-gray-800 transition-colors">
            Name {sort.by === 'name' ? (sort.dir === 'asc' ? <ChevronUp size={12}/> : <ChevronDown size={12}/>) : null}
          </button>
          <div
            className="flex items-center justify-center w-5 h-full cursor-col-resize"
            onMouseDown={e => {
              e.preventDefault()
              let lastX = e.clientX
              const onMove = (ev: MouseEvent) => { handleColResize('name', ev.clientX - lastX); lastX = ev.clientX }
              const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
              document.addEventListener('mousemove', onMove)
              document.addEventListener('mouseup', onUp)
            }}
          >
            <div className="w-px h-4 bg-gray-300" />
          </div>
        </div>
        <div
          style={{ width: colW('date', 155) }}
          className="px-2 py-2 shrink-0 flex items-center justify-between"
        >
          <button onClick={() => toggleSort('date')} className="flex items-center gap-1 hover:text-gray-800 transition-colors">
            Änderungsdatum {sort.by === 'date' ? (sort.dir === 'asc' ? <ChevronUp size={12}/> : <ChevronDown size={12}/>) : null}
          </button>
          <div
            className="flex items-center justify-center w-5 h-full cursor-col-resize"
            onMouseDown={e => {
              e.preventDefault()
              let lastX = e.clientX
              const onMove = (ev: MouseEvent) => { handleColResize('date', ev.clientX - lastX); lastX = ev.clientX }
              const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
              document.addEventListener('mousemove', onMove)
              document.addEventListener('mouseup', onUp)
            }}
          >
            <div className="w-px h-4 bg-gray-300" />
          </div>
        </div>
        <button style={{ width: colW('size', 80) }} className="px-2 py-2 shrink-0 flex items-center gap-1 hover:text-gray-800 transition-colors" onClick={() => toggleSort('size')}>
          Größe <span className="inline-flex w-3 justify-center">{sort.by === 'size' ? (sort.dir === 'asc' ? <ChevronUp size={12}/> : <ChevronDown size={12}/>) : null}</span>
        </button>
        <div className="flex-1" />
      </div>

      {/* Virtualisierte Liste — oder Skeleton beim ersten Laden */}
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto overflow-x-hidden bg-white"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={e => { swipeStartX.current = e.clientX; swipeStartY.current = e.clientY; swiping.current = true }}
        onPointerUp={e => {
          if (!swiping.current) return
          swiping.current = false
          const dx = e.clientX - swipeStartX.current
          const dy = e.clientY - swipeStartY.current
          if (Math.abs(dx) < settings.swipeThreshold) return
          if (Math.abs(dy) > Math.abs(dx)) return
          if (dx < 0 && path.length > 0) goBack()
          else if (dx > 0) goForward()
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

        <div
          key={currentFolder}
          className={didNavigate.current ? (settings.calAnimation === 'slide' ? (navDir.current === 'next' ? 'cal-month-next' : 'cal-month-prev') : `cal-anim-${settings.calAnimation}`) : ''}
          style={{ '--cal-dur': { slow: '0.6s', normal: '0.3s', fast: '0.15s' }[settings.calAnimSpeed] ?? '0.3s' } as React.CSSProperties}
        >
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
                  className="flex items-center border-b border-gray-100 hover:bg-gray-100 transition-colors cursor-pointer select-none"
                  onClick={() => pushPath([...path, row.name])}
                >
                  <label className="w-8 h-full flex items-center justify-center cursor-pointer" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={allSel} onChange={() => {
                      if (allSel) folderFiles.forEach(f => { if (selectedFiles.has(f.path)) toggleFile(f.path, f) })
                      else folderFiles.forEach(f => { if (!selectedFiles.has(f.path)) toggleFile(f.path, f) })
                    }} className="sr-only"/>
                    <span className={`w-[15px] h-[15px] rounded-sm border flex items-center justify-center shrink-0 ${allSel ? 'bg-[var(--accent)] border-[var(--accent)]' : someSel ? 'bg-white border-[var(--accent)]' : 'bg-white border-gray-300'}`}>
                      {allSel && <Check size={10} className="text-white" strokeWidth={3}/>}
                      {someSel && !allSel && <Minus size={10} style={{ color: 'var(--accent)' }} strokeWidth={3}/>}
                    </span>
                  </label>
                  <div style={(colWidths['name'] ?? nameColWidth) ? { width: colWidths['name'] ?? nameColWidth } : undefined} className={`${(colWidths['name'] ?? nameColWidth) ? 'shrink-0' : 'flex-1'} px-2 text-sm flex items-center gap-2`}>
                    {(isCloud || row.name === CLOUD_FOLDER)
                      ? <Cloud size={15} className="shrink-0 text-blue-400"/>
                      : <Folder size={15} className="shrink-0 text-gray-400"/>}
                    <span className="text-gray-700 truncate">{row.name}</span>
                  </div>
                  <div style={{ width: colW('date', 155) }} className="px-2 text-sm text-gray-700 shrink-0">{row.modTime ? formatDate(row.modTime.slice(0, 10)) : ''}</div>
                  <div style={{ width: colW('size', 80) }} className="px-2 text-sm text-gray-700 shrink-0">
                    {folderFiles.length > 0 ? fmtBytes(folderFiles.reduce((s, f) => s + f.size, 0)) : <span className="text-gray-300 block text-center">–</span>}
                  </div>
                  <div className="flex-1" />
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
                }}
                className="flex items-center border-b border-gray-100 hover:bg-gray-100 transition-colors select-none"
                onKeyDown={e => {
                  if (e.key === 'F2') { startRename(file.path.split('/').pop() ?? '') }
                }}
              >
                <label className="w-8 h-full flex items-center justify-center cursor-pointer">
                  <input type="checkbox" checked={sel} onChange={() => toggleFile(file.path, file)} className="sr-only"/>
                  <span className={`w-[15px] h-[15px] rounded-sm border flex items-center justify-center shrink-0 ${sel ? 'bg-[var(--accent)] border-[var(--accent)]' : 'bg-white border-gray-300'}`}>
                    {sel && <Check size={10} className="text-white" strokeWidth={3}/>}
                  </span>
                </label>
                <div style={(colWidths['name'] ?? nameColWidth) ? { width: colWidths['name'] ?? nameColWidth } : undefined} className={`${(colWidths['name'] ?? nameColWidth) ? 'shrink-0' : 'flex-1'} px-2 text-sm truncate flex items-center gap-2`}>
                  <Music size={15} className="shrink-0 text-gray-400"/>
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
                <div style={{ width: colW('date', 155) }} className="px-2 text-sm text-gray-700 shrink-0">
                  {formatDate(file.date)}
                </div>
                <div style={{ width: colW('size', 80) }} className="px-2 text-sm text-gray-700 shrink-0">
                  {fmtBytes(file.size)}
                </div>
                <div className="flex-1" />
              </div>
            )
          })}
        </div>
        </div>
      </div>

      {/* Rubber-Band — ausgeklammert */}

    </div>
  )
}
