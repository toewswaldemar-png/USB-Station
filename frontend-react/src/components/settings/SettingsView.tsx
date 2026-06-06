import { useState, useEffect, useRef } from 'react'
import { X, Maximize, Minimize, RotateCcw, Power, AlertTriangle } from 'lucide-react'
import { useUISettingsStore } from '@/stores/uiSettingsStore'
import { useConfigStore } from '@/stores/configStore'
import { useFilesStore } from '@/stores/filesStore'
import { COLOR_PRESETS } from '@/types'

const FONTS = [
  'Segoe UI, system-ui, sans-serif',
  'Arial, sans-serif',
  'Georgia, serif',
  'Times New Roman, serif',
  '"Courier New", monospace',
  '"Trebuchet MS", sans-serif',
  'Verdana, sans-serif',
  'Tahoma, sans-serif',
  '"Palatino Linotype", serif',
  '"Comic Sans MS", cursive',
]

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${checked ? '' : 'bg-gray-200'}`}
      style={checked ? { background: 'var(--accent)' } : {}}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )
}

function Seg<T extends string>({ value, options, onChange }: {
  value: T
  options: { label: string; value: T }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-xl overflow-hidden border border-gray-200">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 py-2 text-sm font-semibold transition-colors ${value === o.value ? 'text-white' : 'text-gray-500 hover:bg-gray-50 bg-white'}`}
          style={value === o.value ? { background: 'var(--accent)' } : {}}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-gray-400">{label}</label>
      {children}
    </div>
  )
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-sm text-gray-600">{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-gray-50 rounded-2xl p-4 space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">{title}</h3>
      {children}
    </section>
  )
}

const inputCls = 'w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:border-transparent'
const selectCls = 'rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:border-transparent'

