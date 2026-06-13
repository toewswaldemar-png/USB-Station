import { useState } from 'react'
import { LogOut, Settings } from 'lucide-react'
import { ErrorBoundary } from 'react-error-boundary'
import { useConfigStore } from '@/stores/configStore'
import { useUserStore } from '@/stores/userStore'
import ExplorerView from '@/components/explorer/ExplorerView'
import MobilePlayerBar from '@/components/mobile/MobilePlayerBar'
import SettingsView from '@/components/settings/SettingsView'

interface Props {
  sseMsg: { data: string }
  role?: 'admin' | 'user'
}

function ErrorFallback({ error }: { error: unknown }) {
  return <p className="text-red-600 p-4">Fehler: {String(error)}</p>
}

export default function MobileLayout({ sseMsg }: Props) {
  const appName = useConfigStore(s => s.config.app_name)
  const { role, username, logout } = useUserStore()
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: '100dvh' }}>
      {/* Header */}
      <header
        className="flex items-center shrink-0 px-4 py-2 shadow-[0_2px_6px_rgba(0,0,0,0.18)] z-10 select-none"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        <span className="font-semibold text-sm flex-1">{appName}</span>
        <div className="flex items-center gap-3">
          {role === 'admin' && (
            <button
              onClick={() => setSettingsOpen(true)}
              title="Einstellungen"
              className="p-1.5 rounded-full border border-white/40 bg-white/15 hover:bg-white/25 transition-colors"
            >
              <Settings size={16} color="white" />
            </button>
          )}
          {username && (
            <button
              onClick={logout}
              title={`Abmelden (${username})`}
              className="p-1.5 rounded-full border border-white/40 bg-white/15 hover:bg-white/25 transition-colors"
            >
              <LogOut size={16} color="white" />
            </button>
          )}
        </div>
      </header>

      {settingsOpen && (
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <SettingsView onClose={() => setSettingsOpen(false)} sseMsg={sseMsg} />
        </ErrorBoundary>
      )}

      {/* Explorer — füllt verbleibenden Platz */}
      <main className="flex-1 overflow-hidden min-h-0">
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <ExplorerView isMobile />
        </ErrorBoundary>
      </main>

      {/* Player-Leiste */}
      <MobilePlayerBar />
    </div>
  )
}
