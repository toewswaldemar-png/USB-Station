import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { useClock } from '@/hooks/useClock'
import { useUISettingsStore } from '@/stores/uiSettingsStore'

interface Verse { text: string; ref: string }

export default function Header({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { time, date } = useClock()
  const appName = useUISettingsStore(s => s.settings.appName)
  const [verse, setVerse] = useState<Verse | null>(null)

  useEffect(() => {
    fetch('/api/verse')
      .then(r => r.json())
      .then((v: Verse) => setVerse(v))
      .catch(() => {})
  }, [])

  return (
    <header
      className="relative flex items-center px-4 py-2 select-none shrink-0 shadow-md z-10"
      style={{ background: 'var(--accent)', color: '#fff', fontSize: 'var(--font-size-header)' }}
    >
      <span className="font-semibold text-lg shrink-0">{appName}</span>

      {verse && (
        <span className="absolute left-1/2 -translate-x-1/2 text-sm opacity-90 truncate max-w-[30%] text-center pointer-events-none">
          <em>{verse.text}</em>
          <span className="ml-2 opacity-75">– {verse.ref}</span>
        </span>
      )}

      <div className="ml-auto flex items-center gap-4">
        <div className="text-sm flex items-center gap-2">
          <span className="font-semibold tracking-wide">{time}</span>
          <span className="opacity-40">|</span>
          <span className="opacity-80">{date}</span>
        </div>
        {!new URLSearchParams(window.location.search).has('kiosk') && (
          <button
            onClick={onOpenSettings}
            className="p-1.5 rounded hover:bg-white/20 transition-colors"
            title="Einstellungen"
          >
            <Settings size={18} />
          </button>
        )}
      </div>
    </header>
  )
}
