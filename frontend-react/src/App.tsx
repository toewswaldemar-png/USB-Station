import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { HardDrive } from 'lucide-react'
import { useFilesStore } from '@/stores/filesStore'
import { useConfigStore } from '@/stores/configStore'
import { useUISettingsStore } from '@/stores/uiSettingsStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useSSE } from '@/hooks/useSSE'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useUserStore } from '@/stores/userStore'
import { COLOR_PRESETS } from '@/types'
import type { UsbDrive } from '@/types'
import Header from '@/components/layout/Header'
import Sidebar from '@/components/layout/Sidebar'
import CalendarView from '@/components/calendar/CalendarView'
import ExplorerView from '@/components/explorer/ExplorerView'
import { invalidateExplorerCache } from '@/components/explorer/explorerCache'
import SettingsView from '@/components/settings/SettingsView'
import MobileLayout from '@/components/mobile/MobileLayout'
import LoginView from '@/components/auth/LoginView'
import SetupView from '@/components/auth/SetupView'

const ACTIVE_TAB_KEY = 'fs_activeTab'
const isKiosk = new URLSearchParams(window.location.search).has('kiosk')
const IDLE_RESET_MS = 3 * 60 * 1000

// Kiosk: Login überspringen (Backend behandelt fs_kiosk-Cookie als Nicht-Admin "user").
// Außerhalb des Kiosk-Aufrufs wird das Cookie entfernt, damit normale Admin-Nutzung unverändert Login verlangt.
document.cookie = isKiosk
  ? 'fs_kiosk=1; path=/; max-age=31536000'
  : 'fs_kiosk=; path=/; max-age=0'

function ErrorFallback({ error }: { error: unknown }) {
  return <p className="text-red-600 p-4">Fehler beim Laden: {String(error)}</p>
}

