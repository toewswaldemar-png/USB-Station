import { Calendar, FolderOpen, Settings } from 'lucide-react'
import { useClock } from '@/hooks/useClock'
import { useConfigStore } from '@/stores/configStore'

interface Props {
  activeTab: 'calendar' | 'explorer'
  onTabChange: (tab: 'calendar' | 'explorer') => void
  onOpenSettings: () => void
}

export default function Header({ activeTab, onTabChange, onOpenSettings }: Props) {
  const { time, date } = useClock()
  const appName = useConfigStore(s => s.config.app_name)

  return (
    <header
      className="grid shrink-0 shadow-[0_2px_6px_rgba(0,0,0,0.18)] z-10 select-none px-4 py-2"
      style={{
        background: 'var(--accent)',
        color: '#fff',
        fontSize: 'var(--font-size-header)',
        gridTemplateColumns: '1fr auto 1fr',
      }}
    >
      {/* Links: Tabs */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onTabChange('calendar')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold transition-colors
            ${activeTab === 'calendar' ? 'bg-white/20' : 'opacity-70 hover:opacity-100 hover:bg-white/10'}`}
        >
          <Calendar size={15} /> Kalender
        </button>
        <button
          onClick={() => onTabChange('explorer')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold transition-colors
            ${activeTab === 'explorer' ? 'bg-white/20' : 'opacity-70 hover:opacity-100 hover:bg-white/10'}`}
        >
          <FolderOpen size={15} /> Explorer
        </button>
      </div>

      {/* Mitte: App-Name */}
      <div className="flex items-center justify-center">
        <span className="font-semibold text-lg">{appName}</span>
      </div>

      {/* Rechts: Uhr + Settings */}
      <div className="flex items-center justify-end gap-4">
        <div className="text-sm flex items-center gap-2">
          <span className="opacity-80">{time}</span>
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
