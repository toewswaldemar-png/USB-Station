import type { AudioFile } from '@/types'

export function groupKey(f: AudioFile): string {
  if (!f.date) return f.folder || f.title || f.path
  return f.date + ' ' + (f.folder || f.title)
}
