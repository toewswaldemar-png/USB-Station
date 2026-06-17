import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, Home, ArrowLeft, ArrowRight, Folder, Music, ChevronUp, ChevronDown, Check, Minus, Cloud, Image, FileText, File, AlignLeft, X, Search } from 'lucide-react'
import { useFilesStore } from '@/stores/filesStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUISettingsStore } from '@/stores/uiSettingsStore'
import { useConfigStore } from '@/stores/configStore'
import { useUserStore } from '@/stores/userStore'
import { usePlayerStore } from '@/stores/playerStore'
import { fmtBytes, formatDate } from '@/lib/dateUtils'
import type { AudioFile } from '@/types'
import { fetchDir, getCachedDir, onCacheInvalidated, prefetchSubdirs, seedCloudDirCache } from './explorerCache'
import type { DirEntry } from './explorerCache'
import FileViewer from './FileViewer'
import { getFileType, type FileType } from '@/lib/fileType'

const COL_KEY = 'fs_colWidths'

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const lower = text.toLowerCase()
  const qLower = query.toLowerCase()
  const idx = lower.indexOf(qLower)
  if (idx === -1) return <>{text}</>
  return <>
    {text.slice(0, idx)}
    <mark className="bg-yellow-200 text-gray-900 px-0.5 rounded-sm not-italic">{text.slice(idx, idx + query.length)}</mark>
    {text.slice(idx + query.length)}
  </>
}

function loadColWidths() {
  try { return JSON.parse(localStorage.getItem(COL_KEY) || '{}') } catch { return {} }
}
function saveColWidths(w: Record<string, number>) {
  localStorage.setItem(COL_KEY, JSON.stringify(w))
}

type SortBy = 'name' | 'date' | 'size'
type SortDir = 'asc' | 'desc'
const PATH_KEY = 'fs_path'

function loadSavedPath(): string[] {
  try { return JSON.parse(localStorage.getItem(PATH_KEY) || '[]') } catch { return [] }
}

interface ExplorerViewProps {
  isMobile?: boolean
  resetKey?: number
}

