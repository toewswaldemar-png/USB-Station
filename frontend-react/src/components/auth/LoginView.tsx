import { useState } from 'react'
import { Music2 } from 'lucide-react'

interface Props {
  onLogin: () => void
}

export default function LoginView({ onLogin }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const appName = localStorage.getItem('fs_app_name') || 'FileStation'
  const appSubtitle = localStorage.getItem('fs_app_subtitle') ?? ''

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (res.ok) {
        localStorage.removeItem('fs_path')
        onLogin()
      } else {
        setError('Ungültiger Benutzername oder Passwort')
      }
    } catch {
      setError('Verbindung fehlgeschlagen')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: 'linear-gradient(150deg, color-mix(in srgb, var(--accent) 10%, #f8fafc) 0%, #f8fafc 55%, color-mix(in srgb, var(--accent) 5%, #f0f9ff) 100%)',
      }}
    >
      <div className="w-full max-w-sm">

        {/* Logo + Name */}
        <div className="text-center mb-10">
          <div
            className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5 shadow-xl"
            style={{ background: 'var(--accent)' }}
          >
            <Music2 size={38} color="white" strokeWidth={1.8} />
          </div>
          <h1
            className="text-4xl font-extrabold tracking-tight"
            style={{ color: 'var(--accent)' }}
          >
            {appName}
          </h1>
          {appSubtitle && <p className="text-sm text-gray-400 mt-1.5 font-medium tracking-wide">{appSubtitle}</p>}
        </div>

        {/* Karte */}
        <div className="bg-white rounded-3xl shadow-2xl p-8 space-y-5">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Benutzername</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:bg-white transition-all"
                style={{ '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
                autoFocus
                autoComplete="username"
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Passwort</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:bg-white transition-all"
                style={{ '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
                autoComplete="current-password"
                disabled={loading}
              />
            </div>

            {error && (
              <p className="text-sm text-red-500 bg-red-50 rounded-2xl px-4 py-2.5">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full py-3.5 rounded-2xl text-white text-sm font-bold tracking-wide transition-all disabled:opacity-40 active:scale-[0.98] shadow-lg mt-2"
              style={{ background: 'var(--accent)', boxShadow: '0 8px 24px color-mix(in srgb, var(--accent) 35%, transparent)' }}
            >
              {loading ? 'Anmelden…' : 'Anmelden'}
            </button>
          </form>
        </div>

      </div>
    </div>
  )
}
