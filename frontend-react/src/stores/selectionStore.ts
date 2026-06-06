import { create } from 'zustand'
import type { AudioFile } from '@/types'
import { groupKey } from '@/lib/groupKey'

interface SelectionState {
  selectedFiles: Set<string>           // Pfade
  groupFilters: Map<string, Set<string>> // groupKey → erlaubte Pfade
  effectivePaths: () => string[]
  toggleFile: (path: string, file: AudioFile) => void
  toggleGroup: (files: AudioFile[]) => void
  removeGroup: (key: string) => void
  clearAll: () => void
  setGroupFilter: (key: string, paths: Set<string>) => void
  clearGroupFilter: (key: string) => void
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedFiles: new Set(),
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

  toggleFile(path, file) {
    set(s => {
      const next = new Set(s.selectedFiles)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      // Gruppen-Filter für diese Gruppe entfernen falls vorhanden
      const key = groupKey(file)
      const filters = new Map(s.groupFilters)
      filters.delete(key)
      return { selectedFiles: next, groupFilters: filters }
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
    set({ selectedFiles: new Set(), groupFilters: new Map() })
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
}))