export default function SettingsView({ onClose, sseMsg }: { onClose: () => void; sseMsg: { data: string } }) {
  const { settings, update } = useUISettingsStore()
  const { config, save: saveConfig } = useConfigStore()
  const refreshFiles = useFilesStore(s => s.refreshFiles)
  const [isFs, setIsFs] = useState(false)
  const [exitConfirm, setExitConfirm] = useState(false)
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const exitBtnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => () => clearTimeout(exitTimer.current), [])
  useEffect(() => {
    if (!exitConfirm) return
    const handler = (e: MouseEvent) => {
      if (!exitBtnRef.current?.contains(e.target as Node)) {
        clearTimeout(exitTimer.current)
        setExitConfirm(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [exitConfirm])
  const [audioPath, setAudioPath] = useState(config.audio_path)
  const [webdavUrl, setWebdavUrl] = useState(config.webdav_url)
  const [webdavUser, setWebdavUser] = useState(config.webdav_user)
  const [webdavPw, setWebdavPw] = useState(config.webdav_password)
  const [webdavStatus, setWebdavStatus] = useState('')
  type ScanPhase = 'idle' | 'running' | 'done'
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle')
  const [scanProgress, setScanProgress] = useState<{ pct: number; done: number; total: number } | null>(null)
  const [scanDoneCount, setScanDoneCount] = useState(0)
  const scanStarted = useRef(false)
  const doneTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(doneTimer.current), [])

  useEffect(() => {
    const msg = sseMsg.data
    if (!scanStarted.current) return
    if (msg.startsWith('done:')) {
      scanStarted.current = false
      const count = parseInt(msg.slice(5), 10)
      setScanDoneCount(count)
      setScanPhase('done')
      setScanProgress(null)
      refreshFiles()
      clearTimeout(doneTimer.current)
      doneTimer.current = setTimeout(() => setScanPhase('idle'), 3000)
    } else if (msg.startsWith('progress:')) {
      const parts = msg.split(':')
      setScanProgress({
        pct: parseInt(parts[1], 10),
        done: parseInt(parts[2], 10),
        total: parseInt(parts[3], 10),
      })
    }
  }, [sseMsg, refreshFiles])

  async function clientCmd(cmd: string) {
    await fetch('/api/client-command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd }),
    })
  }

  async function pickFolder() {
    const res = await fetch('/api/pick-folder')
    if (res.ok) {
      const { path } = await res.json() as { path: string }
      if (path) setAudioPath(path)
    }
  }

  async function saveAudio() {
    await saveConfig({ audio_path: audioPath })
  }

  async function startScan() {
    clearTimeout(doneTimer.current)
    await saveAudio()
    setScanPhase('running')
    setScanProgress(null)
    const res = await fetch('/api/scan')
    if (!res.ok) {
      setScanPhase('idle')
      return
    }
    scanStarted.current = true
  }

  async function testWebDav() {
    await saveConfig({ webdav_url: webdavUrl, webdav_user: webdavUser, webdav_password: webdavPw })
    setWebdavStatus('Verbinde…')
    const res = await fetch('/api/webdav/test')
    if (res.ok) {
      const { count } = await res.json() as { count: number }
      setWebdavStatus(`✓ Verbunden – ${count} Einträge`)
    } else {
      setWebdavStatus(`✗ ${await res.text()}`)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div
        className="relative h-full w-[440px] bg-white shadow-2xl overflow-y-auto flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 sticky top-0 bg-white z-10 border-b border-gray-100">
          <span className="font-bold text-base text-gray-900">Einstellungen</span>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">

          <Card title="Allgemein">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-400">App-Name</label>
                <input
                  className={inputCls}
                  style={{ '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
                  value={settings.appName}
                  onChange={e => update({ appName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-400">Schriftart</label>
                <select
                  className={`${selectCls} w-full`}
                  style={{ '--tw-ring-color': 'var(--accent)' } as React.CSSProperties}
                  value={settings.fontFamily}
                  onChange={e => update({ fontFamily: e.target.value })}
                >
                  {FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f.split(',')[0].replace(/"/g, '')}</option>)}
                </select>
              </div>
            </Card>

            <Card title="Akzentfarbe">
              <div className="flex justify-between">
                {COLOR_PRESETS.map((p, i) => (
                  <button
                    key={p.name}
                    onClick={() => update({ colorPreset: i })}
                    className={`w-9 h-9 rounded-full transition-all ${settings.colorPreset === i ? 'scale-110 ring-2 ring-offset-2' : 'hover:scale-105'}`}
                    style={{ background: p.accent, '--tw-ring-color': p.accent } as React.CSSProperties}
                    title={p.name}
                  />
                ))}
              </div>
            </Card>

            <Card title="Kalender">
              <Field label="Heute-Stil">
                <Seg
                  value={settings.todayStyle}
                  options={[{ label: 'Ring', value: 'ring' }, { label: 'Gefüllt', value: 'filled' }, { label: 'Zelle', value: 'cell' }]}
                  onChange={v => update({ todayStyle: v as 'ring' | 'filled' | 'cell' })}
                />
              </Field>
              <Field label="Eintraggröße">
                <Seg
                  value={settings.entrySize}
                  options={[{ label: 'Klein', value: 'sm' }, { label: 'Mittel', value: 'md' }, { label: 'Groß', value: 'lg' }]}
                  onChange={v => update({ entrySize: v as 'sm' | 'md' | 'lg' })}
                />
              </Field>
              <Field label="Animation">
                <Seg
                  value={settings.calAnimation}
                  options={[
                    { label: 'Sanft', value: 'sanft' },
                    { label: 'Fade', value: 'fade' },
                    { label: 'Slide', value: 'slide' },
                  ]}
                  onChange={v => update({ calAnimation: v as typeof settings.calAnimation })}
                />
              </Field>
              <Field label="Geschwindigkeit">
                <Seg
                  value={settings.calAnimSpeed}
                  options={[{ label: 'Langsam', value: 'slow' }, { label: 'Normal', value: 'normal' }, { label: 'Schnell', value: 'fast' }]}
                  onChange={v => update({ calAnimSpeed: v as 'slow' | 'normal' | 'fast' })}
                />
              </Field>
              <Field label="Wisch-Schwelle">
                <Seg
                  value={String(settings.swipeThreshold)}
                  options={[{ label: 'Kurz', value: '30' }, { label: 'Mittel', value: '60' }, { label: 'Weit', value: '90' }]}
                  onChange={v => update({ swipeThreshold: Number(v) })}
                />
              </Field>
              <ToggleField label="AM/PM-Aufteilung" checked={settings.amPmSplit} onChange={v => update({ amPmSplit: v })} />
            </Card>

            <Card title="Audioverzeichnis">
              <div className="flex gap-2">
                <input
                  className={`${inputCls} flex-1`}
                  value={audioPath}
                  onChange={e => setAudioPath(e.target.value)}
                  placeholder="/pfad/zu/audio"
                />
                <button
                  onClick={pickFolder}
                  className="px-4 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 bg-white hover:bg-gray-50 transition-colors"
                >
                  Wählen
                </button>
              </div>
              <button
                onClick={startScan}
                disabled={scanPhase !== 'idle'}
                className={`relative w-full py-2.5 rounded-xl text-sm font-semibold text-white overflow-hidden${scanPhase === 'running' && !scanProgress ? ' animate-pulse' : ''}`}
                style={{ background: 'var(--accent)' }}
              >
                {scanPhase === 'running' && scanProgress && (
                  <div
                    className="absolute inset-y-0 right-0 rounded-r-xl"
                    style={{ width: `${100 - scanProgress.pct}%`, background: 'rgba(0,0,0,0.25)', transition: 'width 0.3s ease' }}
                  />
                )}
                <span className="relative z-10 select-none">
                  {scanPhase === 'idle' && 'Scannen'}
                  {scanPhase === 'running' && !scanProgress && 'Scannt…'}
                  {scanPhase === 'running' && scanProgress && `${scanProgress.done} / ${scanProgress.total}`}
                  {scanPhase === 'done' && `✓ ${scanDoneCount} Datei${scanDoneCount !== 1 ? 'en' : ''}`}
                </span>
              </button>
            </Card>

            <Card title="WebDAV / Cloud">
              <input className={inputCls} value={webdavUrl}
                onChange={e => setWebdavUrl(e.target.value)} placeholder="https://cloud.example.com/dav" />
              <input className={inputCls} value={webdavUser}
                onChange={e => setWebdavUser(e.target.value)} placeholder="Benutzer" />
              <input type="password" className={inputCls} value={webdavPw}
                onChange={e => setWebdavPw(e.target.value)} placeholder="Passwort" />
              <div className="flex gap-2">
                <button
                  onClick={() => saveConfig({ webdav_url: webdavUrl, webdav_user: webdavUser, webdav_password: webdavPw })}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 bg-white hover:bg-gray-50 transition-colors"
                >
                  Speichern
                </button>
                <button
                  onClick={testWebDav}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
                  style={{ background: 'var(--accent)' }}
                >
                  Verbindung testen
                </button>
              </div>
              {webdavStatus && (
                <p className={`text-xs font-medium ${webdavStatus.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
                  {webdavStatus}
                </p>
              )}
            </Card>

          <Card title="FileStation Client">
            <div className="flex gap-2">
              <button
                onClick={() => { setIsFs(f => !f); clientCmd('fullscreen') }}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 bg-white hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5"
              >
                {isFs ? <><Minimize size={15} /> Fenster</> : <><Maximize size={15} /> Vollbild</>}
              </button>
              <button
                onClick={() => clientCmd('reload')}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 bg-white hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={15} /> Reload
              </button>
              <button
                ref={exitBtnRef}
                onClick={() => {
                  if (exitConfirm) {
                    clearTimeout(exitTimer.current)
                    setExitConfirm(false)
                    clientCmd('exit')
                  } else {
                    setExitConfirm(true)
                    exitTimer.current = setTimeout(() => setExitConfirm(false), 3000)
                  }
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors flex items-center justify-center gap-1.5"
                style={{ background: exitConfirm ? '#ef4444' : 'var(--accent)' }}
              >
                {exitConfirm
                  ? <><AlertTriangle size={15} /> Sicher?</>
                  : <><Power size={15} /> Beenden</>}
              </button>
            </div>
          </Card>

        </div>
      </div>
    </div>
  )
}
