export type FileType = 'audio' | 'image' | 'pdf' | 'text' | 'other'

const AUDIO = new Set(['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac'])
const IMAGE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'])
const TEXT  = new Set([
  'txt', 'md', 'csv', 'log', 'nfo',
  'json', 'xml', 'html', 'htm', 'yaml', 'yml', 'toml',
  'ini', 'inf', 'cfg', 'conf', 'config', 'env',
  'bat', 'sh', 'ps1', 'py', 'js', 'ts', 'css',
])

export function getFileType(name: string): FileType {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (AUDIO.has(ext)) return 'audio'
  if (IMAGE.has(ext)) return 'image'
  if (ext === 'pdf')  return 'pdf'
  if (TEXT.has(ext))  return 'text'
  return 'other'
}
