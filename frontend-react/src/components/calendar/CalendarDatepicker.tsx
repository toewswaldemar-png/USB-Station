import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const MONTHS = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']

interface Props {
  year: number
  month: number
  onSelect: (year: number, month: number) => void
  onClose: () => void
}

export default function CalendarDatepicker({ year, month, onSelect, onClose }: Props) {
  const [pickYear, setPickYear] = useState(year)
  const [yearMode, setYearMode] = useState(false)
  const [yearBase, setYearBase] = useState(year - (year % 12))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute z-50 bg-white rounded-2xl shadow-xl p-4 w-72"
      style={{ top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => yearMode ? setYearBase(b => b - 12) : setPickYear(y => y - 1)}
          className="w-11 h-11 flex items-center justify-center rounded-xl text-gray-600 hover:bg-gray-100 active:scale-95 transition-all"
        >
          <ChevronLeft size={22} />
        </button>

        <button
          onClick={() => setYearMode(m => !m)}
          className="text-lg font-bold text-gray-800 hover:text-violet-600 transition-colors px-2"
        >
          {yearMode ? `${yearBase} – ${yearBase + 11}` : pickYear}
        </button>

        <button
          onClick={() => yearMode ? setYearBase(b => b + 12) : setPickYear(y => y + 1)}
          className="w-11 h-11 flex items-center justify-center rounded-xl text-gray-600 hover:bg-gray-100 active:scale-95 transition-all"
        >
          <ChevronRight size={22} />
        </button>
      </div>

      {yearMode ? (
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 12 }, (_, i) => yearBase + i).map(y => (
            <button
              key={y}
              onClick={() => { setPickYear(y); setYearMode(false) }}
              className={`h-11 rounded-xl text-sm font-bold active:scale-95 transition-all
                ${y === pickYear ? 'text-white' : 'text-gray-700 hover:bg-gray-100'}`}
              style={y === pickYear ? { background: 'var(--accent)' } : {}}
            >
              {y}
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {MONTHS.map((m, i) => (
            <button
              key={m}
              onClick={() => onSelect(pickYear, i)}
              className={`h-11 rounded-xl text-sm font-bold active:scale-95 transition-all
                ${pickYear === year && i === month ? 'text-white' : 'text-gray-700 hover:bg-gray-100'}`}
              style={pickYear === year && i === month ? { background: 'var(--accent)' } : {}}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
