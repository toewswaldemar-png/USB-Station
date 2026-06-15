import { create } from 'zustand'

export interface UISettings {
  fontFamily: string
  colorPreset: number
  // Kalender
  todayStyle: 'ring' | 'filled' | 'cell'
  entrySize: 'sm' | 'md' | 'lg'
  calAnimation: 'sanft' | 'fade' | 'slide'
  calAnimSpeed: 'slow' | 'normal' | 'fast'
  swipeThreshold: number
  amPmSplit: boolean
  // Explorer
  sortBy: 'name' | 'date'
  sortDir: 'asc' | 'desc'
  hiddenCloudFolders: string[]
  folderSort: Record<string, { by: 'name' | 'date' | 'size'; dir: 'asc' | 'desc' }>
}

const DEFAULTS: UISettings = {
  fontFamily: 'system-ui, Segoe UI, sans-serif',
  colorPreset: 0,
  todayStyle: 'ring',
  entrySize: 'md',
  calAnimation: 'sanft',
  calAnimSpeed: 'normal',
  swipeThreshold: 30,
  amPmSplit: true,
  sortBy: 'date',
  sortDir: 'desc',
  hiddenCloudFolders: [],
  folderSort: {},
}

const CACHE_KEY = 'ui_settings_cache'
function loadCache(): Partial<UISettings> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') } catch { return {} }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

interface UISettingsState {
  settings: UISettings
  loaded: boolean
  load: () => Promise<void>
  update: (partial: Partial<UISettings>) => void
}

export const useUISettingsStore = create<UISettingsState>((set, get) => ({
  settings: { ...DEFAULTS, ...loadCache() },
  loaded: false,

  async load() {
    try {
      const res = await fetch('/api/ui-settings')
      const raw = await res.json() as Record<string, unknown>
      const merged = { ...DEFAULTS, ...raw }
      localStorage.setItem(CACHE_KEY, JSON.stringify(merged))
      set({ settings: merged, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  update(partial) {
    const next = { ...get().settings, ...partial }
    set({ settings: next })

    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      fetch('/api/ui-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
    }, 400)
  },
}))