export default function App() {
  const isMobile = useMediaQuery('(max-width: 768px), (orientation: landscape) and (max-height: 500px)')
  const [activeTab, setActiveTab] = useState<'calendar' | 'explorer'>(
    () => (localStorage.getItem(ACTIVE_TAB_KEY) as 'calendar' | 'explorer') || 'calendar'
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [explorerResetKey, setExplorerResetKey] = useState(0)
  const tabDirRef = useRef<'next' | 'prev'>('next')
  const [sseMsg, setSseMsg] = useState<{ data: string }>({ data: '' })
  const [calMountKey, setCalMountKey] = useState(0)
  const expWrapRef = useRef<HTMLDivElement>(null)
  const explorerEverShown = useRef(activeTab === 'explorer')
  const [usbToast, setUsbToast] = useState<string | null>(null)
  const knownUsbPaths = useRef<Set<string> | null>(null)

  const loadFiles = useFilesStore(s => s.loadFiles)
  const refreshFiles = useFilesStore(s => s.refreshFiles)
  const loadConfig = useConfigStore(s => s.load)
  const loadUI = useUISettingsStore(s => s.load)
  const { role, isAuthenticated, needsSetup, authChecked, checkAuth } = useUserStore()
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
    if (isKiosk && data.startsWith('usb:')) {
      try {
        const drives = (JSON.parse(data.slice(4)) as UsbDrive[] | null) ?? []
        const paths = new Set(drives.map(d => d.path))
        if (knownUsbPaths.current !== null) {
          const newDrive = drives.find(d => !knownUsbPaths.current!.has(d.path))
          if (newDrive) {
            setUsbToast(`USB-Stick „${newDrive.label}“ erkannt – bereit zum Kopieren`)
            setTimeout(() => setUsbToast(null), 6000)
          }
        }
        knownUsbPaths.current = paths
      } catch { /* ignorieren */ }
    }
  })

  // Kiosk: Basiszustand der USB-Laufwerke laden, bevor SSE-Diffs ausgewertet werden.
  useEffect(() => {
    if (!isKiosk) return
    fetch('/api/usb')
      .then(r => r.json())
      .then((d: UsbDrive[] | null) => { knownUsbPaths.current = new Set((d ?? []).map(x => x.path)) })
      .catch(() => {})
  }, [])

  // Kiosk: Nach Inaktivität zurück zum Kalender (aktueller Monat), Auswahl + Wiedergabe zurücksetzen.
  useEffect(() => {
    if (!isKiosk) return
    let timer: ReturnType<typeof setTimeout>
    function resetIdle() {
      clearTimeout(timer)
      timer = setTimeout(() => {
        useSelectionStore.getState().clearAll()
        usePlayerStore.getState().stop()
        setExplorerResetKey(k => k + 1)
        setCalMountKey(k => k + 1)
        setActiveTab('calendar')
        localStorage.setItem(ACTIVE_TAB_KEY, 'calendar')
      }, IDLE_RESET_MS)
    }
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const
    events.forEach(ev => window.addEventListener(ev, resetIdle))
    resetIdle()
    return () => {
      clearTimeout(timer)
      events.forEach(ev => window.removeEventListener(ev, resetIdle))
    }
  }, [])

  // Auth zuerst prüfen
  useEffect(() => { checkAuth() }, [checkAuth])

  // Daten laden sobald authentifiziert
  useEffect(() => {
    if (!isAuthenticated) return
    loadConfig()
    loadUI()
    loadFiles()
  }, [isAuthenticated, loadConfig, loadUI, loadFiles])

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
    if (tab === 'explorer') setExplorerResetKey(k => k + 1)
    if (tab === 'calendar') setCalMountKey(k => k + 1)
    setActiveTab(tab)
    localStorage.setItem(ACTIVE_TAB_KEY, tab)
  }

  const ALL_ANIM_CLASSES = ['cal-month-next', 'cal-month-prev', 'cal-anim-sanft', 'cal-anim-fade', 'cal-anim-slide', 'cal-anim-flip', 'cal-anim-wipe', 'cal-anim-roll', 'cal-anim-bounce']

  // Imperativ: ExplorerView-Animation beim Tab-Wechsel anwenden
  useLayoutEffect(() => {
    if (activeTab !== 'explorer') return
    const el = expWrapRef.current
    if (!el) return
    if (!explorerEverShown.current) { explorerEverShown.current = true; return }
    const cls = settings.calAnimation === 'none' ? '' : `cal-anim-${settings.calAnimation}`
    const dur = ({ slow: '0.6s', normal: '0.3s', fast: '0.15s' } as Record<string, string>)[settings.calAnimSpeed] ?? '0.3s'
    el.style.setProperty('--cal-dur', dur)
    el.classList.remove(...ALL_ANIM_CLASSES)
    void el.offsetHeight
    if (cls) el.classList.add(cls)
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auth-Gate
  if (!authChecked) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="w-8 h-8 rounded-full border-[3px] border-t-transparent animate-spin" style={{ borderColor: 'var(--accent) transparent transparent transparent' }} />
      </div>
    )
  }
  if (needsSetup) return <SetupView onComplete={checkAuth} />
  if (!isAuthenticated) return <LoginView onLogin={checkAuth} />

  if (isMobile) {
    return <MobileLayout sseMsg={sseMsg} role={role === 'admin' ? 'admin' : 'user'} />
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        onOpenSettings={() => setSettingsOpen(true)}
        role={role === 'admin' ? 'admin' : 'user'}
      />
      {usbToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-5 py-3 rounded-xl shadow-2xl border border-white/10 bg-gray-900 text-white text-sm font-semibold">
          <HardDrive size={17} className="shrink-0" style={{ color: 'var(--accent)' }} />
          {usbToast}
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Sidebar sseMsg={sseMsg} activeTab={activeTab} onTabChange={switchTab} />
        </ErrorBoundary>
        <main className="flex-1 overflow-hidden relative">
          {/* CalendarView — nur gemountet wenn aktiv, Animation via key */}
          {activeTab === 'calendar' && (
            <ErrorBoundary FallbackComponent={ErrorFallback}>
              <div
                key={calMountKey}
                className={`absolute inset-0 overflow-hidden ${calMountKey > 0 && settings.calAnimation !== 'none' ? `cal-anim-${settings.calAnimation}` : ''}`}
                style={{ '--cal-dur': ({ slow: '0.6s', normal: '0.3s', fast: '0.15s' } as Record<string, string>)[settings.calAnimSpeed] ?? '0.3s' } as React.CSSProperties}
              >
                <CalendarView sseMsg={sseMsg.data} />
              </div>
            </ErrorBoundary>
          )}
          {/* ExplorerView — immer gemountet, per visibility versteckt, kein Remount-Delay */}
          <div
            ref={expWrapRef}
            className="absolute inset-0 overflow-hidden"
            style={{ visibility: activeTab === 'explorer' ? 'visible' : 'hidden' }}
          >
            <ErrorBoundary FallbackComponent={ErrorFallback}>
              <ExplorerView resetKey={explorerResetKey} />
            </ErrorBoundary>
          </div>
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
