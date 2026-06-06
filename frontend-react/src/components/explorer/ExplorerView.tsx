import { useState, useRef, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, Home } from 'lucide-react'
import { useFilesStore } from '@/stores/filesStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useConfigStore } from '@/stores/configStore'
import { useUISettingsStore } from '@/stores/uiSettingsStore'
import { fmtBytes, formatDate } from '@/lib/dateUtils'
import type { AudioFile } from '@/types'
import FileOverlay from './FileOverlay'

const COL_KEY = 'sc_colWidths'

function loadColWidths() {
  try { return JSON.parse(localStorage.getItem(COL_KEY) || '{}') } catch { return {} }
}
function saveColWidths(w: Record<string, number>) {
  localStorage.setItem(COL_KEY, JSON.stringify(w))
}

type SortBy = 'name' | 'date'
type SortDir = 'asc' | 'desc'
const SORT_KEY = 'sc_sort'

interface DirEntry { name: string; is_dir: boolean; size: number }

export default function ExplorerView() {
  const allFiles = useFilesStore(s => s.allFiles)
  const { selectedFiles, toggleFile } = useSelectionStore()
  const audioPath = useConfigStore(s => s.config.audio_path)
  const settings = useUISettingsStore(s => s.settings)

  const [path, setPath] = useState<string[]>([])           // Breadcrumb-Stack
  const [history, setHistory] = useState<string[][]>([[]])
  const [histIdx, setHistIdx] = useState(0)
  const [search, setSearch] = useState('')
  const [overlay, setOverlay] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [dirEntries, setDirEntries] = useState<DirEntry[] | null>(null)
  const [colWidths, setColWidths] = useState<Record<string, number>>(loadColWidths)
  const [sort, setSort] = useState<{ by: SortBy; dir: SortDir }>(() => {
    try { return JSON.parse(localStorage.getItem(SORT_KEY) || '{}') } catch { return { by: settings.sortBy as SortBy, dir: settings.sortDir as SortDir } }
  })

  const isCloud = path[0] === '__cloud__'
  const currentFolder = path.join('/')

  // Rubber-Band
  const parentRef = useRef<HTMLDivElement>(null)
  const [rubberBand, setRubberBand] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const rbStart = useRef<{ x: number; y: number } | null>(null)

  // Swipe
  const swipeStart = useRef(0)

  const navigate = useCallback(async (newPath: string[]) => {
    setPath(newPath)
    setSearch('')
    if (newPath[0] === '__cloud__') return
    if (audioPath) {
      const rel = newPath.join('/')
      const res = await fetch(`/api/open?path=${encodeURIComponent(rel || '.')}`)
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) setDirEntries(data as DirEntry[])
        else setDirEntries(null)
      }
    }
  }, [audioPath])

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

  // Aktuell angezeigte Zeilen berechnen
  type Row = { type: 'dir'; name: string; size: number } | { type: 'file'; file: AudioFile }

  let rows: Row[] = []
  if (isCloud) {
    // Cloud-Modus: wird separat behandelt
  } else if (dirEntries !== null) {
    // Verzeichnis-Ansicht über API
    const filtered = dirEntries.filter(e =>
      !search || e.name.toLowerCase().includes(search.toLowerCase())
    )
    const dirs = filtered.filter(e => e.is_dir).sort((a, b) => a.name.localeCompare(b.name))
    const files = filtered.filter(e => !e.is_dir)
    rows = [
      ...dirs.map(d => ({ type: 'dir' as const, name: d.name, size: d.size })),
      ...files.map(f => {
        const rel = [...path, f.name].join('/')
        const dbFile = allFiles.find(af => af.path === rel)
        return { type: 'file' as const, file: dbFile ?? { path: rel, title: f.name, date: '', folder: '', artist: '', album: '', size: f.size, mtime: 0 } }
      }),
    ]
  } else {
    // Root-Ansicht: alle Dateien aus DB
    const filesInFolder = currentFolder
      ? allFiles.filter(f => f.path.startsWith(currentFolder + '/'))
      : allFiles
    const filtered = filesInFolder.filter(f =>
      !search || f.title.toLowerCase().includes(search.toLowerCase()) || f.path.toLowerCase().includes(search.toLowerCase())
    )
    const sorted = [...filtered].sort((a, b) => {
      const mul = sort.dir === 'asc' ? 1 : -1
      if (sort.by === 'date') return mul * a.date.localeCompare(b.date)
      return mul * a.title.localeCompare(b.title)
    })
    rows = sorted.map(f => ({ type: 'file' as const, file: f }))
  }

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
      <div className="flex items-center gap-2 px-3 py-1.5 border-b shrink-0 bg-white">
        <button onClick={() => pushPath([])} className="p-1 hover:bg-gray-100 rounded"><Home size={15}/></button>
        {path.map((seg, i) => (
          <span key={i} className="flex items-center gap-1 text-sm">
            <ChevronRight size={13} className="text-gray-400"/>
            <button
              onClick={() => pushPath(path.slice(0, i + 1))}
              className="hover:underline"
              style={{ color: i === path.length - 1 ? 'var(--accent)' : undefined }}
            >
              {seg === '__cloud__' ? '☁ Cloud' : seg}
            </button>
          </span>
        ))}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Suchen…"
          className="ml-auto border rounded px-2 py-0.5 text-sm w-40 focus:outline-none focus:ring-1"
          style={{ '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
        />
        <button onClick={goBack} disabled={histIdx === 0} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">‹</button>
        <button onClick={goForward} disabled={histIdx >= history.length - 1} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">›</button>
      </div>

      {/* Tabellen-Header */}
      <div className="flex items-center border-b bg-gray-50 shrink-0 text-xs font-medium text-gray-500 select-none">
        <div className="w-8 pl-2">
          <input type="checkbox" onChange={e => {
            const fileRows = rows.filter(r => r.type === 'file').map(r => (r as { type: 'file'; file: AudioFile }).file)
            if (e.target.checked) fileRows.forEach(f => { if (!selectedFiles.has(f.path)) toggleFile(f.path, f) })
            else fileRows.forEach(f => { if (selectedFiles.has(f.path)) toggleFile(f.path, f) })
          }} className="accent-[var(--accent)]"/>
        </div>
        <button className="flex-1 px-2 py-1.5 text-left hover:text-gray-800" onClick={() => toggleSort('name')}>
          Name {sort.by === 'name' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
        </button>
        <div style={{ width: colW('date', 100) }} className="px-2 py-1.5 shrink-0 cursor-col-resize flex items-center justify-between"
          onMouseDown={e => {
            const startX = e.clientX
            const onMove = (ev: MouseEvent) => handleColResize('date', ev.clientX - startX)
            const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
            document.addEventListener('mousemove', onMove)
            document.addEventListener('mouseup', onUp)
          }}
        >
          <button onClick={() => toggleSort('date')}>Datum {sort.by === 'date' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</button>
          <span className="text-gray-300">⋮</span>
        </div>
        <div style={{ width: colW('size', 80) }} className="px-2 py-1.5 shrink-0 text-right">Größe</div>
      </div>

      {/* Virtualisierte Liste */}
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto"
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
        <div style={{ height: virtualizer.getTotalSize() + 'px', position: 'relative' }}>
          {virtualizer.getVirtualItems().map(vi => {
            const row = rows[vi.index]
            if (!row) return null

            if (row.type === 'dir') {
              return (
                <div
                  key={vi.key}
                  style={{ position: 'absolute', top: vi.start + 'px', width: '100%', height: vi.size + 'px' }}
                  className="flex items-center border-b hover:bg-gray-50 cursor-pointer select-none"
                  onDoubleClick={() => pushPath([...path, row.name])}
                >
                  <div className="w-8" />
                  <div className="flex-1 px-2 text-sm flex items-center gap-1.5">
                    <span>📁</span>
                    <span>{row.name}</span>
                  </div>
                  <div style={{ width: colW('date', 100) }} />
                  <div style={{ width: colW('size', 80) }} className="px-2 text-xs text-right text-gray-400">–</div>
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
                className="flex items-center border-b hover:bg-gray-50 select-none"
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
                <div className="flex-1 px-2 text-sm truncate">
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
                      className="border rounded px-1 text-sm w-full"
                    />
                  ) : (
                    file.title || file.path.split('/').pop()
                  )}
                </div>
                <div style={{ width: colW('date', 100) }} className="px-2 text-xs text-gray-500 shrink-0">
                  {formatDate(file.date)}
                </div>
                <div style={{ width: colW('size', 80) }} className="px-2 text-xs text-right text-gray-400 shrink-0">
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
