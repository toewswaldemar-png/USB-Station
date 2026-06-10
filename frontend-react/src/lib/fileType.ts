export type FileType = 'audio' | 'image' | 'pdf' | 'other'

const AUDIO = new Set(['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac'])
const IMAGE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'])

export function getFileType(name: string): FileType {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (AUDIO.has(ext)) return 'audio'
  if (IMAGE.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  return 'other'
}
