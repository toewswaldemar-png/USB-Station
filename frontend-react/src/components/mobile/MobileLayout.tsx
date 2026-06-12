import { useState } from 'react'
import { Settings } from 'lucide-react'
import { ErrorBoundary } from 'react-error-boundary'
import { useConfigStore } from '@/stores/configStore'
import { usePlayerStore } from '@/stores/playerStore'
import ExplorerView from '@/components/explorer/ExplorerView'
import MobilePlayerBar from '@/components/mobile/MobilePlayerBar'
import SettingsView from '@/components/settings/SettingsView'

interface Props {
  sseMsg: { data: string }
}

function ErrorFallback({ error }: { error: unknown }) {
  return <p className="text-red-600 p-4">Fehler: {String(error)}</p>
}

export default function MobileLayout({ sseMsg }: Props) {
  const appName = useConfigStore(s => s.config.app_name)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const stop = usePlayerStore(s => s.stop)

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: '100dvh' }}>
      {/* Header */}
      <header
        className="flex items-center gap-2 shrink-0 px-4 py-3 shadow-[0_2px_6px_rgba(0,0,0,0.18)] z-10 select-none"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        <span className="font-semibold text-base flex-1">{appName}</span>
        <div className="flex items-center gap-1">
          {currentTrack && (
            <button
              onClick={stop}
              title={currentTrack.name}
              className="p-2 rounded hover:bg-white/20 transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2"/>
                <rect x="8" y="8" width="8" height="8" rx="1" fill="#f87171"/>
              </svg>
            </button>
          )}
          {!new URLSearchParams(window.location.search).has('kiosk') && (
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-2 rounded hover:bg-white/20 transition-colors"
            >
              <Settings size={20} />
            </button>
          )}
        </div>
      </header>

      {/* Explorer — füllt verbleibenden Platz */}
      <main className="flex-1 overflow-hidden">
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <ExplorerView isMobile />
        </ErrorBoundary>
      </main>

      {/* Player-Leiste */}
      <MobilePlayerBar />

      {settingsOpen && (
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <SettingsView onClose={() => setSettingsOpen(false)} sseMsg={sseMsg} />
        </ErrorBoundary>
      )}
    </div>
  )
}
