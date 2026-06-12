import { create } from 'zustand'

type Role = 'admin' | 'cloud'

interface UserState {
  role: Role
  load: () => Promise<void>
}

export const useUserStore = create<UserState>(set => ({
  role: 'admin',

  async load() {
    try {
      const res = await fetch('/api/me')
      if (res.ok) {
        const data = await res.json()
        if (data.role === 'cloud') set({ role: 'cloud' })
      }
    } catch { /* lokal ohne Server → admin */ }
  },
}))
