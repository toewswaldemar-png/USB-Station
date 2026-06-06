import { create } from 'zustand'
import type { AudioFile } from '@/types'
import { groupKey } from '@/lib/groupKey'
import { idbGet, idbSet } from '@/lib/idb'

interface FilesState {
  allFiles: AudioFile[]
  filesByYearMonth: Map<string, Map<string, AudioFile[]>>
  loading: boolean
  loadFiles: () => Promise<void>
  refreshFiles: () => Promise<void>
}

function buildIndex(files: AudioFile[] | null | undefined): Map<string, Map<string, AudioFile[]>> {
  if (!files) return new Map();
  const byYM = new Map<string, Map<string, AudioFile[]>>()
  for (const f of files) {
    const [year = '', month = ''] = (f.date || '').split('-')
    const ym = year && month ? `${year}-${month}` : ''
    const key = groupKey(f)
    if (!byYM.has(ym)) byYM.set(ym, new Map())
    const byGroup = byYM.get(ym)!
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key)!.push(f)
  }
  return byYM
}

export const useFilesStore = create<FilesState>((set, get) => ({
  allFiles: [],
  filesByYearMonth: new Map(),
  loading: false,

  async loadFiles() {
    set({ loading: true })
    try {
      // Schritt 1: IDB-Cache laden
      const cached = await idbGet<{ version: number; files: AudioFile[] }>('files_cache')
      if (cached?.files?.length) {
        set({ allFiles: cached.files, filesByYearMonth: buildIndex(cached.files) })
      }

      // Schritt 2: Versionscheck
      const vRes = await fetch('/api/version', { cache: 'no-store' })
      const { version } = await vRes.json() as { version: number }

      if (cached?.files?.length && cached.version === version) {
        set({ loading: false })
        return
      }

      // Schritt 3: Voll-Fetch
      await get().refreshFiles()
    } catch {
      set({ loading: false })
    }
  },

  async refreshFiles() {
    try {
      const res = await fetch('/api/files', { cache: 'no-store' })
      const files = (await res.json() as AudioFile[] | null) ?? []
      const vRes = await fetch('/api/version', { cache: 'no-store' })
      const { version } = await vRes.json() as { version: number }

      // Store zuerst aktualisieren – IDB-Fehler dürfen das nicht blockieren
      set({ allFiles: files, filesByYearMonth: buildIndex(files), loading: false })
      if (files.length > 0) {
        idbSet('files_cache', { version, files }).catch(() => {})
      }
    } catch {
      set({ loading: false })
    }
  },
}))
