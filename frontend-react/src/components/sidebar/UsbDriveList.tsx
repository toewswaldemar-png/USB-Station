import { HardDrive } from 'lucide-react'
import type { UsbDrive } from '@/types'
import { fmtBytes } from '@/lib/dateUtils'

interface Props {
  drives: UsbDrive[]
  selected: UsbDrive | null
  onSelect: (d: UsbDrive | null) => void
}

export default function UsbDriveList({ drives, selected, onSelect }: Props) {
  if (drives.length === 0) {
    return (
      <div className="px-3 py-2.5 text-xs text-gray-400">Kein USB-Laufwerk erkannt</div>
    )
  }

  return (
    <div className="p-2 flex flex-col gap-1">
      {drives.map(d => (
        <button
          key={d.path}
          onClick={() => onSelect(selected?.path === d.path ? null : d)}
          className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left transition-colors
            ${selected?.path === d.path ? 'text-white' : 'hover:bg-gray-50 text-gray-700'}`}
          style={selected?.path === d.path ? { background: 'var(--accent)' } : {}}
        >
          <HardDrive size={15} className="shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[13px] truncate">{d.label}</div>
            <div className="text-[11px] opacity-60">{fmtBytes(d.free)} frei / {fmtBytes(d.total)}</div>
          </div>
        </button>
      ))}
    </div>
  )
}
