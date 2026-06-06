import { create } from 'zustand'

export interface UISettings {
  appName: string
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
}

const DEFAULTS: UISettings = {
  appName: 'FileStation',
  fontFamily: 'system-ui, Segoe UI, sans-serif',
  colorPreset: 0,
  todayStyle: 'ring',
  entrySize: 'md',
  calAnimation: 'sanft',
  calAnimSpeed: 'normal',
  swipeThreshold: 60,
  amPmSplit: true,
  sortBy: 'date',
  sortDir: 'desc',
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

interface UISettingsState {
  settings: UISettings
  loaded: boolean
  load: () => Promise<void>
  update: (partial: Partial<UISettings>) => void
}

export const useUISettingsStore = create<UISettingsState>((set, get) => ({
  settings: DEFAULTS,
  loaded: false,

  async load() {
    try {
      const res = await fetch('/api/ui-settings')
      const raw = await res.json() as Record<string, unknown>
      set({ settings: { ...DEFAULTS, ...raw }, loaded: true })
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
