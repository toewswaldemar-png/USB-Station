import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, X, Repeat, Repeat1, Shuffle } from 'lucide-react'
import { usePlayerStore, type PlayMode } from '@/stores/playerStore'

const MODE_LABELS: Record<PlayMode, string> = {
  'normal': 'Normal',
  'repeat-one': 'Datei wiederholen',
  'repeat-all': 'Ordner wiederholen',
  'shuffle': 'Zufall',
}

function PlayModeButton({ mode, onClick }: { mode: PlayMode; onClick: () => void }) {
  const active = mode !== 'normal'
  return (
    <button
      onClick={onClick}
      title={MODE_LABELS[mode]}
      className={`p-2 rounded-full active:bg-gray-100 transition-colors ${active ? '' : 'text-gray-300'}`}
      style={active ? { color: 'var(--accent)' } : undefined}
    >
      {mode === 'repeat-one' && <Repeat1 size={20} />}
      {mode === 'repeat-all' && <Repeat size={20} />}
      {mode === 'shuffle'    && <Shuffle size={20} />}
      {mode === 'normal'     && <Repeat size={20} />}
    </button>
  )
}

export default function MobilePlayerBar() {
  const { currentTrack, folderTracks, isPlaying, playMode, playNext, playPrev, playOnEnded, stop, setIsPlaying, cyclePlayMode } = usePlayerStore()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)

  const trackIdx = currentTrack
    ? folderTracks.findIndex(t => t.path === currentTrack.path)
    : -1
  const hasPrev = trackIdx > 0
  const hasNext = trackIdx >= 0 && trackIdx < folderTracks.length - 1

  // Progress sofort vor dem Paint zurücksetzen (verhindert Flash der alten Position)
  useLayoutEffect(() => {
    setProgress(0)
    setDuration(0)
  }, [currentTrack?.path])

  // Neuen Track laden wenn currentTrack wechselt
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !currentTrack) return
    audio.src = `/api/stream?path=${encodeURIComponent(currentTrack.path)}`
    audio.play().catch(() => {})
  }, [currentTrack])

  // Play/Pause synchronisieren
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) audio.play().catch(() => {})
    else audio.pause()
  }, [isPlaying])

  if (!currentTrack) return null

  function fmt(s: number) {
    if (!isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <div
      className="shrink-0 border-t border-gray-200 bg-white px-4 py-2 flex flex-col gap-3"
      style={{ boxShadow: '0 -2px 8px rgba(0,0,0,0.08)' }}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        onTimeUpdate={e => setProgress(e.currentTarget.currentTime)}
        onDurationChange={e => setDuration(e.currentTarget.duration)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={playOnEnded}
      />

      {/* Track-Name + Schließen */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="flex-1 text-sm font-semibold text-gray-900 truncate">{currentTrack.name}</span>
        <button onClick={stop} className="p-2 rounded-full border border-gray-200 text-gray-400 active:text-gray-700 active:bg-gray-100 shrink-0">
          <X size={18} />
        </button>
      </div>

      {/* Progress-Leiste */}
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={progress}
        onChange={e => {
          const t = Number(e.target.value)
          setProgress(t)
          if (audioRef.current) audioRef.current.currentTime = t
        }}
        className="w-full h-1 accent-[var(--accent)] cursor-pointer"
      />

      {/* Zeitanzeige + Steuerung */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 w-8">{fmt(progress)}</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (progress > 3) {
                setProgress(0)
                if (audioRef.current) audioRef.current.currentTime = 0
              } else {
                playPrev()
              }
            }}
            disabled={progress <= 3 && !hasPrev}
            className="p-2 rounded-full disabled:opacity-30 text-gray-600 active:bg-gray-100"
          >
            <SkipBack size={22} />
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="w-11 h-11 rounded-full flex items-center justify-center text-white"
            style={{ background: 'var(--accent)' }}
          >
            {isPlaying ? <Pause size={22} /> : <Play size={22} />}
          </button>
          <button
            onClick={playNext}
            disabled={!hasNext}
            className="p-2 rounded-full disabled:opacity-30 text-gray-600 active:bg-gray-100"
          >
            <SkipForward size={22} />
          </button>
          <PlayModeButton mode={playMode} onClick={cyclePlayMode} />
        </div>
        <span className="text-xs text-gray-400 w-8 text-right">{fmt(duration)}</span>
      </div>
    </div>
  )
}
