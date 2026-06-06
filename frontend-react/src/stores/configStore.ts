import { create } from 'zustand'

export interface AppConfig {
  audio_path: string
  settings_password: string
  webdav_url: string
  webdav_user: string
  webdav_password: string
}

interface ConfigState {
  config: AppConfig
  loaded: boolean
  load: () => Promise<void>
  save: (c: Partial<AppConfig>) => Promise<void>
}

const defaults: AppConfig = {
  audio_path: '',
  settings_password: '',
  webdav_url: '',
  webdav_user: '',
  webdav_password: '',
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: defaults,
  loaded: false,

  async load() {
    const res = await fetch('/api/config')
    const c = await res.json() as AppConfig
    set({ config: c, loaded: true })
  },

  async save(partial) {
    const next = { ...get().config, ...partial }
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
    set({ config: next })
  },
}))
