import { useEffect, useRef, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useFilesStore } from '@/stores/filesStore'
import { useConfigStore } from '@/stores/configStore'
import { useUISettingsStore } from '@/stores/uiSettingsStore'
import { useSSE } from '@/hooks/useSSE'
import { COLOR_PRESETS } from '@/types'
import Header from '@/components/layout/Header'
import Sidebar from '@/components/layout/Sidebar'
import CalendarView from '@/components/calendar/CalendarView'
import ExplorerView from '@/components/explorer/ExplorerView'
import { invalidateExplorerCache } from '@/components/explorer/explorerCache'
import SettingsView from '@/components/settings/SettingsView'

const ACTIVE_TAB_KEY = 'fs_activeTab'

function ErrorFallback({ error }: { error: unknown }) {
  return <p className="text-red-600 p-4">Fehler beim Laden: {String(error)}</p>
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'calendar' | 'explorer'>(
    () => (localStorage.getItem(ACTIVE_TAB_KEY) as 'calendar' | 'explorer') || 'calendar'
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const tabDirRef = useRef<'next' | 'prev'>('next')
  const [sseMsg, setSseMsg] = useState<{ data: string }>({ data: '' })

  const loadFiles = useFilesStore(s => s.loadFiles)
  const refreshFiles = useFilesStore(s => s.refreshFiles)
  const loadConfig = useConfigStore(s => s.load)
  const loadUI = useUISettingsStore(s => s.load)
  const settings = useUISettingsStore(s => s.settings)
  const uiLoaded = useUISettingsStore(s => s.loaded)

  // SSE
  useSSE((data) => {
    setSseMsg({ data })
    if (data.startsWith('done:')) {
      refreshFiles()
      invalidateExplorerCache()
    }
    if (data === 'dir_invalidated') {
      invalidateExplorerCache()
    }
    if (data === 'ui_settings') loadUI()
    if (data === 'connected') {
      setTimeout(() => {
        const { allFiles, loading } = useFilesStore.getState()
        if (!loading && allFiles.length === 0) refreshFiles()
      }, 500)
    }
  })

  useEffect(() => {
    loadConfig()
    loadUI()
    loadFiles()
  }, [loadConfig, loadUI, loadFiles])

  // Einstellungen → CSS-Variablen (erst nach API-Antwort, damit index.html-Cache nicht überschrieben wird)
  useEffect(() => {
    if (!uiLoaded) return
    const preset = COLOR_PRESETS[settings.colorPreset] ?? COLOR_PRESETS[0]
    const root = document.documentElement
    root.style.setProperty('--accent', preset.accent)
    root.style.setProperty('--accent-l', preset.light)
    root.style.setProperty('--accent-xl', preset.xlight)
    root.style.setProperty('--font-family', settings.fontFamily)
    localStorage.setItem('ui_accent', JSON.stringify({ a: preset.accent, l: preset.light, xl: preset.xlight }))
  }, [settings, uiLoaded])

  function switchTab(tab: 'calendar' | 'explorer') {
    tabDirRef.current = tab === 'explorer' ? 'next' : 'prev'
    if (tab === 'explorer') localStorage.removeItem('fs_path')
    setActiveTab(tab)
    localStorage.setItem(ACTIVE_TAB_KEY, tab)
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        activeTab={activeTab}
        onTabChange={switchTab}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar sseMsg={sseMsg} />
        <main className="flex-1 overflow-hidden">
          <ErrorBoundary FallbackComponent={ErrorFallback}>
            <div
              key={activeTab}
              className={`h-full overflow-hidden ${settings.calAnimation === 'slide' ? (tabDirRef.current === 'next' ? 'cal-month-next' : 'cal-month-prev') : `cal-anim-${settings.calAnimation}`}`}
              style={{ '--cal-dur': { slow: '0.6s', normal: '0.3s', fast: '0.15s' }[settings.calAnimSpeed] ?? '0.3s' } as React.CSSProperties}
            >
              {activeTab === 'calendar' ? <CalendarView /> : <ExplorerView />}
            </div>
          </ErrorBoundary>
        </main>
      </div>
      {settingsOpen && (
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <SettingsView onClose={() => setSettingsOpen(false)} sseMsg={sseMsg} />
        </ErrorBoundary>
      )}
    </div>
  )
}
