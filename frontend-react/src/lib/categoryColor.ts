import { COLOR_PRESETS, type ColorPreset } from '@/types'

// Stabiler Hash über den Kategorienamen → deterministischer Index in COLOR_PRESETS,
// damit derselbe Ordnername ohne Konfiguration immer dieselbe Farbe bekommt.
function hashIndex(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % COLOR_PRESETS.length
}

export function categoryOf(path: string): string {
  return path.split('/')[0] || path
}

export function getCategoryColor(category: string, overrides: Record<string, number>): ColorPreset {
  const idx = overrides[category]
  return COLOR_PRESETS[idx !== undefined ? idx : hashIndex(category)] ?? COLOR_PRESETS[0]
}
