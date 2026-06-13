import { useState, useEffect, useRef } from 'react'
import { Plus, Pencil, Trash2, Check, X, ChevronDown } from 'lucide-react'
import { useUserStore } from '@/stores/userStore'

interface User {
  id: number
  username: string
  role: string
  created_at: string
}

const inputCls = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:border-transparent'

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'user', label: 'Benutzer' },
]

function UserForm({
  initial,
  onSave,
  onCancel,
  isNew,
}: {
  initial: { username: string; role: string }
  onSave: (username: string, password: string, role: string) => Promise<void>
  onCancel: () => void
  isNew: boolean
}) {
  const [username, setUsername] = useState(initial.username)
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(initial.role)
  const [roleOpen, setRoleOpen] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const roleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!roleOpen) return
    function handler(e: MouseEvent) {
      if (roleRef.current && !roleRef.current.contains(e.target as Node)) setRoleOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [roleOpen])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isNew && password.length < 8) { setError('Passwort min. 8 Zeichen'); return }
    if (password && password.length < 8) { setError('Passwort min. 8 Zeichen'); return }
    setSaving(true)
    setError('')
    try {
      await onSave(username, password, role)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 pt-2">
      <input
        value={username}
        onChange={e => setUsername(e.target.value)}
        placeholder="Benutzername"
        className={inputCls}
        style={{ '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
        autoFocus
      />
      <input
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        placeholder={isNew ? 'Passwort (min. 8 Zeichen)' : 'Neues Passwort (leer = unverändert)'}
        className={inputCls}
        style={{ '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
      />
      <div ref={roleRef} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <button
          type="button"
          onClick={() => setRoleOpen(o => !o)}
          className="w-full px-3 py-2 text-sm flex items-center justify-between"
        >
          <span>{ROLES.find(r => r.value === role)?.label ?? role}</span>
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${roleOpen ? 'rotate-180' : ''}`} />
        </button>
        {roleOpen && (
          <div className="border-t border-gray-100">
            {ROLES.map(r => (
              <button
                key={r.value}
                type="button"
                onClick={() => { setRole(r.value); setRoleOpen(false) }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-gray-50 flex items-center justify-between ${role === r.value ? 'font-semibold' : ''}`}
              >
                {r.label}
                {role === r.value && <Check size={13} style={{ color: 'var(--accent)' }} />}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving || !username}
          className="flex-1 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5"
          style={{ background: 'var(--accent)' }}
        >
          <Check size={14} /> {saving ? 'Speichern…' : 'Speichern'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 bg-white hover:bg-gray-50 flex items-center justify-center gap-1.5"
        >
          <X size={14} /> Abbrechen
        </button>
      </div>
    </form>
  )
}

export default function UserManagement() {
  const currentUsername = useUserStore(s => s.username)
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)


  async function reload() {
    setLoading(true)
    try {
      const res = await fetch('/api/users')
      if (res.ok) setUsers(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  async function createUser(username: string, password: string, role: string) {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role }),
    })
    if (!res.ok) throw new Error(await res.text())
    setAdding(false)
    reload()
  }

  async function updateUser(id: number, username: string, password: string, role: string) {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role }),
    })
    if (!res.ok) throw new Error(await res.text())
    setEditingId(null)
    reload()
  }

  async function deleteUser(id: number) {
    await fetch(`/api/users/${id}`, { method: 'DELETE' })
    reload()
  }

  if (loading) {
    return <p className="text-sm text-gray-400 text-center py-2">Laden…</p>
  }

  return (
    <div className="space-y-2" onClick={() => setConfirmDeleteId(null)}>
      {users.map(u => (
        <div key={u.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {editingId === u.id ? (
            <div className="px-3 pb-3">
              <UserForm
                initial={{ username: u.username, role: u.role }}
                onSave={(un, pw, r) => updateUser(u.id, un, pw, r)}
                onCancel={() => setEditingId(null)}
                isNew={false}
              />
            </div>
          ) : (
            <div className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {u.username}
                  {u.username === currentUsername && (
                    <span className="ml-1.5 text-[10px] font-semibold text-white px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent)' }}>Du</span>
                  )}
                </p>
                <p className="text-xs text-gray-400">{ROLES.find(r => r.value === u.role)?.label ?? u.role}</p>
              </div>
              <button
                onClick={() => setEditingId(u.id)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                title="Bearbeiten"
              >
                <Pencil size={14} />
              </button>
              {u.username !== currentUsername && (
                confirmDeleteId === u.id ? (
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => { deleteUser(u.id); setConfirmDeleteId(null) }}
                      className="px-2 py-1 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors"
                    >
                      Löschen
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2 py-1 rounded-lg border border-gray-200 text-xs font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
                    >
                      Abbrechen
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={e => { e.stopPropagation(); setConfirmDeleteId(u.id) }}
                    disabled={adding}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors disabled:pointer-events-none"
                    title="Löschen"
                  >
                    <Trash2 size={14} />
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}

      {adding ? (
        <div className="bg-white rounded-xl border border-gray-100 px-3 pb-3">
          <UserForm
            initial={{ username: '', role: 'user' }}
            onSave={createUser}
            onCancel={() => setAdding(false)}
            isNew
          />
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          disabled={confirmDeleteId !== null}
          className="w-full py-2 rounded-xl border border-dashed border-gray-200 text-sm font-semibold text-gray-400 hover:border-gray-300 hover:text-gray-600 hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-30 disabled:pointer-events-none"
        >
          <Plus size={14} /> Benutzer hinzufügen
        </button>
      )}
    </div>
  )
}
