import { create } from 'zustand'

export interface AppConfig {
  app_name: string
  app_subtitle: string
  audio_path: string
  settings_password: string
  webdav_url: string
  webdav_user: string
  webdav_password: string
  webdav_folder: string
}

interface ConfigState {
  config: AppConfig
  loaded: boolean
  load: () => Promise<void>
  save: (c: Partial<AppConfig>) => Promise<void>
}

const defaults: AppConfig = {
  app_name: '',
  app_subtitle: '',
  audio_path: '',
  settings_password: '',
  webdav_url: '',
  webdav_user: '',
  webdav_password: '',
  webdav_folder: '',
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: defaults,
  loaded: false,

  async load() {
    const res = await fetch('/api/config')
    const c = await res.json() as AppConfig
    if (c.app_name) localStorage.setItem('fs_app_name', c.app_name)
    if (c.app_subtitle !== undefined) localStorage.setItem('fs_app_subtitle', c.app_subtitle)
    set({ config: { ...defaults, ...c }, loaded: true })
  },

  async save(partial) {
    const next = { ...get().config, ...partial }
    set({ config: next })
    if (next.app_name !== undefined) localStorage.setItem('fs_app_name', next.app_name)
    localStorage.setItem('fs_app_subtitle', next.app_subtitle ?? '')
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
  },
}))
