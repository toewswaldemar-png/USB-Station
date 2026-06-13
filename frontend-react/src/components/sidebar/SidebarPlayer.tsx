import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, X, Repeat, Repeat1, Shuffle } from 'lucide-react'
import { usePlayerStore, type PlayMode } from '@/stores/playerStore'

const MODE_ICONS: Record<PlayMode, React.ReactNode> = {
  'normal':     <Repeat size={14} />,
  'repeat-one': <Repeat1 size={14} />,
  'repeat-all': <Repeat size={14} />,
  'shuffle':    <Shuffle size={14} />,
}

function fmt(s: number) {
  if (!isFinite(s)) return '--:--'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function SidebarPlayer() {
  const { currentTrack, folderTracks, isPlaying, playMode, playNext, playPrev, playOnEnded, stop, setIsPlaying, cyclePlayMode } = usePlayerStore()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)

  const trackIdx = currentTrack ? folderTracks.findIndex(t => t.path === currentTrack.path) : -1
  const hasPrev = trackIdx > 0
  const hasNext = trackIdx >= 0 && trackIdx < folderTracks.length - 1

  useLayoutEffect(() => {
    setProgress(0)
    setDuration(0)
  }, [currentTrack?.path])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !currentTrack) return
    audio.src = `/api/stream?path=${encodeURIComponent(currentTrack.path)}`
    audio.play().catch(() => {})
  }, [currentTrack])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) audio.play().catch(() => {})
    else audio.pause()
  }, [isPlaying])

  if (!currentTrack) return null

  const modeActive = playMode !== 'normal'

  return (
    <div className="mx-3 mb-3 shrink-0 bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2.5 flex flex-col gap-2">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        onTimeUpdate={e => setProgress(e.currentTarget.currentTime)}
        onDurationChange={e => setDuration(e.currentTarget.duration)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={playOnEnded}
      />

      {/* Track-Name + Stop */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="flex-1 text-[12px] font-semibold text-gray-800 truncate">{currentTrack.name}</span>
        <button onClick={stop} className="shrink-0 p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
          <X size={13} />
        </button>
      </div>

      {/* Progress */}
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

      {/* Steuerung + Zeit */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-400 w-7">{fmt(progress)}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (progress > 3) { setProgress(0); if (audioRef.current) audioRef.current.currentTime = 0 }
              else playPrev()
            }}
            disabled={progress <= 3 && !hasPrev}
            className="p-1.5 rounded-full disabled:opacity-30 text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <SkipBack size={16} />
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0"
            style={{ background: 'var(--accent)' }}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            onClick={playNext}
            disabled={!hasNext}
            className="p-1.5 rounded-full disabled:opacity-30 text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <SkipForward size={16} />
          </button>
          <button
            onClick={cyclePlayMode}
            title={playMode}
            className={`p-1.5 rounded-full transition-colors ${modeActive ? '' : 'text-gray-300 hover:text-gray-500'}`}
            style={modeActive ? { color: 'var(--accent)' } : undefined}
          >
            {MODE_ICONS[playMode]}
          </button>
        </div>
        <span className="text-[10px] text-gray-400 w-7 text-right">{duration > 0 ? fmt(duration) : '--:--'}</span>
      </div>
    </div>
  )
}
