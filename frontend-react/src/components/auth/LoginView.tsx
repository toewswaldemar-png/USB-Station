import { useState } from 'react'
import { LogIn } from 'lucide-react'

interface Props {
  onLogin: () => void
}

const inputCls = 'w-full rounded-xl border border-gray-200 px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:border-transparent'

export default function LoginView({ onLogin }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        {/* Logo / Titel */}
        <div className="text-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg"
            style={{ background: 'var(--accent)' }}
          >
            <LogIn size={26} color="white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Anmelden</h1>
          <p className="text-sm text-gray-400 mt-1">Gib deine Zugangsdaten ein</p>
        </div>

        {/* Karte */}
        <div className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Benutzername</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className={inputCls}
                style={{ '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
                autoFocus
                autoComplete="username"
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Passwort</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={inputCls}
                style={{ '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
                autoComplete="current-password"
                disabled={loading}
              />
            </div>

            {error && (
              <p className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full py-3 rounded-xl text-white text-sm font-semibold transition-opacity disabled:opacity-40"
              style={{ background: 'var(--accent)' }}
            >
              {loading ? 'Anmelden…' : 'Anmelden'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
