export interface AudioFile {
  path: string
  date: string
  title: string
  folder: string
  artist: string
  album: string
  size: number
  mtime: number
}

export interface UsbDrive {
  label: string
  path: string
  free: number
  total: number
}

export interface WebDavItem {
  name: string
  path: string
  is_dir: boolean
  size: number
  modified: string
}

export interface ColorPreset {
  name: string
  accent: string
  light: string
  xlight: string
}

export const COLOR_PRESETS: ColorPreset[] = [
  { name: 'Violett',  accent: '#7c3aed', light: '#ede9fe', xlight: '#f5f3ff' },
  { name: 'Blau',     accent: '#2563eb', light: '#dbeafe', xlight: '#eff6ff' },
  { name: 'Grün',     accent: '#16a34a', light: '#dcfce7', xlight: '#f0fdf4' },
  { name: 'Orange',   accent: '#ea580c', light: '#ffedd5', xlight: '#fff7ed' },
  { name: 'Rosa',     accent: '#db2777', light: '#fce7f3', xlight: '#fdf2f8' },
  { name: 'Dunkel',   accent: '#374151', light: '#f3f4f6', xlight: '#f9fafb' },
  { name: 'Rot',      accent: '#dc2626', light: '#fee2e2', xlight: '#fef2f2' },
  { name: 'Türkis',   accent: '#0891b2', light: '#cffafe', xlight: '#ecfeff' },
]
