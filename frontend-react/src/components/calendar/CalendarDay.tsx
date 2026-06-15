import type { CSSProperties } from 'react'
import type { AudioFile } from '@/types'
import CalendarEntry from './CalendarEntry'

const AM_HOUR = 12

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
  groupStatus: (files: AudioFile[]) => 'none' | 'partial' | 'full'
  onToggleGroup: (files: AudioFile[]) => void
}

export default function CalendarDay({
  day, isToday, isWeekend, todayStyle, groups, ghostGroups = [],
  entrySize, compact, bold,
  amPmSplit, groupStatus, onToggleGroup,
}: Props) {

  const allEntries = [...groups.entries()]
  const amEntries = amPmSplit
    ? allEntries.filter(([, files]) => parseInt((files[0]?.date || '').split('T')[1]?.slice(0, 2) ?? '0', 10) < AM_HOUR)
    : allEntries
  const pmEntries = amPmSplit
    ? allEntries.filter(([, files]) => parseInt((files[0]?.date || '').split('T')[1]?.slice(0, 2) ?? '0', 10) >= AM_HOUR)
    : []

  const visibleEntries = (amPmSplit ? [...amEntries, ...pmEntries] : allEntries).slice(0, 2)
  const ghostSlots = Math.max(0, 2 - visibleEntries.length)
  const visibleGhosts = ghostGroups.slice(0, ghostSlots)

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
      <div className="flex-1 overflow-hidden px-1.5 pb-1.5 flex flex-col gap-0.5">
        {visibleEntries.map(([key, files]) => (
          <div key={key} className={`min-h-0 py-0.5 ${visibleEntries.length + visibleGhosts.length === 1 ? 'h-1/2' : 'flex-1'}`}>
            <CalendarEntry
              label={key}
              files={files}
              status={groupStatus(files)}
              size={entrySize}
              compact={compact}
              bold={bold}
              onClick={() => onToggleGroup(files)}
            />
          </div>
        ))}
        {visibleGhosts.map(name => (
          <div key={`ghost-${name}`} className={`min-h-0 py-0.5 ${visibleEntries.length + visibleGhosts.length === 1 ? 'h-1/2' : 'flex-1'}`}>
            <CalendarEntry
              label={name}
              size={entrySize}
              compact={compact}
              bold={bold}
              ghost
            />
          </div>
        ))}
      </div>
    </div>
  )
}
