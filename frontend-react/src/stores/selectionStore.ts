import { create } from 'zustand'
import type { AudioFile } from '@/types'
import { groupKey } from '@/lib/groupKey'

interface SelectionState {
  selectedFiles: Set<string>              // Pfade
  selectedFilesMeta: Map<string, AudioFile> // Pfad → AudioFile (für Cloud-Dateien nicht in allFiles)
  groupFilters: Map<string, Set<string>>  // groupKey → erlaubte Pfade
  effectivePaths: () => string[]
  toggleFile: (path: string, file: AudioFile) => void
  addFiles: (files: AudioFile[]) => void  // Bulk-Add ohne Toggle-Gefahr; liest immer aktuellen State
  toggleGroup: (files: AudioFile[]) => void
  removeGroup: (key: string) => void
  clearAll: () => void
  setGroupFilter: (key: string, paths: Set<string>) => void
  clearGroupFilter: (key: string) => void
  registerFileMeta: (file: AudioFile) => void  // Metadaten speichern ohne zu selektieren
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedFiles: new Set(),
  selectedFilesMeta: new Map(),
  groupFilters: new Map(),

  effectivePaths() {
    const { selectedFiles, groupFilters } = get()
    if (groupFilters.size === 0) return [...selectedFiles]
    return [...selectedFiles].filter(p => {
      for (const [, allowed] of groupFilters) {
        if (!allowed.has(p)) return false
      }
      return true
    })
  },

  addFiles(files) {
    set(s => {
      const next = new Set(s.selectedFiles)
      const meta = new Map(s.selectedFilesMeta)
      for (const file of files) {
        next.add(file.path)
        meta.set(file.path, file)
      }
      return { selectedFiles: next, selectedFilesMeta: meta }
    })
  },

  toggleFile(path, file) {
    set(s => {
      const next = new Set(s.selectedFiles)
      const meta = new Map(s.selectedFilesMeta)
      if (next.has(path)) {
        next.delete(path)
        // meta bewusst NICHT löschen: Metadaten bleiben als Cache erhalten,
        // damit deselektierte Cloud-Dateien in der Sidebar sichtbar bleiben (wie lokal).
        // Bereinigung erfolgt nur bei clearAll().
      } else {
        next.add(path)
        meta.set(path, file)
      }
      // Gruppen-Filter für diese Gruppe entfernen falls vorhanden
      const key = groupKey(file)
      const filters = new Map(s.groupFilters)
      filters.delete(key)
      return { selectedFiles: next, selectedFilesMeta: meta, groupFilters: filters }
    })
  },

  toggleGroup(files) {
    set(s => {
      const paths = files.map(f => f.path)
      const next = new Set(s.selectedFiles)
      const allSelected = paths.every(p => next.has(p))
      if (allSelected) {
        paths.forEach(p => next.delete(p))
      } else {
        paths.forEach(p => next.add(p))
      }
      return { selectedFiles: next }
    })
  },

  removeGroup(key) {
    set(s => {
      const next = new Set(s.selectedFiles)
      for (const p of next) {
        // Pfade die zu dieser Gruppe gehören entfernen
        if (p.startsWith(key.split(' ').slice(1).join(' '))) next.delete(p)
      }
      const filters = new Map(s.groupFilters)
      filters.delete(key)
      return { selectedFiles: next, groupFilters: filters }
    })
  },

  clearAll() {
    set({ selectedFiles: new Set(), selectedFilesMeta: new Map(), groupFilters: new Map() })
  },

  setGroupFilter(key, paths) {
    set(s => {
      const filters = new Map(s.groupFilters)
      filters.set(key, paths)
      return { groupFilters: filters }
    })
  },

  clearGroupFilter(key) {
    set(s => {
      const filters = new Map(s.groupFilters)
      filters.delete(key)
      return { groupFilters: filters }
    })
  },

  registerFileMeta(file) {
    set(s => {
      if (s.selectedFilesMeta.has(file.path)) return s  // bereits bekannt
      return { selectedFilesMeta: new Map(s.selectedFilesMeta).set(file.path, file) }
    })
  },
}))
