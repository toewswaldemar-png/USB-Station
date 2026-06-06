import type { AudioFile } from '@/types'
import CalendarEntry from './CalendarEntry'

const SPEED_MS: Record<string, string> = { slow: '0.6s', normal: '0.3s', fast: '0.15s' }
const AM_HOUR = 12

interface Props {
  day: number
  isToday: boolean
  isWeekend: boolean
  todayStyle: 'ring' | 'filled' | 'cell'
  groups: Map<string, AudioFile[]>
  entrySize: 'sm' | 'md' | 'lg'
  compact: boolean
  bold: boolean
  animation: string
  animSpeed: string
  amPmSplit: boolean
  groupStatus: (files: AudioFile[]) => 'none' | 'partial' | 'full'
  onToggleGroup: (files: AudioFile[]) => void
}

export default function CalendarDay({
  day, isToday, isWeekend, todayStyle, groups,
  entrySize, compact, bold, animation, animSpeed,
  amPmSplit, groupStatus, onToggleGroup,
}: Props) {
  const dur = SPEED_MS[animSpeed] ?? '0.3s'

  const allEntries = [...groups.entries()]
  const amEntries = amPmSplit
    ? allEntries.filter(([, files]) => parseInt((files[0]?.date || '').split('T')[1]?.slice(0, 2) ?? '0', 10) < AM_HOUR)
    : allEntries
  const pmEntries = amPmSplit
    ? allEntries.filter(([, files]) => parseInt((files[0]?.date || '').split('T')[1]?.slice(0, 2) ?? '0', 10) >= AM_HOUR)
    : []

  const visibleEntries = (amPmSplit ? [...amEntries, ...pmEntries] : allEntries).slice(0, 2)

  const cellBg = isToday && todayStyle === 'cell' ? 'bg-violet-50' : 'bg-white'

  const todayRing = isToday && todayStyle === 'ring' ? 'ring-2 ring-inset ring-violet-400' : ''

  const numEl = isToday ? (
    todayStyle === 'filled'
      ? <span className="flex items-center justify-center w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold">{day}</span>
      : <span className="flex items-center justify-center w-6 h-6 rounded-full text-violet-600 text-xs font-bold">{day}</span>
  ) : (
    <span className={`text-xs font-semibold ${isWeekend ? 'text-red-400' : 'text-gray-400'}`}>{day}</span>
  )

  return (
    <div className={`flex flex-col overflow-hidden h-full ${cellBg} ${todayRing}`}>
      <div className="px-2 pt-1.5 pb-0.5 shrink-0">
        {numEl}
      </div>
      <div className="flex-1 overflow-hidden px-1.5 pb-1.5 flex flex-col gap-0.5">
        {visibleEntries.map(([key, files]) => (
          <div key={key} className={`min-h-0 py-0.5 ${visibleEntries.length === 1 ? 'h-1/2' : 'flex-1'}`}>
            <CalendarEntry
              label={key}
              files={files}
              status={groupStatus(files)}
              size={entrySize}
              compact={compact}
              bold={bold}
              animClass={`cal-anim-${animation}`}
              animDur={dur}
              onClick={() => onToggleGroup(files)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
