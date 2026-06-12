import { create } from 'zustand'

interface Track {
  path: string
  name: string
}

export type PlayMode = 'normal' | 'repeat-one' | 'repeat-all' | 'shuffle'

interface PlayerState {
  currentTrack: Track | null
  folderTracks: Track[]
  isPlaying: boolean
  playMode: PlayMode
  playTrack: (track: Track, folderTracks: Track[]) => void
  stop: () => void
  playNext: () => void
  playPrev: () => void
  playOnEnded: () => void
  setIsPlaying: (playing: boolean) => void
  cyclePlayMode: () => void
}

const MODES: PlayMode[] = ['normal', 'repeat-one', 'repeat-all', 'shuffle']

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  folderTracks: [],
  isPlaying: false,
  playMode: 'repeat-all',

  playTrack(track, folderTracks) {
    set({ currentTrack: track, folderTracks, isPlaying: true })
  },

  stop() {
    set({ currentTrack: null, isPlaying: false })
  },

  playNext() {
    const { currentTrack, folderTracks } = get()
    if (!currentTrack || folderTracks.length === 0) return
    const idx = folderTracks.findIndex(t => t.path === currentTrack.path)
    const next = folderTracks[idx + 1]
    if (next) set({ currentTrack: next, isPlaying: true })
  },

  playPrev() {
    const { currentTrack, folderTracks } = get()
    if (!currentTrack || folderTracks.length === 0) return
    const idx = folderTracks.findIndex(t => t.path === currentTrack.path)
    const prev = folderTracks[idx - 1]
    if (prev) set({ currentTrack: prev, isPlaying: true })
  },

  playOnEnded() {
    const { currentTrack, folderTracks, playMode } = get()
    if (!currentTrack || folderTracks.length === 0) return

    if (playMode === 'repeat-one') {
      // Signal an MobilePlayerBar: Track neu starten
      set({ isPlaying: false })
      setTimeout(() => set({ isPlaying: true }), 0)
      return
    }

    const idx = folderTracks.findIndex(t => t.path === currentTrack.path)

    if (playMode === 'shuffle') {
      const others = folderTracks.filter((_, i) => i !== idx)
      if (others.length === 0) return
      const rand = others[Math.floor(Math.random() * others.length)]
      set({ currentTrack: rand, isPlaying: true })
      return
    }

    const next = folderTracks[idx + 1]
    if (next) {
      set({ currentTrack: next, isPlaying: true })
    } else if (playMode === 'repeat-all') {
      set({ currentTrack: folderTracks[0], isPlaying: true })
    } else {
      set({ isPlaying: false })
    }
  },

  setIsPlaying(playing) {
    set({ isPlaying: playing })
  },

  cyclePlayMode() {
    const { playMode } = get()
    const idx = MODES.indexOf(playMode)
    set({ playMode: MODES[(idx + 1) % MODES.length] })
  },
}))
