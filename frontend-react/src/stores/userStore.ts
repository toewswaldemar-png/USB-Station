import { create } from 'zustand'

type Role = 'admin' | 'user'

interface UserState {
  role: Role
  username: string
  isAuthenticated: boolean
  needsSetup: boolean
  authChecked: boolean
  checkAuth: () => Promise<void>
  logout: () => Promise<void>
  load: () => Promise<void>
}

export const useUserStore = create<UserState>((set, get) => ({
  role: 'admin',
  username: '',
  isAuthenticated: false,
  needsSetup: false,
  authChecked: false,

  async checkAuth() {
    try {
      const res = await fetch('/api/me')
      if (res.ok) {
        const data = await res.json() as { role?: string; username?: string }
        set({
          isAuthenticated: true,
          authChecked: true,
          role: (data.role as Role) || 'admin',
          username: data.username || '',
          needsSetup: false,
        })
      } else {
        const data = await res.json().catch(() => ({})) as Record<string, unknown>
        set({
          isAuthenticated: false,
          authChecked: true,
          needsSetup: data.setup === true,
        })
      }
    } catch {
      // Server nicht erreichbar → lokal ohne Auth weiterarbeiten
      set({ isAuthenticated: true, authChecked: true, role: 'admin' })
    }
  },

  async logout() {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {})
    set({ isAuthenticated: false, authChecked: true, needsSetup: false, username: '' })
  },

  load: () => get().checkAuth(),
}))
