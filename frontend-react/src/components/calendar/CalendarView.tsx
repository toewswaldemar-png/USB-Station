import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { useFilesStore } from '@/stores/filesStore'
import { useUISettingsStore } from '@/stores/uiSettingsStore'
import { useSelectionStore } from '@/stores/selectionStore'
import type { AudioFile } from '@/types'
import CalendarDay from './CalendarDay'
import CalendarDatepicker from './CalendarDatepicker'

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function firstDayOfMonth(year: number, month: number, startMonday: boolean) {
  let d = new Date(year, month, 1).getDay()
  if (startMonday) d = (d + 6) % 7
  return d
}

const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']

function saveCalMonth(year: number, month: number) {
  localStorage.setItem('fs_calMonth', `${year}-${month}`)
}

function loadCalMonth(): { year: number; month: number } {
  const today = new Date()
  const raw = localStorage.getItem('fs_calMonth')
  if (raw) {
    const [y, m] = raw.split('-').map(Number)
    if (!isNaN(y) && !isNaN(m)) return { year: y, month: m }
  }
  return { year: today.getFullYear(), month: today.getMonth() }
}

export default function CalendarView() {
  const today = new Date()
  const [year, setYear] = useState(() => loadCalMonth().year)
  const [month, setMonth] = useState(() => loadCalMonth().month)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [slideDir, setSlideDir] = useState<'next' | 'prev'>('next')
  const navigated = useRef(false)
  const settings = useUISettingsStore(s => s.settings)
  const filesByYearMonth = useFilesStore(s => s.filesByYearMonth)
  const { selectedFiles, toggleGroup } = useSelectionStore()

  const dragStartX = useRef(0)
  const dragStartY = useRef(0)
  const dragging = useRef(false)
  function handlePointerDown(e: React.PointerEvent) {
    dragStartX.current = e.clientX
    dragStartY.current = e.clientY
    dragging.current = true
  }
  function handlePointerUp(e: React.PointerEvent) {
    if (!dragging.current) return
    dragging.current = false
    const dx = e.clientX - dragStartX.current
    const dy = e.clientY - dragStartY.current
    if (Math.abs(dx) < settings.swipeThreshold) return
    if (Math.abs(dy) > Math.abs(dx)) return
    if (dx < 0) goNext(); else goPrev()
  }

  useEffect(() => {
    saveCalMonth(year, month)
  }, [year, month])

  function goPrev() {
    navigated.current = true
    setSlideDir('prev')
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function goNext() {
    navigated.current = true
    setSlideDir('next')
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }
  function goToday() {
    const toY = today.getFullYear(), toM = today.getMonth()
    if (toY === year && toM === month) return
    navigated.current = true
    setSlideDir(toY > year || (toY === year && toM > month) ? 'next' : 'prev')
    setYear(toY); setMonth(toM)
  }

  const ym = `${year}-${String(month + 1).padStart(2, '0')}`
  const groupMap = filesByYearMonth.get(ym) ?? new Map<string, AudioFile[]>()
  const days = daysInMonth(year, month)
  const firstDay = firstDayOfMonth(year, month, true)

  const prevMonth = month === 0 ? 11 : month - 1
  const prevYear  = month === 0 ? year - 1 : year
  const nextMonth = month === 11 ? 0 : month + 1
  const nextYear  = month === 11 ? year + 1 : year
  const daysInPrev = daysInMonth(prevYear, prevMonth)
  const totalCells = Math.ceil((firstDay + days) / 7) * 7
  const trailingDays = totalCells - firstDay - days

  const prevYm = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}`
  const nextYm = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}`
  const prevGroupMap = filesByYearMonth.get(prevYm) ?? new Map<string, AudioFile[]>()
  const nextGroupMap = filesByYearMonth.get(nextYm) ?? new Map<string, AudioFile[]>()

  function buildByDay(gm: Map<string, AudioFile[]>) {
    const m = new Map<number, Map<string, AudioFile[]>>()
    for (const [key, files] of gm) {
      for (const f of files) {
        const d = parseInt(f.date.split('-')[2] || '0', 10)
        if (!m.has(d)) m.set(d, new Map())
        const g = m.get(d)!
        if (!g.has(key)) g.set(key, [])
        g.get(key)!.push(f)
      }
    }
    return m
  }
  const byDayPrev = buildByDay(prevGroupMap)
  const byDayNext = buildByDay(nextGroupMap)

  const DAY_LABELS = ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag']
  const WEEKEND_COLS = [5, 6]

  const byDay = buildByDay(groupMap)

  const SPEED_MS: Record<string, string> = { slow: '0.6s', normal: '0.3s', fast: '0.15s' }
  const monthAnimDur = SPEED_MS[settings.calAnimSpeed] ?? '0.3s'
  const monthAnimClass = navigated.current
    ? (settings.calAnimation === 'slide'
        ? (slideDir === 'next' ? 'cal-month-next' : 'cal-month-prev')
        : `cal-anim-${settings.calAnimation}`)
    : ''

  function groupStatus(files: AudioFile[]): 'none' | 'partial' | 'full' {
    const sel = files.filter(f => selectedFiles.has(f.path)).length
    if (sel === 0) return 'none'
    if (sel === files.length) return 'full'
    return 'partial'
  }

  return (
    <div
      className="flex flex-col h-full bg-gray-100"
    >
      {/* Monatsnavigation */}
      <div className="flex items-center justify-center px-4 py-2 bg-gray-100 shrink-0 gap-2">
        <button
          onClick={goPrev}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-white text-gray-600 shadow-sm hover:shadow-md active:scale-95 transition-all hover:text-[var(--accent)]"
        >
          <ChevronLeft size={18} />
        </button>

        {/* Monatsname: Breite richtet sich am längsten Monatsnamen aus —
            unsichtbarer Referenztext reserviert den Platz, skaliert mit Schriftgröße */}
        <div className="relative">
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={() => setPickerOpen(p => !p)}
            className="relative text-2xl font-bold px-2 text-center text-gray-800 rounded-lg active:scale-95 transition-all hover:text-[var(--accent)]"
          >
            <span className="invisible whitespace-nowrap select-none" aria-hidden>September {year}</span>
            <span className="absolute inset-0 flex items-center justify-center whitespace-nowrap">{MONTH_NAMES[month]} {year}</span>
          </button>
          {pickerOpen && (
            <CalendarDatepicker
              year={year} month={month}
              onSelect={(y, m) => { setYear(y); setMonth(m); setPickerOpen(false) }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>

        <button
          onClick={goNext}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-white text-gray-600 shadow-sm hover:shadow-md hover:text-[var(--accent)] active:scale-95 transition-all"
        >
          <ChevronRight size={18} />
        </button>
        <button
          onClick={goToday}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-white text-gray-600 shadow-sm hover:shadow-md hover:text-[var(--accent)] active:scale-95 transition-all"
          title="Heute"
        >
          <CalendarDays size={18} />
        </button>
      </div>

      {/* Wochentag-Header + Kalender-Grid — gemeinsam animiert */}
      <div
        className="flex-1 overflow-hidden"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <div
          key={`${year}-${month}`}
          className={`flex flex-col h-full ${monthAnimClass}`}
          style={{ '--cal-dur': monthAnimDur } as React.CSSProperties}
        >
        <div className="grid grid-cols-7 bg-white shrink-0 shadow-sm">
          {DAY_LABELS.map((d, i) => (
            <div
              key={d}
              className={`text-center text-xs font-medium py-2 uppercase tracking-wide
                ${WEEKEND_COLS.includes(i) ? 'text-red-400' : 'text-gray-400'}`}
            >
              {d}
            </div>
          ))}
        </div>
        <div className="flex-1 overflow-hidden bg-white">
        <div
          className={`grid grid-cols-7 h-full border-t border-l border-gray-100`}
          style={{ gridTemplateRows: `repeat(${Math.ceil((firstDay + days) / 7)}, 1fr)` } as React.CSSProperties}
        >
          {Array.from({ length: firstDay }).map((_, i) => {
            const d = daysInPrev - firstDay + i + 1
            const isWeekend = WEEKEND_COLS.includes(i)
            const dayGroups = byDayPrev.get(d) ?? new Map()
            return (
              <div key={`prev-${d}`} className="border-r border-b border-gray-100 h-full">
                <div className="opacity-35 h-full">
                  <CalendarDay
                    day={d} isToday={false} isWeekend={isWeekend}
                    todayStyle={settings.todayStyle} groups={dayGroups}
                    entrySize={settings.entrySize} compact={false} bold={false}
                    amPmSplit={settings.amPmSplit} groupStatus={groupStatus}
                    onToggleGroup={toggleGroup}
                  />
                </div>
              </div>
            )
          })}
          {Array.from({ length: days }).map((_, i) => {
            const day = i + 1
            const col = (firstDay + i) % 7
            const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate()
            const isWeekend = WEEKEND_COLS.includes(col)
            const dayGroups = byDay.get(day) ?? new Map()

            return (
              <div key={`${year}-${month}-${day}`} className="border-r border-b border-gray-100 h-full">
                <CalendarDay
                  day={day}
                  isToday={isToday}
                  isWeekend={isWeekend}
                  todayStyle={settings.todayStyle}
                  groups={dayGroups}
                  entrySize={settings.entrySize}
                  compact={false}
                  bold={false}
                  amPmSplit={settings.amPmSplit}
                  groupStatus={groupStatus}
                  onToggleGroup={toggleGroup}
                />
              </div>
            )
          })}
          {Array.from({ length: trailingDays }).map((_, i) => {
            const d = i + 1
            const col = (firstDay + days + i) % 7
            const isWeekend = WEEKEND_COLS.includes(col)
            const dayGroups = byDayNext.get(d) ?? new Map()
            return (
              <div key={`next-${d}`} className="border-r border-b border-gray-100 h-full">
                <div className="opacity-35 h-full">
                  <CalendarDay
                    day={d} isToday={false} isWeekend={isWeekend}
                    todayStyle={settings.todayStyle} groups={dayGroups}
                    entrySize={settings.entrySize} compact={false} bold={false}
                    amPmSplit={settings.amPmSplit} groupStatus={groupStatus}
                    onToggleGroup={toggleGroup}
                  />
                </div>
              </div>
            )
          })}
        </div>
        </div>
        </div>
      </div>
    </div>
  )
}
