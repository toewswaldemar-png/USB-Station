export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

export function formatDate(iso: string): string {
  if (!iso) return ''
  // "2024-03-15" → "15.03.2024"
  const parts = iso.split('-')
  if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`
  return iso
}

export function isoToMonthYear(iso: string): { year: number; month: number } {
  const [y, m] = iso.split('-').map(Number)
  return { year: y || 0, month: m || 1 }
}
