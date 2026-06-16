import type { CSSProperties } from 'react'
import type { AudioFile } from '@/types'
import { categoryOf, getCategoryColor } from '@/lib/categoryColor'
import CalendarEntry from './CalendarEntry'

// Sortierung Vormittag/Nachmittag anhand des Namens (nicht der Uhrzeit) — robust auch ohne Zeit-Metadaten.
function dayPartRank(key: string): -1 | 0 | 1 {
  const lower = key.toLowerCase()
  if (lower.includes('vormittag')) return -1
  if (lower.includes('nachmittag')) return 1
  return 0
}

interface Props {
  day: number
  isToday: boolean
  isWeekend: boolean
  todayStyle: 'ring' | 'filled' | 'cell'
  groups: Map<string, AudioFile[]>
  ghostGroups?: string[]
  entrySize: 'sm' | 'md' | 'lg'
  compact: boolean
  bold: boolean
  amPmSplit: boolean
  chipStyle?: 'bar' | 'flat'
  categoryColors: Record<string, number>
  groupStatus: (files: AudioFile[]) => 'none' | 'partial' | 'full'
  onToggleGroup: (files: AudioFile[]) => void
}

export default function CalendarDay({
  day, isToday, isWeekend, todayStyle, groups, ghostGroups = [],
  entrySize, compact, bold, chipStyle = 'bar', categoryColors,
  amPmSplit, groupStatus, onToggleGroup,
}: Props) {

  const allEntries = [...groups.entries()]
  const sortedEntries = amPmSplit
    ? [...allEntries].sort((a, b) => dayPartRank(a[0]) - dayPartRank(b[0]))
    : allEntries

  const visibleEntries = sortedEntries.slice(0, 2)
  const ghostSlots = Math.max(0, 2 - visibleEntries.length)
  const visibleGhosts = ghostGroups.slice(0, ghostSlots)

  // Einzelner Eintrag, der als "Nachmittag" erkannt wird → unten statt oben positionieren.
  const soloLabel = visibleEntries.length + visibleGhosts.length === 1
    ? (visibleEntries[0]?.[0] ?? visibleGhosts[0] ?? '')
    : null
  const soloIsNachmittag = amPmSplit && soloLabel !== null && dayPartRank(soloLabel) > 0

  const containerStyle: CSSProperties = {
    background: isToday && todayStyle === 'cell' ? 'var(--accent-xl)' : 'white',
    ...(isToday && todayStyle === 'ring' ? { boxShadow: 'inset 0 0 0 2px var(--accent)' } : {}),
  }

  const numEl = isToday ? (
    todayStyle === 'filled'
      ? <span className="flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold" style={{ background: 'var(--accent)' }}>{day}</span>
      : <span className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold" style={{ color: 'var(--accent)' }}>{day}</span>
  ) : (
    <span className={`text-xs font-semibold ${isWeekend ? 'text-red-400' : 'text-gray-600'}`}>{day}</span>
  )

  return (
    <div className="flex flex-col overflow-hidden h-full" style={containerStyle}>
      <div className="px-2 pt-1.5 pb-0.5 shrink-0">
        {numEl}
      </div>
      <div className={`flex-1 overflow-hidden px-1.5 pb-1.5 flex flex-col gap-0.5 ${soloIsNachmittag ? 'justify-end' : ''}`}>
        {visibleEntries.map(([key, files]) => (
          <div key={key} className={`min-h-0 py-0.5 ${visibleEntries.length + visibleGhosts.length === 1 ? 'h-1/2' : 'flex-1'}`} style={{ containerType: 'size' }}>
            <CalendarEntry
              label={key}
              files={files}
              status={groupStatus(files)}
              size={entrySize}
              compact={compact}
              bold={bold}
              chipStyle={chipStyle}
              color={getCategoryColor(categoryOf(files[0]?.path ?? ''), categoryColors)}
              onClick={() => onToggleGroup(files)}
            />
          </div>
        ))}
        {visibleGhosts.map(name => (
          <div key={`ghost-${name}`} className={`min-h-0 py-0.5 ${visibleEntries.length + visibleGhosts.length === 1 ? 'h-1/2' : 'flex-1'}`} style={{ containerType: 'size' }}>
            <CalendarEntry
              label={name}
              size={entrySize}
              compact={compact}
              bold={bold}
              chipStyle={chipStyle}
              ghost
            />
          </div>
        ))}
      </div>
    </div>
  )
}