export default function ExplorerView({ isMobile = false, resetKey }: ExplorerViewProps) {
  const allFiles = useFilesStore(s => s.allFiles)
  const { selectedFiles, toggleFile, addFiles, registerFileMeta } = useSelectionStore()
  const webdavFolderRaw = useConfigStore(s => s.config.webdav_folder)
  const cloudFolder = webdavFolderRaw || 'Cloud'
  const webdavUrl = useConfigStore(s => s.config.webdav_url)
  const webdavConfigured = !!webdavUrl || !!webdavFolderRaw
  const { settings, update: updateSettings } = useUISettingsStore()
  const role = useUserStore(s => s.role)
  const playTrack = usePlayerStore(s => s.playTrack)
  const currentTrackPath = usePlayerStore(s => s.currentTrack?.path)

  const [path, setPath] = useState<string[]>(loadSavedPath)
  const [history, setHistory] = useState<string[][]>(() => [loadSavedPath()])
  const [histIdx, setHistIdx] = useState(0)
  const [search, setSearch] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [dirEntries, setDirEntries] = useState<DirEntry[] | null>(() => getCachedDir(loadSavedPath().join('/')))
  const [colWidths, setColWidths] = useState<Record<string, number>>(loadColWidths)
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set())
  const [cloudFolderFiles, setCloudFolderFiles] = useState<Map<string, AudioFile[]>>(() => {
    try {
      const raw = sessionStorage.getItem('fs_cloud_cache')
      if (raw) return new Map(JSON.parse(raw).files as [string, AudioFile[]][])
    } catch {}
    return new Map()
  })
  // Direkt via list-recursive vollständig geladene Ordner. Nur diese dürfen allSel=true zeigen.
  // Elternordner mit Merge-Teildaten zeigen – (someSel), bis sie selbst vollständig geladen werden.
  const [completedCloudFolders, setCompletedCloudFolders] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem('fs_cloud_cache')
      if (raw) return new Set(JSON.parse(raw).completed as string[])
    } catch {}
    return new Set()
  })
  // Nicht-Admins können lokal sortieren (Session, kein Persist), Admins speichern global.
  const [localFolderSort, setLocalFolderSort] = useState<Record<string, { by: SortBy; dir: SortDir }>>({})
  const [viewerFile, setViewerFile] = useState<{ path: string; name: string; type: Exclude<FileType, 'other'> } | null>(null)
  const [globalResults, setGlobalResults] = useState<AudioFile[]>([])
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [navigating, setNavigating] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)
  const [highlightedPath, setHighlightedPath] = useState<string | null>(null)
  const [typeaheadQuery, setTypeaheadQuery] = useState('')
  const [typeaheadIndex, setTypeaheadIndex] = useState<number | null>(null)
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prefetchingFolders = useRef(new Set<string>())

  const isFirstReset = useRef(true)
  useLayoutEffect(() => {
    if (isFirstReset.current) { isFirstReset.current = false; return }
    const id = ++navId.current
    didNavigate.current = false
    setPath([])
    setDirEntries(getCachedDir('') ?? null)
    setHistory([[]])
    setHistIdx(0)
    fetchDir('').then(data => {
      if (navId.current !== id) return
      if (data) setDirEntries(data)
    })
  }, [resetKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const isCloud = !!webdavUrl && path[0] === cloudFolder
  const currentFolder = path.join('/')
  const isSearching = search.length >= 2
  const sort: { by: SortBy; dir: SortDir } =
    localFolderSort[currentFolder]
    ?? settings.folderSort?.[currentFolder]
    ?? { by: 'date', dir: 'desc' }

  const parentRef = useRef<HTMLDivElement>(null)
  const swipeStartX = useRef(0)
  const swipeStartY = useRef(0)
  const swiping = useRef(false)
  const navId = useRef(0)
  const navDir = useRef<'next' | 'prev'>('next')
  const didNavigate = useRef(false)
  const cloudFolderRef = useRef(cloudFolder)
  cloudFolderRef.current = cloudFolder

  const navigate = useCallback((newPath: string[]) => {
    const key = newPath.join('/')
    const id = ++navId.current
    didNavigate.current = false
    setSearch('')
    setNavigating(false)  // vorige Ladeanimation immer zurücksetzen

    const isCloudPath = (k: string) => { const cf = cloudFolderRef.current; return k === cf || k.startsWith(cf + '/') }

    const cached = getCachedDir(key)
    if (cached) {
      didNavigate.current = true
      setPath(newPath)
      setDirEntries(cached)
      setCloudError(null)
      fetchDir(key).then(data => {
        if (navId.current !== id) return
        if (data) { setDirEntries(data); setCloudError(null) }
        else if (key) {
          if (isCloudPath(key)) setCloudError('Cloud-Server nicht erreichbar')
          else navigate(newPath.slice(0, -1))
        }
      })
      return
    }

    // Cache-Miss: Spinner für Cloud-Pfade — lokale Ordner sind zu schnell für sichtbares Feedback.
    if (isCloudPath(key)) setNavigating(true)
    fetchDir(key).then(data => {
      if (navId.current !== id) return
      setNavigating(false)
      if (data !== null) {
        didNavigate.current = true
        setPath(newPath)
        setDirEntries(data)
        setCloudError(null)
      } else if (key) {
        if (isCloudPath(key)) {
          didNavigate.current = true
          setPath(newPath)
          setDirEntries([])
          setCloudError('Cloud-Server nicht erreichbar')
        } else {
          navigate(newPath.slice(0, -1))
        }
      }
    })
  }, [])

  // Beim ersten Mount: gespeicherten Pfad wiederherstellen + Server-Refresh starten.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { navigate(path) }, [])

  // Bei Cache-Invalidierung (SSE done:) aktuelles Verzeichnis neu laden
  const pathRef = useRef(path)
  pathRef.current = path
  useEffect(() => onCacheInvalidated(() => {
    const p = pathRef.current
    fetchDir(p.join('/')).then(data => {
      if (data) setDirEntries(data)
      else if (p.length > 0) navigate(p.slice(0, -1))
    })
  }), [navigate])

  // Aktuellen Pfad persistieren — wird beim Neuladen wiederhergestellt.
  useEffect(() => {
    localStorage.setItem(PATH_KEY, JSON.stringify(path))
  }, [path])

  // Ctrl+F → Suchfeld fokussieren
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'f' && e.ctrlKey) { e.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // cloudError zurücksetzen wenn Cloud-Ordner verlassen
  useEffect(() => { if (!isCloud) setCloudError(null) }, [isCloud])

  // Globale Suche — debounced, ab 2 Zeichen
  useEffect(() => {
    if (search.length < 2) { setGlobalResults([]); return }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(search)}`)
        if (res.ok) setGlobalResults(await res.json())
      } catch { /* ignorieren */ }
    }, 300)
    return () => clearTimeout(timer)
  }, [search])


  // Prefetch: Unterordner der aktuellen Ebene im Hintergrund vorladen.
  // Limit: max. 3 gleichzeitig, max. 8 Unterordner (NAS-Schutz — siehe explorerCache.ts).
  useEffect(() => {
    if (!dirEntries || isCloud) return
    prefetchSubdirs(currentFolder, dirEntries)
  }, [dirEntries, currentFolder, isCloud])

  // SessionStorage-Cache: Cloud-Baumstruktur nach Reload wiederherstellen.
  useEffect(() => {
    if (!webdavConfigured) return
    if (cloudFolderFiles.size === 0 && completedCloudFolders.size === 0) return
    try {
      sessionStorage.setItem('fs_cloud_cache', JSON.stringify({
        files: Array.from(cloudFolderFiles.entries()),
        completed: Array.from(completedCloudFolders),
      }))
    } catch {}
  }, [cloudFolderFiles, completedCloudFolders, webdavConfigured])

  // Hintergrund-Prefetch für Cloud-Unterordner — zwei unabhängige Tracks:
  //
  // Track 1 – Navigate-Cache (fetchDir / /api/open):
  //   Einzelner PROPFIND pro Unterordner → kein 500-Dir-Limit.
  //   Befüllt _cache[fp] mit den Direktkindern → navigate() liefert sofort aus dem Cache.
  //
  // Track 2 – Dateiauswahl-Cache (fetchCloudFolder / /api/list-recursive):
  //   Rekursiver PROPFIND → Ordnergrößen + Dateiliste für Checkbox-Selektion.
  //   Kann bei großen Ordnern (>500 Verzeichnisse) partiell sein — für Navigation
  //   kein Problem, da Track 1 bereits korrekte Direktkinder geliefert hat.
  useEffect(() => {
    if (!isCloud || !dirEntries) return
    const dirs = dirEntries.filter(e => e.is_dir)
    if (dirs.length === 0) return

    // Track 1: Navigate-Cache — fetchDir für jeden sichtbaren Unterordner.
    let navRunning = 0, navIdx = 0
    function nextNav() {
      while (navRunning < 3 && navIdx < dirs.length) {
        const e = dirs[navIdx++]
        const fp = `${currentFolder}/${e.name}`
        if (getCachedDir(fp)) continue  // bereits im Cache, Slot nicht blockieren
        navRunning++
        fetchDir(fp).finally(() => { navRunning--; nextNav() })
      }
    }
    nextNav()

    // Track 2: Dateiauswahl-Cache — fetchCloudFolder (list-recursive) pro Unterordner.
    const pending = dirs
      .map(e => `${currentFolder}/${e.name}`)
      .filter(fp => !completedCloudFolders.has(fp) && !prefetchingFolders.current.has(fp))
    if (pending.length === 0) return

    let running = 0, idx = 0
    function next() {
      while (running < 3 && idx < pending.length) {
        const fp = pending[idx++]
        prefetchingFolders.current.add(fp)
        running++
        fetchCloudFolder(fp)
          .then(audioFiles => { seedCloudDirCache(fp, audioFiles) })
          .finally(() => { prefetchingFolders.current.delete(fp); running--; next() })
      }
    }
    next()
  }, [currentFolder, dirEntries, isCloud]) // eslint-disable-line react-hooks/exhaustive-deps

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

    const prefix = currentFolder ? currentFolder + '/' : ''

    // Virtuellen "Cloud"-Ordner am Root injizieren; lokalen Ordner gleichen Namens ausblenden (verhindert Duplikat + Stale-Cache-Bug)
    const hiddenFolders = settings.hiddenCloudFolders ?? []
    const effectiveDirEntries = (path.length === 0 && webdavConfigured)
      ? [{ name: cloudFolder, is_dir: true, size: 0, mod_time: '' }, ...dirEntries.filter(e => e.name !== cloudFolder)]
      : (isCloud && path.length === 1 && hiddenFolders.length > 0)
        ? dirEntries.filter(e => !hiddenFolders.includes(e.name))
        : dirEntries

    const filesByPath = new Map<string, AudioFile>()
    const folderFilesMap = new Map<string, AudioFile[]>()
    const scopeFiles: AudioFile[] = []

    if (isCloud) {
      // Cloud-Ordner: scopeFiles + filesByPath aus sichtbaren dirEntries aufbauen.
      // folderFilesMap aus Explorer-Cache befüllen (verfügbar nach erstem Besuch des Unterordners).
      for (const e of dirEntries) {
        const rel = prefix + e.name
        if (e.is_dir) {
          // cloudFolderFiles hat Vorrang (befüllt nach rekursivem Select), dann Explorer-Cache.
          const cf = cloudFolderFiles.get(rel)
          if (cf && cf.length > 0) {
            folderFilesMap.set(e.name, cf)
          } else {
            const cached = getCachedDir(rel)
            if (cached) {
              const files = cached
                .filter(c => !c.is_dir)
                .map(c => ({ path: rel + '/' + c.name, title: c.name, date: '', folder: rel, artist: '', album: '', size: c.size, mtime: 0 }) as AudioFile)
              if (files.length > 0) folderFilesMap.set(e.name, files)
            }
          }
        } else {
          const synth: AudioFile = { path: rel, title: e.name, date: '', folder: currentFolder, artist: '', album: '', size: e.size, mtime: 0 }
          filesByPath.set(rel, synth)
          scopeFiles.push(synth)
        }
      }
      // Unterordner-Dateien aus folderFilesMap in scopeFiles übernehmen,
      // damit Header-Checkbox allScopeSelected / someScopeSelected korrekt berechnet.
      // Direkte Dateien und Unterordner-Dateien haben nie denselben Pfad → kein Dedup nötig.
      folderFilesMap.forEach(files => { for (const f of files) scopeFiles.push(f) })
    } else {
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
    }

    const filtered = effectiveDirEntries
    const mul = sort.dir === 'asc' ? 1 : -1
    const rows: Row[] = [
      ...filtered.filter(e => e.is_dir)
        .sort((a, b) => {
          if (a.name === cloudFolder) return -1
          if (b.name === cloudFolder) return 1
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
  }, [dirEntries, allFiles, currentFolder, path, sort, cloudFolderFiles, cloudFolder, webdavConfigured, isCloud, settings.hiddenCloudFolders])

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

  // Header-Checkbox: ✓ nur wenn der aktuelle Ordner vollständig bekannt ist (direkt via list-recursive).
  // Elternordner mit Merge-Teildaten zeigen – (someScopeSelected), bis sie selbst geladen werden.
  // Ausnahme: Cloud-Root zeigt kein – (fetch wäre zu teuer für den gesamten WebDAV-Baum).
  const isCurrentCloudComplete = !isCloud || completedCloudFolders.has(currentFolder)
  const isCloudRoot = currentFolder === cloudFolder
  const allScopeSelected = scopeFiles.length > 0 && isCurrentCloudComplete && scopeFiles.every(f => selectedFiles.has(f.path))
  const someScopeSelected = scopeFiles.some(f => selectedFiles.has(f.path))

  const rowHeight = isMobile ? 48 : 36

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    initialRect: { width: 0, height: 800 },
  })

  // Zu markiertem Eintrag scrollen sobald rows + virtualizer bereit sind
  useEffect(() => {
    if (!highlightedPath) return
    const idx = rows.findIndex(r => r.type === 'file' && r.file.path === highlightedPath)
    if (idx !== -1) virtualizer.scrollToIndex(idx, { align: 'center' })
  }, [rows, highlightedPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // Aktuell abgespielte Datei auf Mobil sichtbar halten wenn Track wechselt
  useEffect(() => {
    if (!currentTrackPath) return
    const idx = rows.findIndex(r => r.type === 'file' && r.file.path === currentTrackPath)
    if (idx === -1) return
    // rAF wartet auf Layout-Reflow (Playerbar erscheint → main schrumpft)
    const raf = requestAnimationFrame(() => {
      const container = parentRef.current
      if (!container) return
      const itemTop = idx * rowHeight
      const itemBottom = itemTop + rowHeight
      const { scrollTop, clientHeight } = container
      // Bereits vollständig sichtbar → kein Scroll
      if (itemTop >= scrollTop && itemBottom <= scrollTop + clientHeight) return
      // Unterhalb des sichtbaren Bereichs → ans Ende scrollen (knapp über Playerbar)
      if (itemBottom > scrollTop + clientHeight) {
        virtualizer.scrollToIndex(idx, { align: 'end' })
      } else {
        // Oberhalb → nach oben scrollen
        virtualizer.scrollToIndex(idx, { align: 'start' })
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [currentTrackPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // Highlight nach 2,5 s automatisch entfernen
  useEffect(() => {
    if (!highlightedPath) return
    const t = setTimeout(() => setHighlightedPath(null), 2500)
    return () => clearTimeout(t)
  }, [highlightedPath])

  // Type-Ahead: Tippen ohne Fokus auf einem Eingabefeld springt zum passenden Eintrag im aktuellen Ordner.
  // ESC bricht ab. Greift nicht während globaler Suche oder offenem Datei-Viewer.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const virtualizerRef = useRef(virtualizer)
  virtualizerRef.current = virtualizer

  useEffect(() => {
    if (isMobile || isSearching || viewerFile) return
    function handler(e: KeyboardEvent) {
      const active = document.activeElement as HTMLElement | null
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === 'Escape') {
        if (typeaheadQuery) { setTypeaheadQuery(''); setTypeaheadIndex(null) }
        return
      }
      if (e.key.length !== 1) return

      const currentRows = rowsRef.current
      const label = (r: Row) => r.type === 'dir' ? r.name : (r.file.title || r.file.path.split('/').pop() || '')

      const next = (typeaheadQuery + e.key).toLowerCase()
      let idx = currentRows.findIndex(r => label(r).toLowerCase().startsWith(next))
      if (idx === -1) idx = currentRows.findIndex(r => label(r).toLowerCase().includes(next))

      // Kein Treffer für die erweiterte Eingabe → Tastendruck ignorieren, bisherige Markierung bleibt stehen.
      if (idx === -1) return

      e.preventDefault()
      setTypeaheadQuery(next)
      setTypeaheadIndex(idx)
      virtualizerRef.current.scrollToIndex(idx, { align: 'center' })

      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current)
      typeaheadTimer.current = setTimeout(() => { setTypeaheadQuery(''); setTypeaheadIndex(null) }, 3000)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isMobile, isSearching, viewerFile, typeaheadQuery])

  // Ordner gewechselt → Type-Ahead-Status zurücksetzen
  useEffect(() => {
    setTypeaheadQuery('')
    setTypeaheadIndex(null)
  }, [currentFolder])

  function toggleSort(by: SortBy) {
    const next = sort.by === by ? { by, dir: sort.dir === 'asc' ? 'desc' as const : 'asc' as const } : { by, dir: 'asc' as const }
    if (role === 'admin') {
      updateSettings({ folderSort: { ...settings.folderSort, [currentFolder]: next } })
    } else {
      setLocalFolderSort(prev => ({ ...prev, [currentFolder]: next }))
    }
  }

  function startRename(name: string) {
    if (role !== 'admin') return
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

  // Lädt rekursiv alle Dateien eines Cloud-Ordners und befüllt cloudFolderFiles /
  // completedCloudFolders — ohne Auswahl. Wird von selectCloudFolder und dem Prefetch genutzt.
  async function fetchCloudFolder(folderPath: string): Promise<AudioFile[]> {
    try {
      const res = await fetch(`/api/list-recursive?path=${encodeURIComponent(folderPath)}`)
      if (!res.ok) return []
      const data: { path: string; name: string; size: number; mod_time: string }[] = await res.json()
      // date bewusst leer: WebDAV-Änderungsdaten sind pro Datei individuell und würden
      // Dateien desselben Ordners in verschiedene Sidebar-Gruppen splitten.
      // folder = direkter Elternordner jeder Datei → groupKey(f) = f.folder
      // → eine Gruppe pro Unterordner, unabhängig davon welcher Ordner geklickt wurde.
      const audioFiles = data.map(e => {
        const parts = e.path.split('/')
        const immediateParent = parts.slice(0, -1).join('/')
        return { path: e.path, title: e.name, date: '', folder: immediateParent, artist: '', album: '', size: e.size, mtime: 0 } as AudioFile
      })
      // Für jede Datei alle Vorfahren von Cloud bis zum direkten Elternordner befüllen,
      // damit Checkboxen auf jeder Navigationsebene (inkl. Elternordner) korrekt angezeigt werden.
      const byFolder = new Map<string, AudioFile[]>()
      audioFiles.forEach(f => {
        const parts = f.path.split('/')
        // parts[0] = "Cloud" (überspringen) → i ab 1
        for (let i = 1; i < parts.length - 1; i++) {
          const key = parts.slice(0, i + 1).join('/')
          const bucket = byFolder.get(key)
          if (bucket) bucket.push(f)
          else byFolder.set(key, [f])
        }
      })
      // Merge statt Replace: vollständige Einträge (direkt geklickte Ordner) bleiben erhalten
      setCloudFolderFiles(prev => {
        const m = new Map(prev)
        byFolder.forEach((newFiles, key) => {
          const existing = m.get(key)
          if (existing) {
            const known = new Set(existing.map(f => f.path))
            m.set(key, [...existing, ...newFiles.filter(f => !known.has(f.path))])
          } else {
            m.set(key, newFiles)
          }
        })
        return m
      })
      // folderPath selbst + alle Unterordner als vollständig markieren.
      // Das rekursive Fetch enthält deren vollständige Dateiliste.
      // Elternordner NICHT markieren – sie haben ggf. noch unbekannte Geschwisterordner.
      setCompletedCloudFolders(prev => {
        const s = new Set(prev)
        s.add(folderPath)
        byFolder.forEach((_, key) => {
          if (key.startsWith(folderPath + '/')) s.add(key)
        })
        return s
      })
      return audioFiles
    } catch {
      return []
    }
  }

  async function selectCloudFolder(folderPath: string) {
    setLoadingFolders(prev => { const s = new Set(prev); s.add(folderPath); return s })
    try {
      const audioFiles = await fetchCloudFolder(folderPath)
      // addFiles liest aktuellen Store-State via set(s=>) — kein Closure-Snapshot-Problem
      // (toggleFile würde optimistisch vorausgewählte Dateien wieder abwählen)
      addFiles(audioFiles)
    } finally {
      setLoadingFolders(prev => { const s = new Set(prev); s.delete(folderPath); return s })
    }
  }

  const COL_MINS: Record<string, number> = { name: 80, date: 155, size: 60 }

  function handleColResize(col: string, delta: number) {
    setColWidths(prev => {
      const min = COL_MINS[col] ?? 60
      const containerW = parentRef.current?.clientWidth ?? Infinity
      const nameW  = prev['name'] ?? nameColWidth ?? 120
      const dateW  = prev['date'] ?? 155
      const sizeW  = prev['size'] ?? 80
      const fixed  = 32 + sizeW // checkbox + size
      const max = col === 'name'
        ? containerW - fixed - dateW
        : col === 'date'
          ? containerW - fixed - nameW
          : Infinity
      const currentW = col === 'name' ? nameW : col === 'date' ? dateW : sizeW
      const next = { ...prev, [col]: Math.max(min, Math.min(max, currentW + delta)) }
      saveColWidths(next)
      return next
    })
  }

  const colW = (col: string, def: number) => colWidths[col] ?? def

  return (
    <div className="flex flex-col h-full relative">
      {/* Breadcrumb + Suche */}
      <div className="flex items-center gap-2 px-4 py-2 z-10 relative shrink-0 bg-gray-50">
        {isMobile ? (
          /* Mobile: Zurück-Pfeil + aktueller Ordnername */
          <div className="flex-1 min-w-0 flex items-center gap-2 border border-gray-200 rounded-full bg-white px-2 h-10">
            <button
              onClick={() => pushPath([])}
              className="p-2 rounded-full hover:bg-gray-100 text-gray-500 hover:text-[var(--accent)] transition-colors shrink-0"
            >
              <Home size={19}/>
            </button>
            <button
              onClick={() => path.length > 0 ? pushPath(path.slice(0, -1)) : undefined}
              disabled={path.length === 0}
              className="p-2 rounded-full hover:bg-gray-100 disabled:opacity-30 text-gray-500 hover:text-[var(--accent)] transition-colors shrink-0"
            >
              <ArrowLeft size={19}/>
            </button>
            <span className="flex-1 text-sm font-semibold text-gray-900 truncate">
              {path.length === 0 ? '' : (isCloud && path[path.length - 1] === cloudFolder ? '☁ ' : '') + path[path.length - 1]}
            </span>
            {navigating && (
              <div className="w-4 h-4 border-2 border-gray-200 rounded-full animate-spin shrink-0 mr-1" style={{ borderTopColor: 'var(--accent)' }} />
            )}
          </div>
        ) : (
          /* Desktop: volle Breadcrumb */
          <div className="flex-1 min-w-0 flex items-center overflow-hidden border border-gray-200 rounded-full bg-white px-2 h-9">
            <button onClick={goBack} disabled={histIdx === 0 || path.length === 0} className="p-1.5 rounded-full hover:bg-gray-100 disabled:opacity-30 text-gray-500 hover:text-[var(--accent)] transition-colors shrink-0">
              <ArrowLeft size={17}/>
            </button>
            <button onClick={goForward} disabled={histIdx >= history.length - 1} className="p-1.5 rounded-full hover:bg-gray-100 disabled:opacity-30 text-gray-500 hover:text-[var(--accent)] transition-colors shrink-0">
              <ArrowRight size={17}/>
            </button>
            <button onClick={() => pushPath([])} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500 hover:text-[var(--accent)] transition-colors shrink-0">
              <Home size={17}/>
            </button>
            {path.map((seg, i) => (
              <span key={i} className="flex items-center gap-0.5 shrink-0">
                <ChevronRight size={14} className="text-gray-300"/>
                <button
                  onClick={() => pushPath(path.slice(0, i + 1))}
                  className={`px-1.5 py-0.5 rounded-full text-sm font-semibold transition-colors
                    ${i === path.length - 1 ? 'text-gray-900' : 'text-gray-400 hover:text-gray-900'}`}
                >
                  {(seg === cloudFolder && isCloud) ? '☁ ' + seg : seg}
                </button>
              </span>
            ))}
            {navigating && (
              <div className="w-3.5 h-3.5 border-2 border-gray-200 rounded-full animate-spin shrink-0 ml-1" style={{ borderTopColor: 'var(--accent)' }} />
            )}
          </div>
        )}
        {/* Suchfeld — Ergebnisse ersetzen ab 2 Zeichen die Ordneransicht unten */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { setSearch(''); searchRef.current?.blur() }
            }}
            placeholder={isMobile ? 'Suchen…' : 'Suchen… (Strg+F)'}
            className={`border border-gray-200 rounded-full pl-7 pr-7 text-sm h-9 focus:outline-none focus:ring-2 focus:border-transparent bg-white ${isMobile ? 'w-32' : 'w-52'}`}
            style={{ '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
          />
          {search && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              onMouseDown={e => { e.preventDefault(); setSearch('') }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {isSearching ? (
      <>
      {/* Suchergebnisse — ersetzt die Ordneransicht, statt in einem Dropdown zu schweben */}
      <div className="flex items-center justify-between border-b border-gray-100 bg-white shrink-0 px-4 py-2 text-sm">
        <span className="font-semibold text-gray-700">
          {globalResults.length} Treffer für „{search}“
        </span>
        <button onClick={() => setSearch('')} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
          Suche schließen ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden bg-white">
        {globalResults.length === 0 && (
          <div className="flex items-center justify-center h-24 text-sm text-gray-400">
            Keine Treffer für „{search}“
          </div>
        )}
        {globalResults.map(gf => {
          const gft = getFileType(gf.path.split('/').pop() || '')
          const GIcon = gft === 'image' ? Image : gft === 'pdf' ? FileText : gft === 'audio' ? Music : gft === 'text' ? AlignLeft : File
          const gColor = gft === 'audio' ? 'text-purple-400' : gft === 'image' ? 'text-green-500' : gft === 'pdf' ? 'text-red-500' : gft === 'text' ? 'text-sky-400' : 'text-gray-400'
          const folderParts = gf.path.split('/').slice(0, -1)
          return (
            <div
              key={gf.path}
              className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
              onClick={() => {
                setSearch('')
                setHighlightedPath(gf.path)
                pushPath(folderParts)
              }}
            >
              <GIcon size={16} className={`shrink-0 ${gColor}`} />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-900 truncate">
                  <Highlight text={gf.title || gf.path.split('/').pop() || ''} query={search} />
                </div>
                <div className="text-[11px] text-gray-400 truncate">{folderParts.join(' › ')}</div>
              </div>
              <div className="text-xs text-gray-400 shrink-0">{fmtBytes(gf.size)}</div>
            </div>
          )
        })}
      </div>
      </>
      ) : (
      <>
      {/* Tabellen-Header */}
      <div className="flex items-center border-b border-gray-100 bg-white shrink-0 text-sm font-semibold text-gray-500 tracking-wide select-none">
        <label className={`${isMobile ? 'hidden' : 'w-8'} flex items-center justify-center cursor-pointer`}>
          <input type="checkbox" checked={allScopeSelected} onChange={() => {
            if (allScopeSelected || (isCloudRoot && someScopeSelected)) {
              // ✓ oder – am Cloud-Root → alles deselektieren (kein Fetch am Root)
              scopeFiles.forEach(f => { if (selectedFiles.has(f.path)) toggleFile(f.path, f) })
            } else if (isCloud && !isCurrentCloudComplete && !isCloudRoot) {
              // Optimistisch: bereits bekannte Dateien sofort auswählen
              addFiles(scopeFiles)
              // Dann vollständig laden + neue Dateien hinzufügen
              selectCloudFolder(currentFolder)
            } else {
              // – oder leer (lokal / vollständig) → alle auswählen
              scopeFiles.forEach(f => { if (!selectedFiles.has(f.path)) toggleFile(f.path, f) })
            }
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
          {!isMobile && (
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
          )}
        </div>
        {!isMobile && (
          <>
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
          </>
        )}
        <div className="flex-1" />
      </div>

      {/* Virtualisierte Liste — oder Skeleton beim ersten Laden */}
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto overflow-x-hidden bg-white"
        style={{ touchAction: 'pan-y', overscrollBehavior: 'none' }}
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
        {/* Cloud-Verbindungsfehler */}
        {cloudError && (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-sm select-none">
            <Cloud size={32} className="text-gray-300" />
            <span className="text-gray-500">{cloudError}</span>
            <button
              className="text-xs px-3 py-1.5 rounded-md text-white transition-colors hover:opacity-90"
              style={{ background: 'var(--accent)' }}
              onClick={() => { setCloudError(null); navigate(path) }}
            >
              Neu verbinden
            </button>
          </div>
        )}

        {/* Leerer Ordner */}
        {!cloudError && dirEntries !== null && rows.length === 0 && (
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
          className={didNavigate.current && settings.calAnimation !== 'none' ? `cal-anim-${settings.calAnimation}` : ''}
          style={{ '--cal-dur': { slow: '0.6s', normal: '0.3s', fast: '0.15s' }[settings.calAnimSpeed] ?? '0.3s' } as React.CSSProperties}
        >
        <div style={{ height: virtualizer.getTotalSize() + 'px', position: 'relative' }}>
          {virtualizer.getVirtualItems().map(vi => {
            const row = rows[vi.index]
            if (!row) return null
            const isTypeaheadMatch = typeaheadIndex === vi.index

            if (row.type === 'dir') {
              const folderFiles = folderFilesMap.get(row.name) ?? []
              const folderSize = folderFiles.reduce((s, f) => s + f.size, 0)
              const folderPath = currentFolder ? `${currentFolder}/${row.name}` : row.name
              const isLoading = loadingFolders.has(folderPath)
              // Cloud-Ordner zeigt ✓ nur wenn vollständig geladen (direkt via list-recursive).
              // Elternordner mit Merge-Teildaten: allSel=false → zeigt – (someSel), nicht ✓.
              const isCloudComplete = !isCloud || completedCloudFolders.has(folderPath)
              const allSel = folderFiles.length > 0 && isCloudComplete && folderFiles.every(f => selectedFiles.has(f.path))
              const someSel = folderFiles.some(f => selectedFiles.has(f.path))
              return (
                <div
                  key={vi.key}
                  style={{
                    position: 'absolute', top: vi.start + 'px', width: '100%', height: vi.size + 'px',
                    boxShadow: isTypeaheadMatch ? 'inset 0 0 0 2px var(--accent)' : undefined,
                  }}
                  className="flex items-center border-b border-gray-100 hover:bg-gray-100 cursor-pointer select-none"
                  onClick={() => pushPath([...path, row.name])}
                >
                  <label className={`${isMobile ? 'hidden' : 'w-8'} h-full flex items-center justify-center cursor-pointer`} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={allSel} onChange={() => {
                      if (allSel) {
                        // ✓ → alles deselektieren
                        folderFiles.forEach(f => { if (selectedFiles.has(f.path)) toggleFile(f.path, f) })
                      } else if (isCloud && !isCloudComplete) {
                        // Optimistisch: bereits bekannte Dateien sofort auswählen
                        addFiles(folderFiles)
                        // Dann vollständig laden + neue Dateien hinzufügen
                        selectCloudFolder(folderPath)
                      } else {
                        // – oder leer (lokal / vollständig geladener Cloud-Ordner) → restliche auswählen
                        folderFiles.forEach(f => { if (!selectedFiles.has(f.path)) toggleFile(f.path, f) })
                      }
                    }} className="sr-only"/>
                    {isLoading
                      ? <span className={`${isMobile ? 'w-5 h-5 rounded' : 'w-[15px] h-[15px] rounded-sm'} border border-gray-200 bg-gray-100 animate-pulse shrink-0`} />
                      : <span className={`${isMobile ? 'w-5 h-5 rounded' : 'w-[15px] h-[15px] rounded-sm'} border flex items-center justify-center shrink-0 ${allSel ? 'bg-[var(--accent)] border-[var(--accent)]' : someSel ? 'bg-white border-[var(--accent)]' : 'bg-white border-gray-300'}`}>
                          {allSel && <Check size={isMobile ? 13 : 10} className="text-white" strokeWidth={3}/>}
                          {someSel && !allSel && <Minus size={isMobile ? 13 : 10} style={{ color: 'var(--accent)' }} strokeWidth={3}/>}
                        </span>
                    }
                  </label>
                  <div
                    style={colWidths['name'] ?? nameColWidth ? { width: colWidths['name'] ?? nameColWidth } : undefined}
                    className={`${colWidths['name'] ?? nameColWidth ? 'shrink-0' : 'flex-1'} px-2 text-sm flex items-center gap-2 min-w-0`}
                  >
                    {(isCloud || (row.name === cloudFolder && webdavConfigured))
                      ? <Cloud size={isMobile ? 18 : 15} className="shrink-0 text-blue-400"/>
                      : <Folder size={isMobile ? 18 : 15} className="shrink-0 text-yellow-400"/>}
                    <span className="text-gray-900 truncate"><Highlight text={row.name} query={isTypeaheadMatch ? typeaheadQuery : search} /></span>
                  </div>
                  {!isMobile && (
                    <>
                      <div style={{ width: colW('date', 155) }} className="px-2 text-sm text-gray-600 shrink-0">{row.modTime ? formatDate(row.modTime.slice(0, 10)) : ''}</div>
                      <div style={{ width: colW('size', 80) }} className={`px-2 text-sm shrink-0 ${folderSize > 0 ? 'text-gray-600' : 'text-gray-300'}`}>
                        {folderSize > 0 ? fmtBytes(folderSize) : '–'}
                      </div>
                      <div className="flex-1" />
                    </>
                  )}
                </div>
              )
            }

            const { file } = row
            const sel = selectedFiles.has(file.path)
            const isPlaying = file.path === currentTrackPath
            const ft = getFileType(file.path.split('/').pop() || file.title || '')
            const FileIcon = ft === 'image' ? Image : ft === 'pdf' ? FileText : ft === 'audio' ? Music : ft === 'text' ? AlignLeft : File
            const fileIconColor = ft === 'audio' ? 'text-purple-400' : ft === 'image' ? 'text-green-500' : ft === 'pdf' ? 'text-red-500' : ft === 'text' ? 'text-sky-400' : 'text-gray-400'
            const isViewable = ft !== 'other'

            function handleFileClick() {
              if (!isViewable) return
              if (ft === 'audio') {
                const folderAudioTracks = rows
                  .filter(r => r.type === 'file' && getFileType(r.file.path.split('/').pop() || r.file.title || '') === 'audio')
                  .map(r => ({ path: (r as { type: 'file'; file: AudioFile }).file.path, name: (r as { type: 'file'; file: AudioFile }).file.title || (r as { type: 'file'; file: AudioFile }).file.path.split('/').pop() || '' }))
                playTrack({ path: file.path, name: file.title || file.path.split('/').pop() || '' }, folderAudioTracks)
              } else {
                setViewerFile({ path: file.path, name: file.title || file.path.split('/').pop() || '', type: ft as 'audio' | 'image' | 'pdf' | 'text' })
              }
            }

            return (
              <div
                key={vi.key}
                style={{
                  position: 'absolute', top: vi.start + 'px', width: '100%', height: vi.size + 'px',
                  background: isPlaying ? 'var(--accent-l)' : sel ? 'var(--accent-xl)' : undefined,
                  borderLeft: isPlaying ? '3px solid var(--accent)' : undefined,
                  boxShadow: isTypeaheadMatch ? 'inset 0 0 0 2px var(--accent)' : undefined,
                }}
                className={`flex items-center border-b border-gray-100 hover:bg-gray-100 select-none ${isViewable ? 'cursor-pointer' : ''}`}
                onClick={isViewable ? handleFileClick : undefined}
                onKeyDown={e => {
                  if (e.key === 'F2') { startRename(file.path.split('/').pop() ?? '') }
                }}
              >
                <label className={`${isMobile ? 'hidden' : 'w-8'} h-full flex items-center justify-center cursor-pointer`} onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={sel} onChange={() => {
                    toggleFile(file.path, file)
                    // Cloud: Geschwisterdateien in selectedFilesMeta registrieren (ohne selektieren),
                    // damit die komplette Gruppe in der Sidebar erscheint (wie lokales Verhalten).
                    if (isCloud) {
                      scopeFiles.forEach(f => { if (f.folder === file.folder) registerFileMeta(f) })
                    }
                  }} className="sr-only"/>
                  <span className={`${isMobile ? 'w-5 h-5 rounded' : 'w-[15px] h-[15px] rounded-sm'} border flex items-center justify-center shrink-0 ${sel ? 'bg-[var(--accent)] border-[var(--accent)]' : 'bg-white border-gray-300'}`}>
                    {sel && <Check size={isMobile ? 13 : 10} className="text-white" strokeWidth={3}/>}
                  </span>
                </label>
                <div
                  style={colWidths['name'] ?? nameColWidth ? { width: colWidths['name'] ?? nameColWidth } : undefined}
                  className={`${colWidths['name'] ?? nameColWidth ? 'shrink-0' : 'flex-1'} px-2 text-sm truncate flex items-center gap-2 min-w-0`}
                >
                  <FileIcon size={isMobile ? 18 : 15} className={`shrink-0 ${isPlaying ? '' : fileIconColor}`} style={isPlaying ? { color: 'var(--accent)' } : undefined}/>
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
                    <span className={`truncate ${isPlaying ? 'font-semibold' : ''}`} style={isPlaying ? { color: 'var(--accent)' } : undefined}><Highlight text={file.title || file.path.split('/').pop() || ''} query={isTypeaheadMatch ? typeaheadQuery : search} /></span>
                  )}
                </div>
                {!isMobile && (
                  <>
                    <div style={{ width: colW('date', 155) }} className="px-2 text-sm text-gray-600 shrink-0">
                      {formatDate(file.date)}
                    </div>
                    <div style={{ width: colW('size', 80) }} className="px-2 text-sm text-gray-600 shrink-0">
                      {fmtBytes(file.size)}
                    </div>
                    <div className="flex-1" />
                  </>
                )}
              </div>
            )
          })}
        </div>
        </div>
      </div>
      </>
      )}

      {/* Rubber-Band — ausgeklammert */}

      {/* Datei-Viewer (Audio / Bild / PDF) */}
      {viewerFile && (
        <FileViewer
          path={viewerFile.path}
          name={viewerFile.name}
          type={viewerFile.type as 'audio' | 'image' | 'pdf' | 'text'}
          onClose={() => setViewerFile(null)}
        />
      )}

    </div>
  )
}
