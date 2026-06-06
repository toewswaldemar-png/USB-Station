import { create } from 'zustand'
import type { WebDavItem } from '@/types'

interface WebDavState {
  items: WebDavItem[]
  currentPath: string
  loading: boolean
  error: string
  navigate: (path: string) => Promise<void>
}

export const useWebDavStore = create<WebDavState>((set) => ({
  items: [],
  currentPath: '',
  loading: false,
  error: '',

  async navigate(path) {
    set({ loading: true, error: '' })
    try {
      const res = await fetch(`/api/webdav/list?path=${encodeURIComponent(path)}`)
      if (!res.ok) throw new Error(await res.text())
      const items = await res.json() as WebDavItem[]
      set({ items, currentPath: path, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },
}))
