import { Square } from 'lucide-react'
import { ErrorBoundary } from 'react-error-boundary'
import { useConfigStore } from '@/stores/configStore'
import { usePlayerStore } from '@/stores/playerStore'
import ExplorerView from '@/components/explorer/ExplorerView'
import MobilePlayerBar from '@/components/mobile/MobilePlayerBar'

interface Props {
  sseMsg: { data: string }
  role?: 'admin' | 'cloud'
}

function ErrorFallback({ error }: { error: unknown }) {
  return <p className="text-red-600 p-4">Fehler: {String(error)}</p>
}

export default function MobileLayout({ sseMsg: _sseMsg, role: _role = 'admin' }: Props) {
  const appName = useConfigStore(s => s.config.app_name)
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const stop = usePlayerStore(s => s.stop)

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: '100dvh' }}>
      {/* Header */}
      <header
        className="flex items-center shrink-0 px-4 py-2 shadow-[0_2px_6px_rgba(0,0,0,0.18)] z-10 select-none"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        <span className="font-semibold text-sm flex-1">{appName}</span>
        <button
          onClick={stop}
          title={currentTrack?.name ?? ''}
          className={`p-1.5 rounded-full border border-white/40 bg-white/15 hover:bg-white/25 transition-colors ${!currentTrack ? 'invisible' : ''}`}
        >
          <Square size={16} color="white" fill="white" />
        </button>
      </header>

      {/* Explorer — füllt verbleibenden Platz */}
      <main className="flex-1 overflow-hidden">
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <ExplorerView isMobile />
        </ErrorBoundary>
      </main>

      {/* Player-Leiste */}
      <MobilePlayerBar />
    </div>
  )
}
